"""저장된 인터뷰 결과를 분석하고 시각화하는 페이지."""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Dict, List

import json
from functools import lru_cache
import sys
from pathlib import Path

# Add root directory to path BEFORE any local imports
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate

from app_core.auth import render_user_badge, require_admin_login
from app_core.config import bootstrap, get_config_value

# Import after sys.path is set to avoid circular import issues
import storage.json_storage
JSONStorage = storage.json_storage.JSONStorage

bootstrap()

st.set_page_config(
    page_title="결과 분석 - 사회적 고립 인터뷰",
    page_icon="📊",
    layout="wide",
)

st.markdown(
    """
<style>
    .analysis-header { text-align: center; color: #2E86AB; margin-bottom: 2rem; }
    .metric-card { background-color: #ffffff; border: 2px solid #e3f2fd; border-radius: 10px; padding: 1rem; text-align: center; }
    .diagnosis-hikikomori { background-color: #ffebee; border-left: 5px solid #f44336; padding: 1rem; margin: 0.5rem 0; }
    .diagnosis-isolation { background-color: #fff3e0; border-left: 5px solid #ff9800; padding: 1rem; margin: 0.5rem 0; }
    .diagnosis-normal { background-color: #e8f5e8; border-left: 5px solid #4caf50; padding: 1rem; margin: 0.5rem 0; }
</style>
""",
    unsafe_allow_html=True,
)

if not require_admin_login("result"):
    st.stop()

render_user_badge("result")


def initialize_analysis_state() -> None:
    if "storage" not in st.session_state:
        st.session_state.storage = JSONStorage()
    if "analysis_llm" not in st.session_state:
        try:
            google_api_key = get_config_value("GOOGLE_API_KEY")
            if not google_api_key:
                raise RuntimeError("GOOGLE_API_KEY 환경 변수가 필요합니다.")
            st.session_state.analysis_llm = ChatGoogleGenerativeAI(
                model="gemini-2.5-flash",
                google_api_key=google_api_key,
                temperature=0.2,
                max_output_tokens=1024,
            )
        except Exception as exc:  # pragma: no cover - 환경 의존
            st.session_state.analysis_llm = None
            st.session_state.analysis_llm_error = str(exc)
    if "analysis_llm_error" not in st.session_state:
        st.session_state.analysis_llm_error = None


def load_all_results() -> List[Dict]:
    try:
        return st.session_state.storage.get_all_results()
    except Exception as exc:  # pragma: no cover
        st.error(f"결과를 불러오는 중 오류가 발생했습니다: {exc}")
        return []


def create_diagnosis_chart(results: List[Dict]):
    if not results:
        return None

    diagnosis_counts: Dict[str, int] = {}
    for result in results:
        diagnosis = result.get("final_diagnosis") or "미분류"
        diagnosis_counts[diagnosis] = diagnosis_counts.get(diagnosis, 0) + 1

    return px.pie(
        values=list(diagnosis_counts.values()),
        names=list(diagnosis_counts.keys()),
        title="진단 결과 분포",
        color_discrete_map={
            "히키코모리": "#ff6b6b",
            "사회적 고립": "#feca57",
            "일반": "#48ca99",
            "미분류": "#a4b0be",
        },
    )


def create_criteria_analysis_chart(results: List[Dict]):
    if not results:
        return None

    criteria_totals = {"A": 0, "B": 0, "C": 0, "D": 0}
    total = len(results)

    for result in results:
        criteria = result.get("criteria_results", {})
        for key in criteria_totals:
            if criteria.get(key) is True:
                criteria_totals[key] += 1

    percentages = {key: (value / total * 100) if total > 0 else 0 for key, value in criteria_totals.items()}

    fig = go.Figure(
        data=[
            go.Bar(
                x=list(percentages.keys()),
                y=list(percentages.values()),
                marker_color=["#3498db", "#e74c3c", "#f39c12", "#2ecc71"],
            )
        ]
    )
    fig.update_layout(title="기준별 충족률 (%)", xaxis_title="평가 기준", yaxis_title="충족률 (%)", yaxis=dict(range=[0, 100]))
    return fig


def create_timeline_chart(results: List[Dict]):
    if not results:
        return None

    date_counts: Dict[str, int] = {}
    for result in results:
        completed = result.get("completed_at")
        if completed:
            date = completed.split("T")[0]
            date_counts[date] = date_counts.get(date, 0) + 1

    if not date_counts:
        return None

    sorted_dates = sorted(date_counts.keys())
    counts = [date_counts[date] for date in sorted_dates]

    fig = go.Figure(
        data=go.Scatter(
            x=sorted_dates,
            y=counts,
            mode="lines+markers",
            line=dict(color="#3498db", width=3),
            marker=dict(size=8),
        )
    )
    fig.update_layout(title="일별 인터뷰 실시 현황", xaxis_title="날짜", yaxis_title="인터뷰 수")
    return fig



def display_result_details(result: Dict) -> None:
    st.subheader(f"📋 세션 {result.get('session_id')} 상세 정보")

    col1, col2, col3 = st.columns(3)
    with col1:
        st.metric("완료 시간", (result.get("completed_at") or "").split("T")[0])
    with col2:
        st.metric("대화 수", result.get("conversation_length", 0))
    with col3:
        st.metric("재질문 횟수", result.get("total_clarifications", 0))

    diagnosis = result.get("final_diagnosis", "미분류")
    if diagnosis == "히키코모리":
        klass = "diagnosis-hikikomori"
        st.markdown(f'<div class="{klass}"><strong>🔍 진단 결과:</strong> {diagnosis}</div>', unsafe_allow_html=True)
    elif diagnosis == "사회적 고립":
        klass = "diagnosis-isolation"
        st.markdown(f'<div class="{klass}"><strong>🔍 진단 결과:</strong> {diagnosis}</div>', unsafe_allow_html=True)
    elif diagnosis == "추가 평가 필요":
        st.warning("🔍 진단 결과: 추가 평가 필요")
    else:
        st.info(f"🔍 진단 결과: {diagnosis}")

    st.subheader("📊 기준별 평가 결과")
    criteria = result.get("criteria_results", {})
    col_a, col_b, col_c, col_d = st.columns(4)

    abc_all_negative = all(criteria.get(k) is False for k in ("A", "B", "C"))

    def render_criterion(column, key: str, label: str) -> None:
        value = criteria.get(key)
        if value is True:
            column.success(f"{label}\n✅ 충족")
        elif value is False:
            column.info(f"{label}\n❌ 비충족")
        elif (
            key == "D"
            and diagnosis == "일반"
            and abc_all_negative
            and value in (None, "")
        ):
            column.info(f"{label}\n🚫 평가 생략")
        else:
            column.warning(f"{label}\n⏳ 평가 중")

    render_criterion(col_a, "A", "🏠 A 기준")
    render_criterion(col_b, "B", "👥 B 기준")
    render_criterion(col_c, "C", "🤝 C 기준")
    render_criterion(col_d, "D", "😟 D 기준")

    report = result.get("report")
    if report:
        st.subheader("📝 교차 검토 보고서")
        st.markdown(report)

    question_map, question_order = load_flow_question_map()

    conversation = result.get("conversation_history", [])
    if conversation:
        with st.expander("🗒️ 면담 대화 기록"):
            for entry in conversation:
                content = entry.get("content", "")
                if not content:
                    continue
                role = entry.get("role", "assistant")
                speaker = "👤 사용자" if role == "user" else "🤖 에이전트"
                st.markdown(f"**{speaker}:** {content}")

    question_results = result.get("question_results", {})
    if question_results:
        with st.expander("📑 기록지 응답 요약"):
            rows = []
            for qid, info in question_results.items():
                extracted = (
                    info.get("extracted_value")
                    or info.get("extracted_number")
                    or info.get("extracted_months")
                    or info.get("extracted_score")
                )
                rows.append({
                    "코드": qid,
                    "질문": question_map.get(qid, qid),
                    "평가": info.get("status"),
                    "추출값": extracted if extracted is not None else "",
                    "근거": info.get("rationale"),
                    "기록시각": info.get("timestamp"),
                })

            rows.sort(key=lambda row: question_order.get(row["코드"], 999))
            df = pd.DataFrame(rows)
            string_columns = ["코드", "질문", "평가", "추출값", "근거", "기록시각"]
            for column in string_columns:
                if column in df.columns:
                    df[column] = df[column].fillna("").astype("string")
            st.dataframe(df, width="stretch", hide_index=True)


@lru_cache(maxsize=1)
def load_flow_question_map():
    with open("interview_flow.json", "r", encoding="utf-8") as file:
        data = json.load(file)

    question_map = {}
    order_map = {}
    idx = 0
    for node_id, node in data.get("nodes", {}).items():
        if node.get("type") == "question":
            question_map[node_id] = node.get("question_text", "")
            order_map[node_id] = idx
            idx += 1

    return question_map, order_map


def main() -> None:
    initialize_analysis_state()

    results = load_all_results()
    if not results:
        st.warning("분석할 인터뷰 결과가 없습니다. 먼저 인터뷰를 완료해주세요.")
        if st.button("🏠 메인 페이지로 돌아가기"):
            st.switch_page("main.py")
        return

    st.markdown('<h1 class="analysis-header">📊 인터뷰 결과 분석</h1>', unsafe_allow_html=True)

    tab1, tab2 = st.tabs(["📈 전체 통계", "📋 개별 결과"])

    with tab1:
        col1, col2, col3, col4 = st.columns(4)
        with col1:
            st.markdown('<div class="metric-card">', unsafe_allow_html=True)
            st.metric("총 인터뷰 수", len(results))
            st.markdown('</div>', unsafe_allow_html=True)
        with col2:
            st.markdown('<div class="metric-card">', unsafe_allow_html=True)
            st.metric("히키코모리", sum(1 for r in results if r.get("final_diagnosis") == "히키코모리"))
            st.markdown('</div>', unsafe_allow_html=True)
        with col3:
            st.markdown('<div class="metric-card">', unsafe_allow_html=True)
            st.metric("사회적 고립", sum(1 for r in results if r.get("final_diagnosis") == "사회적 고립"))
            st.markdown('</div>', unsafe_allow_html=True)
        with col4:
            st.markdown('<div class="metric-card">', unsafe_allow_html=True)
            st.metric("일반", sum(1 for r in results if r.get("final_diagnosis") == "일반"))
            st.markdown('</div>', unsafe_allow_html=True)

        diag_chart = create_diagnosis_chart(results)
        if diag_chart:
            st.plotly_chart(diag_chart, width="stretch")

    with tab2:
        session_options = [
            f"{result.get('session_id')} ({(result.get('completed_at') or '').split('T')[0]})"
            for result in results
        ]
        selected_idx = st.selectbox(
            "분석할 인터뷰를 선택하세요:",
            range(len(session_options)),
            format_func=lambda idx: session_options[idx],
        )
        if selected_idx is not None:
            display_result_details(results[selected_idx])

    st.divider()
    col1, col2, col3 = st.columns(3)
    with col1:
        if st.button("🏠 메인 페이지로 돌아가기"):
            st.switch_page("main.py")
    with col2:
        if st.button("📄 CSV로 내보내기"):
            export_success = st.session_state.storage.export_results_csv("interview_results.csv")
            if export_success:
                st.success("결과가 CSV 파일로 내보내졌습니다!")
            else:
                st.error("CSV 내보내기에 실패했습니다.")
    with col3:
        if st.button("🔄 데이터 새로고침"):
            st.rerun()


if __name__ == "__main__":  # pragma: no cover
    main()
