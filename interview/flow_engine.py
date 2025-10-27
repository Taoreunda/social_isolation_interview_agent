"""LangGraph 기반 인터뷰 실행 엔진 (통합 노드 버전)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional

from pydantic import BaseModel, ValidationError
from langchain_core.prompts import PromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from .controller import InterviewController, QuestionConfig
from .state_manager import InterviewState, StateManager
from logs.interview_logger import InterviewLogger
from storage.json_storage import JSONStorage
from app_core.config import bootstrap, get_config_value

logger = logging.getLogger(__name__)

bootstrap()


class EvaluationOutput(BaseModel):
    status: str
    result: Optional[str] = None
    extracted_value: Optional[Any] = None
    extracted_number: Optional[int] = None
    extracted_months: Optional[int] = None
    extracted_score: Optional[int] = None
    clarification_question: Optional[str] = None
    rationale: Optional[str] = None


class InterviewFlowEngineV2:
    """LangGraph StateGraph를 활용한 최신 인터뷰 엔진."""

    INTRO_MESSAGE = (
        "지금부터 지난 한 달간의 생활을 토대로 사회적 고립 여부를 평가하겠습니다.\n"
        "모호한 부분이 있다면 언제든 말씀해 주세요."
    )

    def __init__(self) -> None:
        self.controller = InterviewController()
        self.state_manager = StateManager()
        self.storage = JSONStorage()

        self.llm = self._init_llm()
        self.graph = self._build_graph()

        self.session_loggers: Dict[str, InterviewLogger] = {}

    def _init_llm(self) -> ChatGoogleGenerativeAI:
        api_key = get_config_value("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError("GOOGLE_API_KEY 환경 변수가 설정되어 있지 않습니다.")

        logger.debug("GOOGLE_API_KEY loaded (length=%s)", len(api_key))

        return ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=api_key,
            temperature=0.1,
            max_output_tokens=1024,
            timeout=30,
        )

    def _build_graph(self) -> StateGraph:
        builder = StateGraph(InterviewState)

        builder.add_node("question_handler", self._question_handler_node)
        builder.add_node("rule_evaluator", self._rule_evaluator_node)
        builder.add_node("stop_rule_checker", self._stop_rule_checker_node)
        builder.add_node("final_diagnosis", self._final_diagnosis_node)
        builder.add_node("interview_complete", self._interview_complete_node)

        builder.add_edge(START, "question_handler")

        builder.add_conditional_edges(
            "question_handler",
            self._route_from_question_handler,
            {
                "await_answer": END,
                "evaluate_rules": "rule_evaluator",
                "finalize": "final_diagnosis",
            },
        )

        builder.add_conditional_edges(
            "rule_evaluator",
            self._route_from_rule_evaluator,
            {
                "early_check": "stop_rule_checker",
                "ask_next": "question_handler",
                "finalize": "final_diagnosis",
            },
        )

        builder.add_conditional_edges(
            "stop_rule_checker",
            self._route_from_stop_checker,
            {
                "terminate": "final_diagnosis",
                "continue": "question_handler",
            },
        )

        builder.add_edge("final_diagnosis", "interview_complete")
        builder.add_edge("interview_complete", END)

        return builder.compile(checkpointer=MemorySaver())

    async def _question_handler_node(self, state: InterviewState) -> InterviewState:
        session_id = state["session_id"]
        interview_logger = self._get_session_logger(session_id)

        user_input = (state.get("incoming_user_input") or "").strip()
        awaiting_answer = state.get("awaiting_user_response", False)
        current_question_id = state.get("current_question_id")

        # 최초 진입 혹은 다음 질문 준비
        if not awaiting_answer:
            next_question = self._determine_next_question(state)
            if not next_question:
                state["transition"] = "finalize"
                state["pending_question_id"] = None
                return state

            state["current_question_id"] = next_question.id
            state["pending_question_id"] = next_question.id
            state["awaiting_user_response"] = True

            # 첫 질문 전 안내 문구 제공
            if not state.get("conversation_history"):
                self.state_manager.add_turn(state, "assistant", self.INTRO_MESSAGE)

            self.state_manager.add_turn(
                state,
                role="assistant",
                content=next_question.text,
                question_id=next_question.id,
            )
            state["last_bot_message"] = next_question.text
            state["transition"] = "await_answer"
            interview_logger.log_turn(
                node="question_handler",
                user_input="[PROMPT]",
                llm_response=next_question.text,
                evaluation_result=None,
                state_summary=self._summarise_state(state),
            )
            return state

        # 사용자 입력이 아직 없는 경우
        if not user_input:
            state["transition"] = "await_answer"
            return state

        question = self.controller.get_question(current_question_id)
        if not question:
            logger.error("Unknown question id: %s", current_question_id)
            state["transition"] = "finalize"
            return state

        self.state_manager.add_turn(
            state,
            role="user",
            content=user_input,
            question_id=current_question_id,
        )

        evaluation = await self._evaluate_response(state, question, user_input, interview_logger)
        status = evaluation.get("status", "clarification_needed")

        if status == "clarification_needed":
            attempts = self.state_manager.increment_clarification(state, question.id)
            if attempts >= question.max_clarifications:
                status = "negative"
                evaluation["status"] = status
                evaluation.pop("clarification_question", None)
                evaluation.setdefault("rationale", "clarification attempts exceeded")
                logger.warning("Max clarification attempts reached for %s", question.id)
            else:
                clarification = evaluation.get("clarification_question")
                if not clarification:
                    logger.error(
                        "LLM did not provide clarification for %s despite status clarification_needed",
                        question.id,
                    )
                    raise RuntimeError(
                        f"Clarification required for {question.id} but LLM response missing"
                    )
                self.state_manager.add_turn(
                    state,
                    role="assistant",
                    content=clarification,
                    question_id=question.id,
                )
                state["incoming_user_input"] = ""
                state["transition"] = "await_answer"
                interview_logger.log_turn(
                    node="question_handler",
                    user_input=user_input,
                    llm_response=clarification,
                    evaluation_result=evaluation,
                    state_summary=self._summarise_state(state),
                )
                return state

        # 답변 평가 결과 기록
        self.state_manager.record_question_result(state, question.id, evaluation)
        self.state_manager.reset_clarification(state, question.id)

        state["incoming_user_input"] = ""
        state["awaiting_user_response"] = False
        state["pending_question_id"] = None
        state["last_answered_question_id"] = question.id
        state["last_answer_status"] = status

        interview_logger.log_turn(
            node="question_handler",
            user_input=user_input,
            llm_response="[ANSWER_RECORDED]",
            evaluation_result=evaluation,
            state_summary=self._summarise_state(state),
        )

        if status == "recorded":
            state["transition"] = "evaluate_rules"
            return state

        next_question = self.controller.next_question(question.id, status)
        if not next_question:
            state["transition"] = "finalize"
            return state

        state["pending_question_id"] = next_question.id
        state["transition"] = "evaluate_rules"
        return state

    async def _rule_evaluator_node(self, state: InterviewState) -> InterviewState:
        question_results = state.get("question_results", {})
        criteria_snapshot = state.get("criteria_results", {})
        evaluated = self.controller.evaluate_criteria(question_results)

        if evaluated:
            criteria_snapshot.update(evaluated)
            state["criteria_results"] = criteria_snapshot

        if state.get("final_diagnosis"):
            state["transition"] = "finalize"
            return state

        if self.controller.has_abc(criteria_snapshot):
            state["transition"] = "early_check"
        else:
            state["transition"] = "ask_next"
        return state

    async def _stop_rule_checker_node(self, state: InterviewState) -> InterviewState:
        criteria = state.get("criteria_results", {})
        if self.controller.should_stop_early(criteria):
            message = (
                "초기 평가 결과 A, B, C 기준이 모두 충족되지 않아 인터뷰를 종료합니다."
            )
            self.state_manager.add_turn(state, "assistant", message)
            state["final_diagnosis"] = "일반"
            state["interview_complete"] = True
            state["transition"] = "terminate"
            return state

        state["transition"] = "continue"
        return state

    async def _final_diagnosis_node(self, state: InterviewState) -> InterviewState:
        if not state.get("final_diagnosis"):
            criteria = state.get("criteria_results", {})
            state["final_diagnosis"] = self.controller.get_final_diagnosis(criteria)

        diagnosis = state.get("final_diagnosis")

        if diagnosis:
            message = f"인터뷰가 완료되었습니다. 최종 진단: {diagnosis}."
            self.state_manager.add_turn(state, "assistant", message)
            state["interview_complete"] = True
        else:
            fallback_message = "수집된 정보만으로는 최종 진단을 내리기 어렵습니다. 추가 평가가 필요합니다."
            self.state_manager.add_turn(
                state,
                "assistant",
                fallback_message,
            )
            state["final_diagnosis"] = "추가 평가 필요"
            state["interview_complete"] = True

        state["transition"] = "complete"
        return state

    async def _interview_complete_node(self, state: InterviewState) -> InterviewState:
        payload = {
            "final_diagnosis": state.get("final_diagnosis"),
            "criteria_results": state.get("criteria_results", {}),
            "question_results": state.get("question_results", {}),
            "conversation_history": state.get("conversation_history", []),
            "total_clarifications": sum(
                state.get("clarification_attempts", {}).values()
            ),
            "conversation_length": len(state.get("conversation_history", [])),
        }

        self.storage.save_interview_result(state["session_id"], payload)
        state["transition"] = "done"
        return state

    async def process_user_input(self, session_id: str, user_input: str) -> Dict[str, Any]:
        config = {"configurable": {"thread_id": session_id}}
        graph_state = self.graph.get_state(config)

        if not graph_state.values:
            initial_state = self.state_manager.create_initial_state(session_id)
            initial_state["incoming_user_input"] = user_input
            result_state = await self.graph.ainvoke(initial_state, config)
        else:
            update = {"incoming_user_input": user_input}
            result_state = await self.graph.ainvoke(update, config)

        response = self._extract_last_assistant_message(result_state)

        return {
            "response": response,
            "conversation": result_state.get("conversation_history", []),
            "criteria_results": result_state.get("criteria_results", {}),
            "question_results": result_state.get("question_results", {}),
            "interview_complete": result_state.get("interview_complete", False),
            "final_diagnosis": result_state.get("final_diagnosis"),
            "state": result_state,
        }

    def reset_session(self, session_id: str) -> None:
        if session_id in self.session_loggers:
            del self.session_loggers[session_id]

    # ---------------------------------------------------------------------
    # 내부 유틸리티
    # ---------------------------------------------------------------------

    def _determine_next_question(self, state: InterviewState) -> Optional[QuestionConfig]:
        pending_id = state.get("pending_question_id")
        if pending_id:
            return self.controller.get_question(pending_id)

        if not state.get("question_results"):
            return self.controller.first_question()

        last_id = state.get("last_answered_question_id")
        last_status = state.get("last_answer_status") or "negative"
        if last_id:
            return self.controller.next_question(last_id, last_status)
        return None

    async def _evaluate_response(
        self,
        state: InterviewState,
        question: QuestionConfig,
        user_input: str,
        interview_logger: InterviewLogger,
    ) -> Dict[str, Any]:
        if not question.use_llm:
            return {
                "status": "recorded",
                "extracted_value": user_input,
                "rationale": "자유 응답 기록",
            }

        prompt = PromptTemplate.from_template(question.prompt_template or "{user_input}")
        structured_llm = self.llm.with_structured_output(EvaluationOutput)
        chain = prompt | structured_llm

        max_attempts = 1
        for attempt in range(1, max_attempts + 1):
            try:
                result_obj = await asyncio.to_thread(chain.invoke, {"user_input": user_input})
                if result_obj is None:
                    raise ValueError(
                        f"LLM returned no structured result for {question.id}"
                    )
                result = result_obj.dict(exclude_none=True)
                if not result.get("rationale"):
                    result["rationale"] = self._build_rationale(question, result, user_input)
                interview_logger.log_llm_call(
                    prompt=question.prompt_template or "",
                    user_input=user_input,
                    response=str(result),
                    error=None,
                    attempt=attempt,
                )

                conflict_message = self._detect_conflict(state, question, result)
                if conflict_message:
                    interview_logger.log_turn(
                        node="question_handler",
                        user_input=user_input,
                        llm_response=conflict_message,
                        evaluation_result={"status": "clarification_needed", "rationale": "conflict_detected"},
                        state_summary=self._get_state_summary(state),
                    )
                    return {
                        "status": "clarification_needed",
                        "clarification_question": conflict_message,
                        "rationale": "conflict_with_previous_answer",
                    }
                return result

            except ValidationError as exc:
                logger.warning(
                    "JSON parsing error on %s (attempt %s/%s): %s",
                    question.id,
                    attempt,
                    max_attempts,
                    exc,
                )
                interview_logger.log_llm_call(
                    prompt=question.prompt_template or "",
                    user_input=user_input,
                    response=None,
                    error=f"parser_error_attempt_{attempt}: {exc}",
                    attempt=attempt,
                )
                return self._fallback_clarification(state, question, user_input, interview_logger)
            except Exception as exc:  # pragma: no cover - LLM 호출 오류는 런타임 의존
                logger.error(
                    "LLM invocation error on %s (attempt %s/%s): %s",
                    question.id,
                    attempt,
                    max_attempts,
                    exc,
                )
                interview_logger.log_llm_call(
                    prompt=question.prompt_template or "",
                    user_input=user_input,
                    response=None,
                    error=f"llm_error_attempt_{attempt}: {exc}",
                    attempt=attempt,
                )
                return self._fallback_clarification(state, question, user_input, interview_logger)
        return self._fallback_clarification(state, question, user_input, interview_logger)

    def _detect_conflict(
        self,
        state: InterviewState,
        question: QuestionConfig,
        new_result: Dict[str, Any],
    ) -> Optional[str]:
        previous = state.get("question_results", {}).get(question.id)
        if not previous:
            return None

        prev_status = previous.get("status")
        new_status = new_result.get("status")
        if (
            prev_status in {"positive", "negative"}
            and new_status in {"positive", "negative"}
            and prev_status != new_status
        ):
            return (
                f"이전에 '{self._describe_answer(previous)}'라고 하셨는데, 방금 답변은 다르게 들립니다."
                " 어떤 정보가 정확한지 다시 확인해 주실 수 있을까요?"
            )

        prev_value = previous.get("extracted_value")
        if prev_value is None:
            prev_value = (
                previous.get("extracted_number")
                or previous.get("extracted_months")
                or previous.get("extracted_score")
            )
        new_value = new_result.get("extracted_value")
        if new_value is None:
            new_value = (
                new_result.get("extracted_number")
                or new_result.get("extracted_months")
                or new_result.get("extracted_score")
            )

        if prev_value is not None and new_value is not None and prev_value != new_value:
            return (
                f"이전에 '{prev_value}'라고 말씀하셨는데 이번에는 '{new_value}'라고 하셨어요."
                " 어느 쪽이 정확한지 알려주실 수 있을까요?"
            )

        return None

    @staticmethod
    def _describe_answer(answer: Dict[str, Any]) -> str:
        value = answer.get("extracted_value")
        if value is None:
            value = (
                answer.get("extracted_number")
                or answer.get("extracted_months")
                or answer.get("extracted_score")
            )
        status = answer.get("status")
        if value is not None:
            return str(value)
        if status:
            return status
        return "이전 답변"

    def _build_rationale(
        self,
        question: QuestionConfig,
        result: Dict[str, Any],
        user_input: str,
    ) -> str:
        status = result.get("status")
        value = (
            result.get("extracted_value")
            or result.get("extracted_number")
            or result.get("extracted_months")
            or result.get("extracted_score")
        )

        if status == "positive" and value is not None:
            return f"사용자 답변('{value}')이 기준을 충족해 긍정으로 판단했습니다."
        if status == "negative" and value is not None:
            return f"사용자 답변('{value}')이 기준에 미달해 부정으로 판단했습니다."
        if status == "clarification_needed":
            return "답변이 모호하여 추가 정보가 필요합니다."
        if status:
            return f"사용자 답변('{user_input}')을 바탕으로 {status} 판정입니다."
        return "사용자 답변을 기준으로 판단했습니다."

    def _extract_last_assistant_message(self, state: InterviewState) -> str:
        for message in reversed(state.get("conversation_history", [])):
            if message.get("role") == "assistant":
                return message.get("content", "")
        return ""

    def _fallback_clarification(
        self,
        state: InterviewState,
        question: QuestionConfig,
        user_input: str,
        interview_logger: InterviewLogger,
    ) -> Dict[str, Any]:
        clarification = (
            "말씀해 주셔서 감사합니다. 질문에 대해 조금 더 구체적으로 말씀해 주실 수 있을까요?"
        )
        if question.text:
            clarification = (
                "말씀해 주셔서 감사합니다. "
                f"'{question.text}'에 대해 조금 더 자세히 설명해 주실 수 있을까요?"
            )
        interview_logger.log_turn(
            node="question_handler",
            user_input=user_input,
            llm_response=clarification,
            evaluation_result={
                "status": "clarification_needed",
                "rationale": "llm_fallback",
            },
            state_summary=self._summarise_state(state),
        )
        return {
            "status": "clarification_needed",
            "clarification_question": clarification,
            "rationale": "llm_fallback",
        }

    def _route_from_question_handler(self, state: InterviewState) -> str:
        transition = state.get("transition", "await_answer")
        if transition == "evaluate_rules":
            return "evaluate_rules"
        if transition == "finalize":
            return "finalize"
        return "await_answer"

    def _route_from_rule_evaluator(self, state: InterviewState) -> str:
        transition = state.get("transition", "ask_next")
        if transition == "early_check":
            return "early_check"
        if transition == "finalize":
            return "finalize"
        return "ask_next"

    def _route_from_stop_checker(self, state: InterviewState) -> str:
        transition = state.get("transition", "continue")
        if transition == "terminate":
            return "terminate"
        return "continue"

    def _get_session_logger(self, session_id: str) -> InterviewLogger:
        if session_id not in self.session_loggers:
            self.session_loggers[session_id] = InterviewLogger(session_id)
        return self.session_loggers[session_id]

    def _summarise_state(self, state: InterviewState) -> Dict[str, Any]:
        return {
            "session_id": state.get("session_id"),
            "current_question": state.get("current_question_id"),
            "answered": len(state.get("question_results", {})),
            "criteria": state.get("criteria_results", {}),
            "final_diagnosis": state.get("final_diagnosis"),
        }
