"""Gradio 기반 인터뷰 UI — 2열 레이아웃 (채팅 + 채점표)."""

from __future__ import annotations

import csv
import logging
import sys
import tempfile
from datetime import datetime
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import gradio as gr

from app_core.config import bootstrap
from interview.engine import InterviewEngine
from interview.scorecard import Scorecard

bootstrap()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────
# Scorecard → HTML 렌더링
# ──────────────────────────────────────────────

STATUS_ICONS = {
    "positive": "✅",
    "negative": "❌",
    "recorded": "📝",
    None: "⬜",
}

CRITERIA_LABELS = {
    "A": "🏠 A (재택)",
    "B": "👥 B (상호작용)",
    "C": "🤝 C (사회적 지지)",
    "D": "😟 D (기능 손상)",
}

DIAGNOSIS_STYLES = {
    "히키코모리": ("🔴", "#ffebee", "#f44336"),
    "사회적 고립": ("🟡", "#fff3e0", "#ff9800"),
    "일반": ("🟢", "#e8f5e9", "#4caf50"),
}


def render_scorecard_html(sc: Scorecard) -> str:
    """Scorecard 데이터를 HTML 테이블로 렌더링."""
    answered = sum(1 for item in sc.items.values() if item["status"] is not None)
    total = len(sc.items)
    pct = int(answered / total * 100) if total else 0
    next_q = sc.next_unanswered()

    rows = ""
    for qid in sc.question_order:
        item = sc.items[qid]
        status = item["status"]
        icon = STATUS_ICONS.get(status, "⬜")

        # Skip indicator
        if status is None and qid in ("D1_duration", "D2_duration"):
            parent = qid.replace("_duration", "")
            parent_status = sc.items.get(parent, {}).get("status")
            if parent_status == "negative":
                icon = "──"
                status_text = "스킵"
            else:
                status_text = "미평가"
        elif status is None:
            status_text = "미평가"
        else:
            status_text = status

        value = item["value"] or "─"
        rationale_full = item["rationale"] or "─"

        is_current = (qid == next_q)
        row_style = 'border-left:3px solid #2196f3;background-color:#e3f2fd;' if is_current else 'border-left:3px solid transparent;'

        rows += f"""<tr style="{row_style}">
            <td style="padding:4px 8px;font-weight:600;">{qid}</td>
            <td style="padding:4px 8px;">{icon} {status_text}</td>
            <td style="padding:4px 8px;">{value}</td>
            <td style="padding:4px 8px;color:#666;font-size:0.85em;max-width:180px;
                        overflow:hidden;white-space:nowrap;text-overflow:ellipsis;"
                title="{rationale_full}">{rationale_full}</td>
        </tr>"""

    # Criteria section
    criteria_html = ""
    for key in ("A", "B", "C", "D"):
        val = sc.criteria[key]
        label = CRITERIA_LABELS[key]
        if val is None:
            badge = '<span style="color:#999;">⏳ 미산출</span>'
        elif val:
            badge = '<span style="color:#4caf50;font-weight:600;">✅ 충족</span>'
        else:
            badge = '<span style="color:#f44336;font-weight:600;">❌ 비충족</span>'
        criteria_html += f'<div style="display:inline-block;margin:4px 12px 4px 0;">{label} {badge}</div>'

    # Diagnosis
    diagnosis_html = ""
    if sc.diagnosis:
        emoji, bg, border = DIAGNOSIS_STYLES.get(sc.diagnosis, ("", "#f5f5f5", "#999"))
        diagnosis_html = f"""
        <div style="background:{bg};border-left:4px solid {border};padding:10px 14px;margin:8px 0;border-radius:4px;">
            <strong>{emoji} 진단: {sc.diagnosis}</strong>
        </div>"""

    if sc.early_stop:
        diagnosis_html += """
        <div style="background:#fff3e0;border-left:4px solid #ff9800;padding:8px 14px;margin:4px 0;border-radius:4px;font-size:0.9em;">
            ⚡ 조기종료 (A, B, C 모두 비충족)
        </div>"""

    # Report
    report_html = ""
    if sc.report:
        report_html = f"""
        <div style="margin-top:8px;padding:10px;background:#f9f9f9;border-radius:6px;font-size:0.9em;">
            <strong>📝 교차검토 보고서</strong><br>{sc.report}
        </div>"""

    # Progress bar
    bar_color = "#4caf50" if pct == 100 else "#2196f3"
    progress_html = f"""
    <div style="margin:8px 0;">
        <div style="display:flex;justify-content:space-between;font-size:0.85em;margin-bottom:2px;">
            <span>진행률</span><span>{answered}/{total} ({pct}%)</span>
        </div>
        <div style="background:#e0e0e0;border-radius:4px;height:8px;">
            <div style="background:{bar_color};width:{pct}%;height:100%;border-radius:4px;"></div>
        </div>
    </div>"""

    return f"""
    <div style="font-family:system-ui,-apple-system,sans-serif;">
        {progress_html}
        <table style="width:100%;border-collapse:collapse;font-size:0.9em;margin:8px 0;">
            <thead>
                <tr style="border-bottom:2px solid #ddd;">
                    <th style="padding:6px 8px;text-align:left;">항목</th>
                    <th style="padding:6px 8px;text-align:left;">상태</th>
                    <th style="padding:6px 8px;text-align:left;">값</th>
                    <th style="padding:6px 8px;text-align:left;">근거</th>
                </tr>
            </thead>
            <tbody>{rows}</tbody>
        </table>
        <div style="border-top:1px solid #ddd;padding-top:8px;margin-top:4px;">
            <strong>기준 판정</strong><br>
            {criteria_html}
        </div>
        {diagnosis_html}
        {report_html}
    </div>"""


def scorecard_to_csv_file(sc: Scorecard) -> str | None:
    """Scorecard를 CSV 임시 파일로 저장, 경로 반환."""
    if not any(item["status"] for item in sc.items.values()):
        return None

    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".csv", delete=False, encoding="utf-8-sig"
    )
    writer = csv.writer(tmp)
    writer.writerow(["항목", "상태", "값", "근거"])
    for qid in sc.question_order:
        item = sc.items[qid]
        writer.writerow([
            qid,
            item["status"] or "미평가",
            item["value"] or "",
            item["rationale"] or "",
        ])
    writer.writerow([])
    writer.writerow(["기준", "결과"])
    for key in ("A", "B", "C", "D"):
        val = sc.criteria[key]
        writer.writerow([key, "충족" if val else ("비충족" if val is False else "미산출")])
    if sc.diagnosis:
        writer.writerow([])
        writer.writerow(["진단", sc.diagnosis])
    tmp.close()
    return tmp.name


# ──────────────────────────────────────────────
# State helpers (per-session via gr.State)
# ──────────────────────────────────────────────

def _get_engine(app_state: dict) -> InterviewEngine:
    if "engine" not in app_state:
        app_state["engine"] = InterviewEngine()
    return app_state["engine"]


def _get_session_id(app_state: dict) -> str:
    if "session_id" not in app_state:
        app_state["session_id"] = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    return app_state["session_id"]


def _get_scorecard(app_state: dict) -> Scorecard:
    last = app_state.get("last_state", {})
    sc_data = last.get("scorecard", {})
    if sc_data:
        return Scorecard.from_dict(sc_data)
    return Scorecard()


# ──────────────────────────────────────────────
# Gradio App
# ──────────────────────────────────────────────

def create_app() -> gr.Blocks:

    async def start_interview(app_state: dict):
        """인터뷰 초기화 및 첫 메시지."""
        try:
            engine = _get_engine(app_state)
            session_id = _get_session_id(app_state)
            result = await engine.process_user_input(session_id, "")
            app_state["last_state"] = result.get("state", {})
            response = result.get("response", "")
            sc = _get_scorecard(app_state)
            history = [{"role": "assistant", "content": response}]
            return history, render_scorecard_html(sc), app_state
        except Exception as exc:
            logger.exception("Failed to start interview")
            error_msg = f"엔진 초기화 실패: {exc}"
            history = [{"role": "assistant", "content": error_msg}]
            return history, render_scorecard_html(Scorecard()), app_state

    async def user_message(message: str, history: list, app_state: dict):
        """사용자 메시지 처리."""
        if not message.strip():
            return history, render_scorecard_html(_get_scorecard(app_state)), "", app_state

        history = history + [{"role": "user", "content": message}]

        try:
            engine = _get_engine(app_state)
            session_id = _get_session_id(app_state)
            result = await engine.process_user_input(session_id, message)
            app_state["last_state"] = result.get("state", {})

            response = result.get("response", "")
            if response:
                history = history + [{"role": "assistant", "content": response}]
        except Exception as exc:
            logger.exception("Failed to process message")
            history = history + [{"role": "assistant", "content": f"오류: {exc}"}]

        sc = _get_scorecard(app_state)
        return history, render_scorecard_html(sc), "", app_state

    def reset_interview(app_state: dict):
        """새 인터뷰 시작."""
        old_session = app_state.get("session_id")
        engine = app_state.get("engine")
        if old_session and engine:
            engine.reset_session(old_session)

        app_state.clear()
        sc = Scorecard()
        return [], render_scorecard_html(sc), app_state

    def download_csv(app_state: dict):
        """CSV 다운로드 파일 생성."""
        sc = _get_scorecard(app_state)
        path = scorecard_to_csv_file(sc)
        if path:
            gr.Info("CSV 파일 준비 완료")
            return gr.File(value=path, visible=True)
        gr.Warning("아직 평가된 항목이 없습니다.")
        return gr.File(visible=False)

    # ── Layout ──

    with gr.Blocks(
        title="사회적 고립 인터뷰",
    ) as app:
        app_state = gr.State({})

        gr.Markdown("## 📋 사회적 고립 인터뷰 시스템")

        with gr.Row(equal_height=True):
            # ── Left: Chat ──
            with gr.Column(scale=1):
                chatbot = gr.Chatbot(
                    label="💬 인터뷰",
                    elem_id="chatbot",
                )
                with gr.Row():
                    msg_input = gr.Textbox(
                        placeholder="답변을 입력하세요...",
                        show_label=False,
                        scale=5,
                        container=False,
                    )
                    send_btn = gr.Button("전송", scale=1, variant="primary", min_width=80)

            # ── Right: Scorecard ──
            with gr.Column(scale=1):
                with gr.Accordion("📊 채점표", open=True):
                    scorecard_html = gr.HTML(
                        value=render_scorecard_html(Scorecard()),
                        elem_id="scorecard-html",
                    )
                with gr.Row():
                    new_btn = gr.Button("🔄 새 인터뷰", variant="secondary")
                    csv_btn = gr.Button("📥 CSV 다운로드", variant="secondary")
                csv_file = gr.File(visible=False, label="CSV")

        # ── Events ──

        msg_input.submit(
            fn=user_message,
            inputs=[msg_input, chatbot, app_state],
            outputs=[chatbot, scorecard_html, msg_input, app_state],
        )
        send_btn.click(
            fn=user_message,
            inputs=[msg_input, chatbot, app_state],
            outputs=[chatbot, scorecard_html, msg_input, app_state],
        )

        new_btn.click(
            fn=reset_interview,
            inputs=[app_state],
            outputs=[chatbot, scorecard_html, app_state],
        ).then(
            fn=start_interview,
            inputs=[app_state],
            outputs=[chatbot, scorecard_html, app_state],
        )

        csv_btn.click(fn=download_csv, inputs=[app_state], outputs=[csv_file])

        app.load(
            fn=start_interview,
            inputs=[app_state],
            outputs=[chatbot, scorecard_html, app_state],
        )

    return app


if __name__ == "__main__":
    app = create_app()
    app.launch(
        server_name="0.0.0.0",
        server_port=7860,
        theme=gr.themes.Soft(),
        css="""
            #chatbot { height: 70vh !important; }
            #scorecard-html { height: 70vh; overflow-y: auto; }
        """,
    )
