"""LangGraph 기반 채팅 인터뷰 페이지."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime

import streamlit as st
from dotenv import load_dotenv

from interview.flow_engine import InterviewFlowEngineV2

# 환경 변수 로드
load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

st.set_page_config(page_title="채팅", page_icon="💬", layout="centered")


def initialize_session_state() -> None:
    if "engine_error" not in st.session_state:
        st.session_state.engine_error = None

    if "engine" not in st.session_state:
        try:
            st.session_state.engine = InterviewFlowEngineV2()
            st.session_state.engine_error = None
        except RuntimeError as exc:
            st.session_state.engine_error = str(exc)
    if "session_id" not in st.session_state:
        st.session_state.session_id = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    if "conversation_history" not in st.session_state:
        st.session_state.conversation_history = []
    if "interview_state" not in st.session_state:
        st.session_state.interview_state = None
    if "criteria_results" not in st.session_state:
        st.session_state.criteria_results = {}
    if "question_results" not in st.session_state:
        st.session_state.question_results = {}
    if "current_results" not in st.session_state:
        st.session_state.current_results = {}
    if "interview_complete" not in st.session_state:
        st.session_state.interview_complete = False
    if "final_diagnosis" not in st.session_state:
        st.session_state.final_diagnosis = None


async def run_interview_step(user_input: str = ""):
    try:
        result = await st.session_state.engine.process_user_input(
            st.session_state.session_id,
            user_input,
        )
        st.session_state.interview_state = result.get("state")
        st.session_state.conversation_history = result.get("conversation", [])
        st.session_state.criteria_results = result.get("criteria_results", {})
        st.session_state.question_results = result.get("question_results", {})
        st.session_state.current_results = {
            "criteria_results": st.session_state.criteria_results,
            "final_diagnosis": result.get("final_diagnosis"),
        }
        st.session_state.interview_complete = result.get("interview_complete", False)
        st.session_state.final_diagnosis = result.get("final_diagnosis")
        return result
    except Exception as exc:  # pragma: no cover - 런타임 오류 로그 및 사용자 안내
        logger.exception("Interview processing failed")
        st.error(f"인터뷰 처리 중 오류가 발생했습니다: {exc}")
        return None


def display_conversation_history() -> None:
    for message in st.session_state.conversation_history:
        content = message.get("content", "")
        if not content:
            continue
        role = message.get("role", "assistant")
        with st.chat_message("user" if role == "user" else "assistant"):
            st.write(content)


def stream_assistant_response(text: str, placeholder,
                              delay: float = 0.02, chunk_size: int = 6) -> None:
    """단계적으로 응답을 렌더링해 스트리밍 UX를 구현한다."""
    if not text:
        placeholder.markdown("")
        return

    total_length = len(text)
    step = max(chunk_size, 1)
    for idx in range(0, total_length, step):
        placeholder.markdown(text[: idx + step])
        time.sleep(delay)


def main() -> None:
    initialize_session_state()

    if st.session_state.engine_error:
        st.error(st.session_state.engine_error)
        st.stop()

    display_conversation_history()

    if not st.session_state.interview_complete:
        if not st.session_state.conversation_history:
            result = asyncio.run(run_interview_step(""))
            if result:
                st.rerun()

        user_input = st.chat_input("답변을 입력하세요...")
        if user_input:
            with st.chat_message("user"):
                st.write(user_input)

            assistant_container = st.chat_message("assistant")
            response_placeholder = assistant_container.empty()
            response_placeholder.markdown("답변을 준비하고 있습니다...")

            result = asyncio.run(run_interview_step(user_input))
            if result:
                response_text = result.get("response", "")
                stream_assistant_response(response_text, response_placeholder)
                st.rerun()
            else:
                response_placeholder.markdown("죄송합니다. 처리 중 오류가 발생했습니다.")
    else:
        st.success("✅ 인터뷰가 완료되었습니다!")
        diagnosis = st.session_state.final_diagnosis
        if diagnosis:
            st.info(f"🔍 최종 진단: {diagnosis}")
        else:
            st.warning("최종 진단이 확정되지 않았습니다. 추가 질문이 필요합니다.")

        col1, col2 = st.columns(2)
        with col1:
            if st.button("📊 결과 분석 보기", type="primary"):
                st.switch_page("pages/result.py")
        with col2:
            if st.button("🔄 새 인터뷰 시작"):
                keys_to_clear = [
                    "session_id",
                    "interview_state",
                    "conversation_history",
                    "criteria_results",
                    "question_results",
                    "current_results",
                    "interview_complete",
                    "final_diagnosis",
                ]
                for key in keys_to_clear:
                    st.session_state.pop(key, None)
                st.rerun()

        st.chat_input("인터뷰가 완료되었습니다.", disabled=True)


if __name__ == "__main__":  # pragma: no cover - Streamlit 직접 실행 시
    main()
