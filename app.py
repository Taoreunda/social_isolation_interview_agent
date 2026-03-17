"""Main Streamlit Application."""

import sys
from pathlib import Path

# Add root directory to path BEFORE any local imports
ROOT_DIR = Path(__file__).resolve().parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import streamlit as st

from app_core.auth import render_user_badge, require_admin_login
from app_core.config import bootstrap

# Import after sys.path is set to avoid circular import issues
import interview.engine
InterviewEngine = interview.engine.InterviewEngine

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
    """Build Graphviz DOT for the 2-node ReAct agent graph."""
    try:
        engine = InterviewEngine()
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
    except Exception:
        # Fallback static DOT if engine can't be created (e.g., no API key)
        return """digraph LangGraph {
  "__start__" [label="start", shape=ellipse];
  "llm_call" [label="llm call", shape=box];
  "tool_node" [label="tool node", shape=box];
  "__end__" [label="end", shape=ellipse];
  "__start__" -> "llm_call";
  "llm_call" -> "tool_node" [label="tools"];
  "llm_call" -> "__end__" [label="end"];
  "tool_node" -> "llm_call";
}"""


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
            ReAct Agent (2노드 StateGraph):
            - `llm_call`: Agent 추론 + 평가표 tool 호출 결정
            - `tool_node`: scorecard tool 실행 (기입/수정/초기화/판정)
            """
        )
        st.graphviz_chart(_build_graphviz_dot(), width="stretch")

    st.markdown("##### 🔄 평가 흐름 예시")
    st.markdown(
        """
        1. Agent가 평가표에서 다음 미평가 항목을 확인하고 질문합니다.
        2. 사용자 답변을 평가 기준에 따라 판단하고 scorecard tool로 기입합니다.
        3. 모호한 답변에는 공감 표현과 함께 재질문합니다 (같은 항목 최대 3회).
        4. A3·B2·C2 기입 후 calculate를 호출하여 기준을 계산합니다.
        5. A·B·C 모두 비충족이면 조기 종료 → 일반 판정.
        6. 모든 항목 완료 후 교차 검토 → 보고서 작성 → 최종 진단.
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
