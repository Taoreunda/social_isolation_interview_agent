"""2노드 ReAct agent 기반 인터뷰 엔진."""

from __future__ import annotations

import logging
import operator
from typing import Annotated, Any, Dict, Optional

from langchain.chat_models import init_chat_model
from langchain_core.messages import AnyMessage, SystemMessage, ToolMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict

from .scorecard import Scorecard
from .tools import scorecard_tool, execute_scorecard_action
from logs.interview_logger import InterviewLogger
from storage.json_storage import JSONStorage
from app_core.config import bootstrap, get_config_value

logger = logging.getLogger(__name__)

bootstrap()

MAX_TURNS = 50


class InterviewState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    scorecard: dict
    interview_complete: bool
    session_id: str


# Intro message shown at start of interview
INTRO_MESSAGE = (
    "지금부터 지난 한 달간의 생활을 토대로 사회적 고립 여부를 평가하겠습니다.\n"
    "모호한 부분이 있다면 언제든 말씀해 주세요."
)

# System prompt template
SYSTEM_PROMPT_TEMPLATE = """당신은 사회적 고립 평가 면접관입니다.

## 역할
- 평가표의 미평가 항목을 순서대로 질문합니다.
- 사용자 답변을 평가 기준에 따라 판단하고, scorecard_tool로 기입합니다.
- 모호한 답변에는 공감 표현과 함께 재질문합니다 (같은 항목 최대 3회).
- 3회 초과 시 status="negative"로 기입합니다.

## 프로토콜
1. 질문은 반드시 1개씩만 합니다.
2. 답변 평가 후 scorecard_tool(action="record", ...) 호출합니다.
3. A3, B2, C2 기입 후 scorecard_tool(action="calculate") 호출합니다.
4. calculate 결과 early_stop=true이면 종료 안내 후 대화를 마칩니다.
5. D1이 negative면 D1_duration을 건너뛰고 D2로 진행합니다.
6. D2가 negative면 D2_duration을 건너뛰고 바로 scorecard_tool(action="calculate")를 호출합니다.
7. 모든 항목 기입 완료 후 교차 검토를 수행합니다.
8. E1/E2는 status 없이 value만 기록합니다 (action="record", status="recorded").

## 교차 검토 프로토콜
- 전체 답변의 일관성을 확인합니다 (E1/E2 포함).
- 모순 예시: A1="하루종일 집에 있음" vs A2="주 5회 외출" → 불일치
- 모순 발견 시: scorecard_tool(action="clear") → 재질문 1개 → scorecard_tool(action="record")
- 항목당 재질문은 최대 1개입니다.
- 검토 완료 후 최종 scorecard_tool(action="calculate") → 보고서 1문단 작성 후 종료합니다.

## 어조
- 존댓말 사용, 공감적이고 따뜻한 어조
- 재질문 시 짧은 공감 표현으로 시작 (예: "말씀해 주셔서 감사해요.")

## 현재 평가표
{scorecard_state}

## 현재 질문 평가 기준
{current_criteria}"""


class InterviewEngine:
    """2노드 StateGraph (llm_call + tool_node) 기반 인터뷰 엔진."""

    def __init__(self) -> None:
        self.storage = JSONStorage()
        self.session_loggers: Dict[str, InterviewLogger] = {}

        model_name = get_config_value("INTERVIEW_MODEL", "openai:gpt-4.1-mini")
        self.model = self._init_model(model_name)
        self.model_with_tools = self.model.bind_tools([scorecard_tool])
        self.graph = self._build_graph()

    def _init_model(self, model_name: str):
        """init_chat_model으로 LLM 초기화."""
        return init_chat_model(model_name, temperature=0.1)

    def _build_graph(self) -> Any:
        """2노드 StateGraph 빌드."""

        def llm_call(state: InterviewState) -> dict:
            sc = Scorecard.from_dict(state.get("scorecard", {}))
            system = self._build_system_prompt(sc)

            # Infinite loop guard
            if len(state.get("messages", [])) > MAX_TURNS * 2:
                logger.warning("Max turns exceeded, forcing end")
                return {
                    "messages": [SystemMessage(content="최대 턴 수를 초과했습니다. 인터뷰를 종료합니다.")],
                    "interview_complete": True,
                }

            messages = [SystemMessage(content=system)] + state.get("messages", [])
            response = self.model_with_tools.invoke(messages)

            return {"messages": [response]}

        def tool_node(state: InterviewState) -> dict:
            """커스텀 tool 노드: scorecard 직접 조작 후 state에 반영."""
            messages = state.get("messages", [])
            last = messages[-1]

            sc = Scorecard.from_dict(state.get("scorecard", {}))
            tool_messages = []

            for tc in last.tool_calls:
                args = tc["args"]
                result_text = execute_scorecard_action(
                    sc,
                    action=args.get("action", ""),
                    question_id=args.get("question_id"),
                    status=args.get("status"),
                    value=args.get("value"),
                    rationale=args.get("rationale"),
                )

                tool_messages.append(
                    ToolMessage(content=result_text, tool_call_id=tc["id"])
                )

            updates: dict = {
                "messages": tool_messages,
                "scorecard": sc.to_dict(),
            }

            if sc.diagnosis is not None:
                updates["interview_complete"] = True

            return updates

        def should_continue(state: InterviewState) -> str:
            """tool_calls가 있으면 tool_node, 없으면 END."""
            if state.get("interview_complete"):
                return "end"
            messages = state.get("messages", [])
            if not messages:
                return "end"
            last = messages[-1]
            if hasattr(last, "tool_calls") and last.tool_calls:
                return "tools"
            return "end"

        builder = StateGraph(InterviewState)
        builder.add_node("llm_call", llm_call)
        builder.add_node("tool_node", tool_node)

        builder.add_edge(START, "llm_call")
        builder.add_conditional_edges(
            "llm_call",
            should_continue,
            {"tools": "tool_node", "end": END},
        )
        builder.add_edge("tool_node", "llm_call")

        return builder.compile(checkpointer=MemorySaver())

    def _build_system_prompt(self, sc: Scorecard) -> str:
        """동적 system prompt 생성."""
        scorecard_state = sc.to_prompt()
        nxt = sc.next_unanswered()
        current_criteria = ""
        if nxt:
            criteria_text = sc.get_criteria_text(nxt)
            if criteria_text:
                current_criteria = f"[{nxt}] {sc.items[nxt]['question']}\n{criteria_text}"
            else:
                current_criteria = f"[{nxt}] {sc.items[nxt]['question']}"
        elif not sc.diagnosis:
            current_criteria = "모든 항목이 기입되었습니다. 교차 검토를 수행하세요."
        else:
            current_criteria = "진단이 완료되었습니다."

        return SYSTEM_PROMPT_TEMPLATE.format(
            scorecard_state=scorecard_state,
            current_criteria=current_criteria,
        )

    async def process_user_input(
        self, session_id: str, user_input: str
    ) -> Dict[str, Any]:
        """사용자 입력 처리. chat.py와의 인터페이스."""
        config = {"configurable": {"thread_id": session_id}}
        interview_logger = self._get_session_logger(session_id)

        graph_state = self.graph.get_state(config)

        if not graph_state.values:
            # First turn — initialize scorecard and send intro + first question
            sc = Scorecard()
            from langchain_core.messages import HumanMessage

            initial_messages = []
            if user_input:
                initial_messages = [HumanMessage(content=user_input)]
            else:
                # Empty input on first call → send intro prompt as user context
                initial_messages = [HumanMessage(content="인터뷰를 시작합니다.")]

            initial_state: InterviewState = {
                "messages": initial_messages,
                "scorecard": sc.to_dict(),
                "interview_complete": False,
                "session_id": session_id,
            }
            await self.graph.ainvoke(initial_state, config)
        else:
            from langchain_core.messages import HumanMessage

            if not user_input:
                # No input, return current state
                pass
            else:
                update = {"messages": [HumanMessage(content=user_input)]}
                await self.graph.ainvoke(update, config)

        # Always read full state from checkpointer
        result_state = self.graph.get_state(config).values

        # Extract last assistant message
        response = self._extract_last_assistant_message(result_state)

        # Log the turn
        interview_logger.log_turn(
            node="llm_call",
            user_input=user_input,
            llm_response=response,
            evaluation_result=None,
            state_summary=self._summarise_state(result_state),
        )

        # Check if interview is complete and save results
        is_complete = result_state.get("interview_complete", False)
        sc_data = result_state.get("scorecard", {})
        sc = Scorecard.from_dict(sc_data)
        final_diagnosis = sc.diagnosis

        if is_complete and final_diagnosis:
            payload = sc.to_result_payload(
                messages=result_state.get("messages", []),
                session_id=session_id,
            )
            self.storage.save_interview_result(session_id, payload)

        # Build conversation history for chat.py compatibility
        conversation = self._build_conversation_history(result_state)

        return {
            "response": response,
            "conversation": conversation,
            "criteria_results": {
                k: v for k, v in sc.criteria.items() if v is not None
            },
            "question_results": self._build_question_results(sc),
            "interview_complete": is_complete,
            "final_diagnosis": final_diagnosis,
            "state": result_state,
        }

    def reset_session(self, session_id: str) -> None:
        """세션 초기화."""
        if session_id in self.session_loggers:
            del self.session_loggers[session_id]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _extract_last_assistant_message(self, state: dict) -> str:
        """Extract last AI message content from state."""
        messages = state.get("messages", [])
        for msg in reversed(messages):
            if hasattr(msg, "type") and msg.type == "ai" and msg.content:
                return msg.content
        return ""

    def _build_conversation_history(self, state: dict) -> list:
        """Build conversation history compatible with chat.py display."""
        history = []
        for msg in state.get("messages", []):
            if not hasattr(msg, "type") or not hasattr(msg, "content"):
                continue
            if msg.type == "tool":
                continue
            if not msg.content:
                continue
            role = "user" if msg.type == "human" else "assistant"
            history.append({"role": role, "content": msg.content})
        return history

    def _build_question_results(self, sc: Scorecard) -> Dict[str, Dict]:
        """Build question_results dict compatible with result.py."""
        results = {}
        for qid, item in sc.items.items():
            if item["status"] is None:
                continue
            results[qid] = {
                "status": item["status"],
                "extracted_value": item["value"],
                "rationale": item["rationale"],
                "timestamp": item.get("timestamp"),
            }
        return results

    def _get_session_logger(self, session_id: str) -> InterviewLogger:
        if session_id not in self.session_loggers:
            self.session_loggers[session_id] = InterviewLogger(session_id)
        return self.session_loggers[session_id]

    def _summarise_state(self, state: dict) -> Dict[str, Any]:
        sc_data = state.get("scorecard", {})
        sc = Scorecard.from_dict(sc_data)
        return {
            "session_id": state.get("session_id"),
            "next_question": sc.next_unanswered(),
            "criteria": {k: v for k, v in sc.criteria.items() if v is not None},
            "diagnosis": sc.diagnosis,
            "message_count": len(state.get("messages", [])),
        }
