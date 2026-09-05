"""Tests for rebuilding a durable interview turn around the existing graph."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any

import pytest
from langchain_core.messages import AIMessage

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from interview.engine import InterviewEngine, InterviewGenerationError
from interview.scorecard import Scorecard


class FakeGraph:
    def __init__(
        self,
        result_scorecard: dict[str, Any],
        *,
        model_message: str = "다음 질문입니다.",
        interview_complete: bool = False,
    ) -> None:
        self.result_scorecard = result_scorecard
        self.model_message = model_message
        self.interview_complete = interview_complete
        self.received_state: dict[str, Any] | None = None

    async def ainvoke(self, state: dict[str, Any]) -> dict[str, Any]:
        self.received_state = state
        return {
            **state,
            "messages": state["messages"] + [AIMessage(content=self.model_message)],
            "scorecard": self.result_scorecard,
            "interview_complete": self.interview_complete,
        }


def make_engine(graph: Any) -> InterviewEngine:
    engine = InterviewEngine.__new__(InterviewEngine)
    engine.graph = graph
    return engine


def test_persisted_turn_rebuilds_visible_history_and_returns_serializable_state() -> None:
    scorecard = Scorecard()
    scorecard.record("A1", "positive", "예", "집에 머뭄")
    expected_scorecard = scorecard.to_dict()
    graph = FakeGraph(expected_scorecard)
    engine = make_engine(graph)

    result = asyncio.run(
        engine.run_persisted_turn(
            session_id="interview-1",
            messages=[
                {"role": "assistant", "content": "첫 질문입니다."},
                {"role": "user", "content": "첫 답변입니다."},
            ],
            scorecard=Scorecard().to_dict(),
            user_input="두 번째 답변입니다.",
        )
    )

    assert graph.received_state is not None
    assert [message.type for message in graph.received_state["messages"]] == [
        "ai",
        "human",
        "human",
    ]
    assert [message.content for message in graph.received_state["messages"]] == [
        "첫 질문입니다.",
        "첫 답변입니다.",
        "두 번째 답변입니다.",
    ]
    assert result.participant_message == expected_scorecard["items"]["A2"]["question"]
    assert result.scorecard == expected_scorecard
    assert result.interview_complete is False
    assert result.final_diagnosis is None
    assert isinstance(result.scorecard, dict)


def test_empty_initial_turn_uses_a_hidden_trigger_only_for_graph_input() -> None:
    graph = FakeGraph(Scorecard().to_dict())
    engine = make_engine(graph)

    result = asyncio.run(
        engine.run_persisted_turn(
            session_id="interview-2",
            messages=[],
            scorecard=Scorecard().to_dict(),
            user_input="",
        )
    )

    assert graph.received_state is not None
    assert len(graph.received_state["messages"]) == 1
    assert graph.received_state["messages"][0].type == "human"
    assert graph.received_state["messages"][0].content.startswith("[시스템]")
    assert result.participant_message == Scorecard().items["A1"]["question"]


def test_model_text_cannot_disclose_assessment_to_participant() -> None:
    scorecard = Scorecard()
    scorecard.record("A1", "positive", "예", "민감한 판단 근거")
    graph = FakeGraph(
        scorecard.to_dict(),
        model_message="A1은 양성이고 판단 근거는 민감한 판단 근거입니다.",
    )
    engine = make_engine(graph)

    result = asyncio.run(
        engine.run_persisted_turn(
            session_id="interview-safe-question",
            messages=[{"role": "assistant", "content": "첫 질문"}],
            scorecard=Scorecard().to_dict(),
            user_input="예",
        )
    )

    assert result.participant_message == scorecard.items["A2"]["question"]
    assert "양성" not in result.participant_message
    assert "판단 근거" not in result.participant_message


def test_completed_turn_uses_neutral_participant_message_and_keeps_private_report() -> None:
    scorecard = Scorecard()
    scorecard.diagnosis = "사회적 고립"
    private_report = "최종 진단은 사회적 고립이며 내부 판단 근거는 다음과 같습니다."
    graph = FakeGraph(
        scorecard.to_dict(),
        model_message=private_report,
        interview_complete=True,
    )
    engine = make_engine(graph)

    result = asyncio.run(
        engine.run_persisted_turn(
            session_id="interview-safe-completion",
            messages=[{"role": "assistant", "content": "마지막 질문"}],
            scorecard=Scorecard().to_dict(),
            user_input="마지막 답변",
        )
    )

    assert result.participant_message == "인터뷰가 완료되었습니다. 참여해 주셔서 감사합니다."
    assert "사회적 고립" not in result.participant_message
    assert result.report == private_report


def test_provider_failure_is_wrapped_without_exposing_provider_details() -> None:
    class FailingGraph:
        async def ainvoke(self, state: dict[str, Any]) -> dict[str, Any]:
            raise RuntimeError("secret provider response")

    engine = make_engine(FailingGraph())

    with pytest.raises(InterviewGenerationError) as raised:
        asyncio.run(
            engine.run_persisted_turn(
                session_id="interview-3",
                messages=[],
                scorecard=Scorecard().to_dict(),
                user_input="",
            )
        )

    assert "secret provider response" not in str(raised.value)
