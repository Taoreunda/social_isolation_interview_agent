"""
Main Streamlit Application
사회적 고립 인터뷰 에이전트 웹앱 메인 채팅 애플리케이션
"""

import os

import streamlit as st

from app_core.auth import render_user_badge, require_admin_login
from app_core.config import bootstrap, get_config_value
from interview.flow_engine import InterviewFlowEngineV2

# 정보 안내 페이지

# 페이지 설정
st.set_page_config(
    page_title="사회적 고립 인터뷰 안내",
    page_icon="🏠",
    layout="centered",
    initial_sidebar_state="expanded"
)

# 최소한의 CSS만 유지
st.markdown("""
<style>
    /* 불필요한 스타일 제거 */
</style>
""", unsafe_allow_html=True)

bootstrap()



def _build_graphviz_dot() -> str:
    class GraphOnlyEngine(InterviewFlowEngineV2):
        def _init_llm(self):  # noqa: D401
            class DummyLLM:
                def with_structured_output(self, schema):
                    class DummyStructured:
                        def __init__(self, schema):
                            self.schema = schema

                        def invoke(self, *args, **kwargs):  # pragma: no cover
                            raise RuntimeError("LLM이 구성되지 않았습니다.")

                    return DummyStructured(schema)

            return DummyLLM()

    try:
        engine = InterviewFlowEngineV2()
    except RuntimeError:
        if not get_config_value("GOOGLE_API_KEY"):
            os.environ.setdefault("GOOGLE_API_KEY", "dummy-key")
        engine = GraphOnlyEngine()

    graph = engine.graph.get_graph()
    lines = ["digraph LangGraph {"]
    for node in graph.nodes:
        label = node.replace("_", " ")
        shape = "ellipse" if node in {"__start__", "__end__"} else "box"
        lines.append(f'  "{node}" [label="{label}", shape={shape}];')

    for edge in graph.edges:
        label = edge.data or ""
        if label:
            lines.append(f'  "{edge.source}" -> "{edge.target}" [label="{label}"];')
        else:
            lines.append(f'  "{edge.source}" -> "{edge.target}";')

    lines.append("}")
    return "\n".join(lines)


def main():
    """메인 정보 안내 페이지"""

    if not require_admin_login("home"):
        st.stop()

    render_user_badge("home")

    # 헤더
    st.markdown("##### 📋 시스템 개요")
    st.markdown(
        "LangGraph와 Gemini 기반으로 사회적 고립·히키코모리 여부를 구조화된 질문과 clarification으로 평가합니다."
    )

    st.markdown("##### 📊 분류 결과")
    st.markdown(
        """
        - **🔴 히키코모리**: A+B+C+D 기준 모두 충족
        - **🟡 사회적 고립**: B+C+D 기준 충족
        - **🟢 일반**: 위 기준 전부 미충족
        """
    )

    with st.expander("🧭 인터뷰 그래프 구조", expanded=False):
        st.markdown(
            """
            LangGraph StateGraph의 주요 노드:
            - `question_handler`: 질문 진행 및 재질문 관리
            - `rule_evaluator`: A/B/C/D 기준 계산
            - `stop_rule_checker`: A/B/C가 모두 비충족인지 판정
            - `final_diagnosis`: 기준 통합 후 최종 분류 결정
            - `interview_complete`: 결과 저장 및 인터뷰 종료 처리
            """
        )
        st.graphviz_chart(_build_graphviz_dot(), width="stretch")

    st.markdown("##### 🔄 평가 흐름 예시")
    st.markdown(
        """
        1. 사용자가 답변하면 `question_handler`가 LLM 결과를 구조화하여 저장합니다.
        2. 판단이 명확하지 않거나 이전 답변과 상충하면 즉시 clarification을 요청합니다.
        3. 충분한 답변이 모이면 `rule_evaluator`가 A/B/C/D 기준을 계산합니다.
        4. A·B·C가 모두 비충족이면 `stop_rule_checker`가 조기 종료 → 일반 판정.
        5. 모든 기준에 대한 정보가 모이면 `final_diagnosis`에서 사회적 고립/히키코모리 여부를 확정하고, `interview_complete`가 결과를 저장합니다.
        """
    )


    # 시작 버튼
    st.markdown("---")
    _, col2, _ = st.columns([1, 2, 1])
    with col2:
        if st.button("🚀 인터뷰 시작하기", type="primary", width="stretch"):
            st.switch_page("pages/chat.py")


if __name__ == "__main__":
    main()
