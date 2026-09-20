"""Suggested replies offered under the open question."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from interview.scorecard import Scorecard  # noqa: E402
from interview.suggestions import (  # noqa: E402
    open_question_id,
    suggested_replies_for,
)


def texts(question_id: str | None) -> list[str]:
    return [reply.text for reply in suggested_replies_for(question_id)]


def interview_with(statuses: dict[str, str], *, status: str = "active") -> SimpleNamespace:
    items = [
        SimpleNamespace(question_id=question_id, ai_status=statuses.get(question_id))
        for question_id in Scorecard().question_order
    ]
    return SimpleNamespace(status=status, scorecard_items=items)


def test_every_question_has_replies_that_split_its_cut_off() -> None:
    assert texts("A1") == ["예", "아니요"]
    assert texts("A2") == ["주 0회", "주 1회", "주 2회", "주 3회", "주 4회 이상"]
    assert texts("B1") == texts("C1") == ["0명", "1명", "2명", "3명 이상"]
    durations = ["1개월 미만", "1~3개월", "3~6개월", "6개월~1년", "1년 이상"]
    for question_id in ("A3", "B2", "C2", "D1_duration", "D2_duration"):
        assert texts(question_id) == durations
    assert texts("D1") == texts("D2") == ["없음", *(f"{score}점" for score in range(1, 11))]
    assert set(Scorecard().question_order) <= {
        question_id for question_id in Scorecard().question_order if texts(question_id)
    }


def test_a_free_response_offers_no_and_a_yes_that_asks_for_more() -> None:
    replies = suggested_replies_for("E1")

    assert [(reply.text, reply.send) for reply in replies] == [
        ("없습니다", True),
        ("있습니다", False),
    ]


def test_nothing_is_suggested_without_an_open_question() -> None:
    assert suggested_replies_for(None) == ()
    assert suggested_replies_for("unknown") == ()


def test_the_open_question_follows_the_scorecard_and_its_skips() -> None:
    assert open_question_id(interview_with({})) == "A1"
    assert open_question_id(interview_with({"A1": "positive"})) == "A2"
    answered = {question_id: "positive" for question_id in ("A1", "A2", "A3", "B1", "B2", "C1", "C2")}
    assert open_question_id(interview_with({**answered, "D1": "negative"})) == "D2"
    assert open_question_id(interview_with({}, status="completed")) is None
