"""2노드 ReAct agent 기반 인터뷰 엔진."""

from __future__ import annotations

import logging
import operator
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Annotated, Any, Dict

from langchain.chat_models import init_chat_model
from langchain_core.messages import (
    AIMessage,
    AnyMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict

from .scorecard import Scorecard
from .tools import scorecard_tool, execute_scorecard_action
from app_core.config import bootstrap, get_config_value

logger = logging.getLogger(__name__)

bootstrap()

MAX_TURNS = 50
INTERVIEW_COMPLETE_MESSAGE = "인터뷰가 완료되었습니다. 참여해 주셔서 감사합니다."


class InterviewGenerationError(RuntimeError):
    """Raised when a model turn cannot produce a safe committed response."""


@dataclass(frozen=True)
class EngineTurnResult:
    """Serializable output of one invocation-local interview graph run."""

    participant_message: str
    scorecard: dict[str, Any]
    interview_complete: bool
    final_diagnosis: str | None
    report: str | None


class InterviewState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    scorecard: dict
    interview_complete: bool
    session_id: str


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
        model_name = get_config_value("INTERVIEW_MODEL", "openai:gpt-4.1-mini")
        self.model = self._init_model(model_name)
        self.model_with_tools = self.model.bind_tools([scorecard_tool])
        self.graph = self._build_graph()

    def _init_model(self, model_name: str):
        """init_chat_model으로 LLM 초기화.

        OpenAI 호환 엔드포인트(Upstage Solar, Groq, OpenRouter, 로컬 Ollama 등)는
        INTERVIEW_BASE_URL / INTERVIEW_API_KEY 환경변수로 갈아끼울 수 있다.
        (모델 비의존적 설계 — 국산·로컬 모델 이식 시 코드 변경 불필요)
        """
        init_kwargs: Dict[str, Any] = {"temperature": 0.1}
        base_url = get_config_value("INTERVIEW_BASE_URL")
        if base_url:
            init_kwargs["base_url"] = base_url
        api_key = get_config_value("INTERVIEW_API_KEY")
        if api_key:
            init_kwargs["api_key"] = api_key
        return init_chat_model(model_name, **init_kwargs)

    def _build_graph(self) -> Any:
        """2노드 StateGraph 빌드."""

        def llm_call(state: InterviewState) -> dict:
            sc = Scorecard.from_dict(state.get("scorecard", {}))
            system = self._build_system_prompt(sc)

            # Infinite loop guard
            if len(state.get("messages", [])) > MAX_TURNS * 2:
                logger.warning("Max turns exceeded, forcing end")
                return {
                    "messages": [AIMessage(content="최대 턴 수를 초과했습니다. 인터뷰를 종료합니다.")],
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

        return builder.compile()

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

    async def run_persisted_turn(
        self,
        session_id: str,
        messages: Sequence[Mapping[str, str]],
        scorecard: dict[str, Any],
        user_input: str,
    ) -> EngineTurnResult:
        """Run one turn from committed state without memory or file persistence."""
        graph_messages: list[AnyMessage] = []
        for message in messages:
            role = message.get("role")
            content = message.get("content", "")
            if role == "user":
                graph_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                graph_messages.append(AIMessage(content=content))
            else:
                raise ValueError("Persisted messages must use user or assistant roles")

        if user_input:
            graph_messages.append(HumanMessage(content=user_input))
        elif not graph_messages:
            graph_messages.append(HumanMessage(content="[시스템] 인터뷰를 시작하세요."))
        else:
            raise ValueError("A resumed interview turn requires user input")

        initial_state: InterviewState = {
            "messages": graph_messages,
            "scorecard": scorecard,
            "interview_complete": False,
            "session_id": session_id,
        }

        try:
            result_state = await self.graph.ainvoke(initial_state)
        except Exception as exc:
            raise InterviewGenerationError(
                "인터뷰 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요."
            ) from exc

        private_model_message = self._extract_last_assistant_message(result_state).strip()
        if not private_model_message:
            raise InterviewGenerationError(
                "인터뷰 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요."
            )

        result_scorecard = result_state.get("scorecard", scorecard)
        restored_scorecard = Scorecard.from_dict(result_scorecard)
        is_complete = bool(result_state.get("interview_complete", False))
        report = restored_scorecard.report
        if is_complete and report is None:
            report = private_model_message

        participant_message = self._participant_message(
            restored_scorecard,
            interview_complete=is_complete,
        )

        return EngineTurnResult(
            participant_message=participant_message,
            scorecard=restored_scorecard.to_dict(),
            interview_complete=is_complete,
            final_diagnosis=restored_scorecard.diagnosis,
            report=report,
        )

    @staticmethod
    def _participant_message(
        scorecard: Scorecard,
        *,
        interview_complete: bool,
    ) -> str:
        """Return only canonical participant-safe text, never free-form model output."""
        if interview_complete:
            return INTERVIEW_COMPLETE_MESSAGE

        question_id = scorecard.next_unanswered()
        canonical = Scorecard()
        if question_id is None or question_id not in canonical.items:
            raise InterviewGenerationError(
                "인터뷰 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요."
            )
        return str(canonical.items[question_id]["question"]).strip()

    def _extract_last_assistant_message(self, state: dict) -> str:
        """Extract last AI message content from state."""
        messages = state.get("messages", [])
        for msg in reversed(messages):
            if hasattr(msg, "type") and msg.type == "ai" and msg.content:
                return msg.content
        return ""
