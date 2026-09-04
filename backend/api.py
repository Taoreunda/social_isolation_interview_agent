"""FastAPI 백엔드 — InterviewEngine을 REST API로 제공."""

from __future__ import annotations

import csv
import io
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

# Bootstrap sys.path with backend/ (this file's dir) so package imports resolve
# whether launched via `uvicorn api:app --app-dir backend` or imported directly.
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app_core.paths import DATA_DIR  # noqa: E402  (needs sys.path bootstrap above)

WEB_SESSIONS_DIR = DATA_DIR / "web_sessions"
RESULTS_DIR = DATA_DIR / "results"

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app_core.config import bootstrap
from app_core.database import check_database
from auth.dependencies import get_allowed_origins
from auth.router import router as auth_router
from interview.engine import InterviewEngine
from interview.scorecard import Scorecard, calculate_with_overrides

bootstrap()

app = FastAPI(title="Social Isolation Interview API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)
app.include_router(auth_router, prefix="/api")

# ── Session storage ──
# In-memory per-session engines (single-server deployment)
_sessions: Dict[str, Dict[str, Any]] = {}
_engine: Optional[InterviewEngine] = None


def _safe_session_id(session_id: str) -> str:
    return "".join(char if char.isalnum() or char in ("-", "_") else "_" for char in session_id)


def _session_file(session_id: str) -> Path:
    return WEB_SESSIONS_DIR / f"session_{_safe_session_id(session_id)}.json"


def _message_type_to_role(message_type: str) -> str:
    return "user" if message_type == "human" else "assistant"


def _message_record(message: Any) -> Optional[Dict[str, str]]:
    if isinstance(message, dict):
        content = message.get("content")
        message_type = message.get("type")
        role = message.get("role")
    else:
        content = getattr(message, "content", None)
        message_type = getattr(message, "type", None)
        role = None

    if not content or message_type == "tool":
        return None

    if not role:
        role = _message_type_to_role(str(message_type or "ai"))

    return {
        "type": str(message_type or ("human" if role == "user" else "ai")),
        "role": str(role),
        "content": str(content),
    }


def _persistable_state(state: Dict[str, Any], session_id: str) -> Dict[str, Any]:
    messages = []
    for message in state.get("messages", []):
        record = _message_record(message)
        if record is not None:
            messages.append(record)

    return {
        "session_id": state.get("session_id", session_id),
        "messages": messages,
        "scorecard": state.get("scorecard", {}),
        "interview_complete": state.get("interview_complete", False),
    }


def _scorecard_from_result_payload(payload: Dict[str, Any]) -> Scorecard:
    sc = Scorecard()
    for qid, item_result in payload.get("question_results", {}).items():
        if qid not in sc.items:
            continue
        item = sc.items[qid]
        item["status"] = item_result.get("status")
        item["value"] = item_result.get("extracted_value") or item_result.get("value")
        item["rationale"] = item_result.get("rationale")
        item["timestamp"] = item_result.get("timestamp")

    criteria = payload.get("criteria_results") or {}
    for key in ("A", "B", "C", "D"):
        if key in criteria:
            sc.criteria[key] = criteria[key]

    sc.diagnosis = payload.get("final_diagnosis") or payload.get("classification_result")
    sc.report = payload.get("report")
    sc.early_stop = bool(payload.get("early_stop")) or (
        sc.diagnosis == "일반"
        and sc.criteria.get("A") is False
        and sc.criteria.get("B") is False
        and sc.criteria.get("C") is False
    )
    return sc


def _state_from_result_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    session_id = str(payload.get("session_id") or "")
    sc = _scorecard_from_result_payload(payload)
    messages = []
    for item in payload.get("conversation_history", []):
        role = item.get("role", "assistant")
        content = item.get("content", "")
        if not content:
            continue
        messages.append({
            "type": "human" if role == "user" else "ai",
            "role": role,
            "content": content,
        })

    return {
        "session_id": session_id,
        "messages": messages,
        "scorecard": sc.to_dict(),
        "interview_complete": True,
    }


def _persist_session(session_id: str) -> bool:
    session = _sessions.get(session_id)
    if not session:
        return False

    WEB_SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    path = _session_file(session_id)
    tmp_path = path.with_suffix(".tmp")
    payload = {
        "session_id": session_id,
        "created_at": session.get("created_at"),
        "updated_at": session.get("updated_at"),
        "expert_reviews": session.get("expert_reviews", {}),
        "last_state": _persistable_state(session.get("last_state", {}), session_id),
    }
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(path)
    return True


def _delete_persisted_session(session_id: str) -> None:
    path = _session_file(session_id)
    if path.exists():
        path.unlink()


def _load_web_session_file(path: Path) -> Optional[Dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    session_id = payload.get("session_id")
    if not session_id:
        return None

    last_state = payload.get("last_state") or {}
    last_state.setdefault("session_id", session_id)
    return {
        "session_id": session_id,
        "session": {
            "created_at": payload.get("created_at") or payload.get("updated_at"),
            "updated_at": payload.get("updated_at") or payload.get("created_at"),
            "last_state": last_state,
            "expert_reviews": payload.get("expert_reviews", {}),
        },
    }


def _load_result_file(path: Path) -> Optional[Dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    session_id = payload.get("session_id")
    if not session_id:
        return None

    completed_at = payload.get("completed_at")
    return {
        "session_id": session_id,
        "session": {
            "created_at": completed_at,
            "updated_at": completed_at,
            "last_state": _state_from_result_payload(payload),
            "expert_reviews": payload.get("expert_reviews", {}),
        },
    }


def _load_sessions_from_disk() -> None:
    if WEB_SESSIONS_DIR.exists():
        for path in sorted(WEB_SESSIONS_DIR.glob("session_*.json")):
            loaded = _load_web_session_file(path)
            if loaded:
                _sessions.setdefault(loaded["session_id"], loaded["session"])

    if RESULTS_DIR.exists():
        for path in sorted(RESULTS_DIR.glob("result_*.json")):
            loaded = _load_result_file(path)
            if loaded:
                _sessions.setdefault(loaded["session_id"], loaded["session"])


def _get_engine() -> InterviewEngine:
    global _engine
    if _engine is None:
        _engine = InterviewEngine()
    return _engine


def _get_session(session_id: str) -> Dict[str, Any]:
    _load_sessions_from_disk()
    if session_id not in _sessions:
        _sessions[session_id] = {
            "last_state": {},
            "expert_reviews": {},
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "updated_at": datetime.now().isoformat(timespec="seconds"),
        }
    return _sessions[session_id]


def _touch_session(session_id: str) -> None:
    session = _get_session(session_id)
    session["updated_at"] = datetime.now().isoformat(timespec="seconds")


def _conversation_from_state(state: Dict[str, Any]) -> list[Dict[str, str]]:
    """LangGraph state.messages → role/content list (system msg/tool msg 제외)."""
    conversation: list[Dict[str, str]] = []
    for msg in state.get("messages", []):
        record = _message_record(msg)
        if record is None:
            continue
        content = record["content"]
        role = record["role"]
        if role == "user" and content.startswith("[시스템]"):
            continue
        conversation.append({"role": role, "content": content})
    return conversation


def _scorecard_from_session(session_id: str) -> Scorecard:
    session = _get_session(session_id)
    sc_data = session.get("last_state", {}).get("scorecard", {})
    if sc_data:
        return Scorecard.from_dict(sc_data)
    return Scorecard()


# ── Request/Response models ──

class StartRequest(BaseModel):
    session_id: Optional[str] = None


class MessageRequest(BaseModel):
    session_id: str
    message: str


class ResetRequest(BaseModel):
    session_id: str


class ExpertReviewRequest(BaseModel):
    session_id: str
    question_id: str
    action: str  # "approve" | "override"
    expert_status: Optional[str] = None  # "positive" | "negative" (override 시)
    expert_rationale: Optional[str] = None


class BulkApproveRequest(BaseModel):
    session_id: str


class ExpertReview(BaseModel):
    original_status: Optional[str] = None
    expert_status: Optional[str] = None
    expert_rationale: Optional[str] = None
    action: str  # "approve" | "override"
    reviewed_at: str


class ExpertSummary(BaseModel):
    reviewed_count: int
    total_reviewable: int
    unreviewed_items: list[str]
    expert_diagnosis: Optional[str] = None
    expert_criteria: Optional[Dict[str, Optional[bool]]] = None


class ScorecardItem(BaseModel):
    id: str
    question: str
    status: Optional[str] = None
    value: Optional[str] = None
    rationale: Optional[str] = None
    clarification_count: int = 0
    is_current: bool = False
    is_skipped: bool = False
    expert_review: Optional[ExpertReview] = None


class ScorecardSection(BaseModel):
    id: str
    title: str
    criteria_met: Optional[bool] = None
    items: list[ScorecardItem]


class ScorecardResponse(BaseModel):
    progress: int  # percentage
    answered: int
    total: int
    criteria: Dict[str, Optional[bool]]
    sections: list[ScorecardSection]
    early_stop: bool
    diagnosis: Optional[str] = None
    report: Optional[str] = None
    expert_summary: Optional[ExpertSummary] = None


class InterviewResponse(BaseModel):
    session_id: str
    response: str
    conversation: list[Dict[str, str]]
    scorecard: ScorecardResponse
    interview_complete: bool
    final_diagnosis: Optional[str] = None


# ── Section definitions ──

SECTIONS = [
    ("A", "재택 / 외출 제한", ["A1", "A2", "A3"]),
    ("B", "사회적 상호작용", ["B1", "B2"]),
    ("C", "사회적 지지", ["C1", "C2"]),
    ("D", "기능 손상", ["D1", "D1_duration", "D2", "D2_duration"]),
    ("E", "추가 정보", ["E1", "E2"]),
]


_E_QUESTIONS = ("E1", "E2")


def _build_scorecard_response(
    sc: Scorecard,
    expert_reviews: Optional[Dict[str, Any]] = None,
) -> ScorecardResponse:
    """Scorecard → API response format."""
    expert_reviews = expert_reviews or {}
    answered = sum(1 for item in sc.items.values() if item["status"] is not None)
    total = len(sc.items)
    pct = int(answered / total * 100) if total else 0
    next_q = sc.next_unanswered()

    sections = []
    for sec_id, sec_title, sec_items in SECTIONS:
        items = []
        for qid in sec_items:
            if qid not in sc.items:
                continue
            item = sc.items[qid]
            is_current = (qid == next_q)

            # Skip indicator for D durations
            is_skipped = False
            if item["status"] is None and qid in ("D1_duration", "D2_duration"):
                parent = qid.replace("_duration", "")
                if sc.items.get(parent, {}).get("status") == "negative":
                    is_skipped = True

            # Attach expert review if exists
            er = expert_reviews.get(qid)
            er_model = None
            if er:
                er_model = ExpertReview(
                    original_status=er.get("original_status"),
                    expert_status=er.get("expert_status"),
                    expert_rationale=er.get("expert_rationale"),
                    action=er.get("action", "approve"),
                    reviewed_at=er.get("reviewed_at", ""),
                )

            items.append(ScorecardItem(
                id=qid,
                question=item.get("question", ""),
                status=item["status"],
                value=item["value"],
                rationale=item["rationale"],
                clarification_count=item.get("clarification_count", 0),
                is_current=is_current,
                is_skipped=is_skipped,
                expert_review=er_model,
            ))

        sections.append(ScorecardSection(
            id=sec_id,
            title=sec_title,
            criteria_met=sc.criteria.get(sec_id),
            items=items,
        ))

    # Build expert summary
    expert_summary = None
    if expert_reviews:
        reviewable_ids = [
            qid for qid in sc.question_order
            if sc.items[qid]["status"] is not None
        ]
        reviewed_ids = [qid for qid in reviewable_ids if qid in expert_reviews]
        unreviewed = [qid for qid in reviewable_ids if qid not in expert_reviews]
        override_result = calculate_with_overrides(sc.to_dict(), expert_reviews)
        expert_summary = ExpertSummary(
            reviewed_count=len(reviewed_ids),
            total_reviewable=len(reviewable_ids),
            unreviewed_items=unreviewed,
            expert_diagnosis=override_result["diagnosis"],
            expert_criteria=override_result["criteria"],
        )

    return ScorecardResponse(
        progress=pct,
        answered=answered,
        total=total,
        criteria={k: v for k, v in sc.criteria.items()},
        sections=sections,
        early_stop=sc.early_stop,
        diagnosis=sc.diagnosis,
        report=sc.report,
        expert_summary=expert_summary,
    )


# ── Endpoints ──

@app.post("/api/start")
async def start_interview(req: StartRequest):
    """새 인터뷰 시작 — SSE 스트리밍."""
    session_id = req.session_id or f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    engine = _get_engine()
    session = _get_session(session_id)
    config = {"configurable": {"thread_id": session_id}}

    from langchain_core.messages import HumanMessage

    sc = Scorecard()
    initial_state = {
        "messages": [HumanMessage(content="[시스템] 인터뷰를 시작하세요.")],
        "scorecard": sc.to_dict(),
        "interview_complete": False,
        "session_id": session_id,
    }

    async def event_generator():
        # Send session_id first
        yield f"data: {json.dumps({'type': 'session', 'session_id': session_id}, ensure_ascii=False)}\n\n"

        try:
            async for event in engine.graph.astream_events(
                initial_state, config, version="v2"
            ):
                kind = event.get("event", "")
                if kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        if hasattr(chunk, "tool_call_chunks") and chunk.tool_call_chunks:
                            continue
                        yield f"data: {json.dumps({'type': 'token', 'content': chunk.content}, ensure_ascii=False)}\n\n"

            result_state = engine.graph.get_state(config).values
            session["last_state"] = result_state
            _touch_session(session_id)
            _persist_session(session_id)
            sc_final = _scorecard_from_session(session_id)
            er = session.get("expert_reviews", {})

            conversation = _conversation_from_state(result_state)

            done_data = {
                "type": "done",
                "conversation": conversation,
                "scorecard": _build_scorecard_response(sc_final, er).model_dump(),
                "interview_complete": result_state.get("interview_complete", False),
                "final_diagnosis": sc_final.diagnosis,
            }
            yield f"data: {json.dumps(done_data, ensure_ascii=False)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/message", response_model=InterviewResponse)
async def send_message(req: MessageRequest):
    """사용자 메시지 전송."""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="빈 메시지")

    engine = _get_engine()
    session = _get_session(req.session_id)

    result = await engine.process_user_input(req.session_id, req.message)
    session["last_state"] = result.get("state", {})
    _touch_session(req.session_id)
    _persist_session(req.session_id)

    sc = _scorecard_from_session(req.session_id)
    er = session.get("expert_reviews", {})

    return InterviewResponse(
        session_id=req.session_id,
        response=result.get("response", ""),
        conversation=result.get("conversation", []),
        scorecard=_build_scorecard_response(sc, er),
        interview_complete=result.get("interview_complete", False),
        final_diagnosis=result.get("final_diagnosis"),
    )


@app.post("/api/stream")
async def stream_message(req: MessageRequest):
    """사용자 메시지 전송 — SSE 스트리밍 응답."""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="빈 메시지")

    engine = _get_engine()
    session = _get_session(req.session_id)
    config = {"configurable": {"thread_id": req.session_id}}

    from langchain_core.messages import HumanMessage

    # Ensure graph has state (first turn handled by /api/start)
    update = {"messages": [HumanMessage(content=req.message)]}

    async def event_generator():
        """SSE generator: stream tokens then send final state."""
        try:
            async for event in engine.graph.astream_events(
                update, config, version="v2"
            ):
                kind = event.get("event", "")
                # LLM token stream — only from the final AI response (not tool calls)
                if kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        # Skip chunks that are tool_call fragments
                        if hasattr(chunk, "tool_call_chunks") and chunk.tool_call_chunks:
                            continue
                        yield f"data: {json.dumps({'type': 'token', 'content': chunk.content}, ensure_ascii=False)}\n\n"

            # After stream completes, read final state and send scorecard
            result_state = engine.graph.get_state(config).values
            session["last_state"] = result_state
            _touch_session(req.session_id)
            _persist_session(req.session_id)

            sc = _scorecard_from_session(req.session_id)
            er = session.get("expert_reviews", {})
            conversation = _conversation_from_state(result_state)

            done_data = {
                "type": "done",
                "conversation": conversation,
                "scorecard": _build_scorecard_response(sc, er).model_dump(),
                "interview_complete": result_state.get("interview_complete", False),
                "final_diagnosis": sc.diagnosis,
            }
            yield f"data: {json.dumps(done_data, ensure_ascii=False)}\n\n"

        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/reset")
async def reset_interview(req: ResetRequest):
    """인터뷰 초기화."""
    engine = _get_engine()
    engine.reset_session(req.session_id)
    if req.session_id in _sessions:
        del _sessions[req.session_id]
    _delete_persisted_session(req.session_id)
    return {"status": "ok", "session_id": req.session_id}


@app.post("/api/review")
async def submit_expert_review(req: ExpertReviewRequest):
    """개별 항목 전문가 검토 (동의/변경)."""
    session = _get_session(req.session_id)
    sc = _scorecard_from_session(req.session_id)

    if req.question_id not in sc.items:
        raise HTTPException(status_code=400, detail=f"알 수 없는 질문 ID: {req.question_id}")

    item = sc.items[req.question_id]
    if item["status"] is None:
        raise HTTPException(status_code=400, detail=f"미평가 항목은 검토할 수 없습니다: {req.question_id}")

    if req.action == "override":
        if not req.expert_status:
            raise HTTPException(status_code=400, detail="변경 시 expert_status 필수")
        if req.expert_status not in ("positive", "negative"):
            raise HTTPException(status_code=400, detail="expert_status는 positive 또는 negative")
        # E1/E2는 동의만 가능
        if req.question_id in _E_QUESTIONS:
            raise HTTPException(status_code=400, detail="E1/E2는 동의만 가능합니다")

    review_data = {
        "original_status": item["status"],
        "expert_status": req.expert_status if req.action == "override" else item["status"],
        "expert_rationale": req.expert_rationale,
        "action": req.action,
        "reviewed_at": datetime.now().isoformat(timespec="seconds"),
    }

    er = session.setdefault("expert_reviews", {})
    er[req.question_id] = review_data
    _touch_session(req.session_id)
    _persist_session(req.session_id)

    return {
        "status": "ok",
        "question_id": req.question_id,
        "review": review_data,
        "scorecard": _build_scorecard_response(sc, er).model_dump(),
    }


@app.post("/api/review/bulk-approve")
async def bulk_approve_reviews(req: BulkApproveRequest):
    """전체 승인 — 미검토 항목 모두 동의 처리."""
    session = _get_session(req.session_id)
    sc = _scorecard_from_session(req.session_id)
    er = session.setdefault("expert_reviews", {})
    now = datetime.now().isoformat(timespec="seconds")

    approved = []
    for qid in sc.question_order:
        item = sc.items[qid]
        if item["status"] is None:
            continue
        if qid in er:
            continue
        er[qid] = {
            "original_status": item["status"],
            "expert_status": item["status"],
            "expert_rationale": None,
            "action": "approve",
            "reviewed_at": now,
        }
        approved.append(qid)
    _touch_session(req.session_id)
    _persist_session(req.session_id)

    return {
        "status": "ok",
        "approved_items": approved,
        "scorecard": _build_scorecard_response(sc, er).model_dump(),
    }


@app.get("/api/csv/{session_id}")
async def download_csv(session_id: str):
    """채점표 CSV 다운로드 (전문가 검토 포함)."""
    sc = _scorecard_from_session(session_id)
    if not any(item["status"] for item in sc.items.values()):
        raise HTTPException(status_code=404, detail="평가된 항목 없음")

    session = _get_session(session_id)
    er = session.get("expert_reviews", {})

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["항목", "상태", "값", "근거", "전문가_판정", "전문가_사유"])
    for qid in sc.question_order:
        item = sc.items[qid]
        review = er.get(qid, {})
        expert_status = review.get("expert_status", "")
        expert_rationale = review.get("expert_rationale", "")
        writer.writerow([
            qid,
            item["status"] or "미평가",
            item["value"] or "",
            item["rationale"] or "",
            expert_status or "",
            expert_rationale or "",
        ])
    writer.writerow([])
    writer.writerow(["기준", "AI_결과", "전문가_결과"])
    override_result = calculate_with_overrides(sc.to_dict(), er) if er else None
    for key in ("A", "B", "C", "D"):
        val = sc.criteria[key]
        ai_result = "충족" if val else ("비충족" if val is False else "미산출")
        expert_result = ""
        if override_result:
            ev = override_result["criteria"].get(key)
            expert_result = "충족" if ev else ("비충족" if ev is False else "미산출")
        writer.writerow([key, ai_result, expert_result])
    if sc.diagnosis:
        writer.writerow([])
        expert_diag = override_result["diagnosis"] if override_result else ""
        writer.writerow(["AI_진단", sc.diagnosis])
        if expert_diag:
            writer.writerow(["전문가_진단", expert_diag])

    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=scorecard_{session_id}.csv"},
    )


@app.get("/api/sessions")
async def list_sessions():
    """검사자용 세션 목록 — 메모리에 있는 모든 세션의 요약."""
    _load_sessions_from_disk()
    items = []
    for sid, sess in _sessions.items():
        sc = _scorecard_from_session(sid)
        answered = sum(1 for it in sc.items.values() if it["status"] is not None)
        total = len(sc.items)
        progress = int(answered / total * 100) if total else 0
        last_state = sess.get("last_state", {})
        er = sess.get("expert_reviews", {})
        reviewable_ids = [qid for qid in sc.question_order if sc.items[qid]["status"] is not None]
        reviewed = sum(1 for qid in reviewable_ids if qid in er)
        items.append({
            "session_id": sid,
            "created_at": sess.get("created_at"),
            "updated_at": sess.get("updated_at"),
            "answered": answered,
            "total": total,
            "progress": progress,
            "interview_complete": last_state.get("interview_complete", False),
            "diagnosis": sc.diagnosis,
            "reviewed_count": reviewed,
            "reviewable_count": len(reviewable_ids),
        })
    items.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
    return {"sessions": items}


@app.get("/api/sessions/{session_id}")
async def load_session(session_id: str):
    """검사자용 세션 상세 — 대화 + 채점표 + 전문가 검토."""
    _load_sessions_from_disk()
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail=f"세션을 찾을 수 없습니다: {session_id}")

    session = _sessions[session_id]
    last_state = session.get("last_state", {})
    sc = _scorecard_from_session(session_id)
    er = session.get("expert_reviews", {})

    conversation = _conversation_from_state(last_state)

    return {
        "session_id": session_id,
        "created_at": session.get("created_at"),
        "updated_at": session.get("updated_at"),
        "conversation": conversation,
        "scorecard": _build_scorecard_response(sc, er).model_dump(),
        "interview_complete": last_state.get("interview_complete", False),
        "final_diagnosis": sc.diagnosis,
    }


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/ready")
def readiness():
    if not check_database():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="필수 서비스를 사용할 수 없습니다.",
        )
    return {"status": "ready"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
