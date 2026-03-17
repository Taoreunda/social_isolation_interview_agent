"""LangGraph 상태 관리를 위한 헬퍼."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from typing_extensions import NotRequired, TypedDict


class ConversationTurn(TypedDict, total=False):
    role: str
    content: str
    question_id: NotRequired[Optional[str]]
    timestamp: str
    rationale: NotRequired[Optional[str]]


class InterviewState(TypedDict, total=False):
    session_id: str
    incoming_user_input: str
    current_question_id: Optional[str]
    pending_question_id: Optional[str]
    awaiting_user_response: bool
    question_results: Dict[str, Dict[str, Any]]
    criteria_results: Dict[str, bool]
    conversation_history: List[ConversationTurn]
    clarification_attempts: Dict[str, int]
    transition: str
    last_answered_question_id: Optional[str]
    last_answer_status: Optional[str]
    final_diagnosis: Optional[str]
    interview_complete: bool
    last_bot_message: Optional[str]
    error: Optional[str]


class StateManager:
    """인터뷰 상태를 초기화하고 업데이트한다."""

    @staticmethod
    def create_initial_state(session_id: str) -> InterviewState:
        return InterviewState(
            session_id=session_id,
            incoming_user_input="",
            current_question_id=None,
            pending_question_id=None,
            awaiting_user_response=False,
            question_results={},
            criteria_results={},
            conversation_history=[],
            clarification_attempts={},
            transition="await_answer",
            last_answered_question_id=None,
            last_answer_status=None,
            final_diagnosis=None,
            interview_complete=False,
            last_bot_message=None,
            error=None,
        )

    @staticmethod
    def add_turn(
        state: InterviewState,
        role: str,
        content: str,
        question_id: Optional[str] = None,
        rationale: Optional[str] = None,
    ) -> None:
        state.setdefault("conversation_history", []).append(
            ConversationTurn(
                role=role,
                content=content,
                question_id=question_id,
                timestamp=datetime.utcnow().isoformat(timespec="seconds"),
                rationale=rationale,
            )
        )

    @staticmethod
    def record_question_result(
        state: InterviewState,
        question_id: str,
        evaluation: Dict[str, Any],
    ) -> None:
        results = state.setdefault("question_results", {})
        results[question_id] = {
            "status": evaluation.get("status"),
            "result": evaluation.get("result"),
            "extracted_value": evaluation.get("extracted_value"),
            "extracted_number": evaluation.get("extracted_number"),
            "extracted_months": evaluation.get("extracted_months"),
            "extracted_score": evaluation.get("extracted_score"),
            "rationale": evaluation.get("rationale"),
            "timestamp": datetime.utcnow().isoformat(timespec="seconds"),
        }

    @staticmethod
    def increment_clarification(state: InterviewState, question_id: str) -> int:
        attempts = state.setdefault("clarification_attempts", {})
        attempts[question_id] = attempts.get(question_id, 0) + 1
        return attempts[question_id]

    @staticmethod
    def reset_clarification(state: InterviewState, question_id: str) -> None:
        attempts = state.setdefault("clarification_attempts", {})
        attempts[question_id] = 0

    @staticmethod
    def get_clarification_attempts(state: InterviewState, question_id: str) -> int:
        return state.get("clarification_attempts", {}).get(question_id, 0)

    @staticmethod
    def get_timestamp() -> str:
        return datetime.utcnow().isoformat(timespec="seconds")
