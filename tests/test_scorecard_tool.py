"""Protocol guards at the scorecard tool boundary.

The model proposes judgements; the interview protocol decides which question is
open. These tests pin the boundary so a question can never be scored before the
participant has been asked it.
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from interview.scorecard import Scorecard  # noqa: E402
from interview.tools import execute_scorecard_action  # noqa: E402


def test_record_is_refused_for_a_question_that_was_not_asked() -> None:
    scorecard = Scorecard()
    execute_scorecard_action(scorecard, "record", "A1", "positive", "예", "근거")

    result = execute_scorecard_action(
        scorecard, "record", "C1", "positive", "0", "B1 답변에서 추론함"
    )

    assert "오류" in result
    assert "A2" in result, "the tool must name the question that is actually open"
    assert scorecard.items["C1"]["status"] is None


def test_record_is_allowed_for_the_open_question() -> None:
    scorecard = Scorecard()

    result = execute_scorecard_action(
        scorecard, "record", "A1", "negative", "아니요", "명확히 아니라고 답함"
    )

    assert "오류" not in result
    assert scorecard.items["A1"]["status"] == "negative"


def test_update_cannot_fill_a_question_that_was_never_recorded() -> None:
    scorecard = Scorecard()

    result = execute_scorecard_action(
        scorecard, "update", "C1", "positive", "0", "묻지 않고 채우려는 시도"
    )

    assert "오류" in result
    assert scorecard.items["C1"]["status"] is None


def test_update_still_corrects_an_already_recorded_question() -> None:
    scorecard = Scorecard()
    execute_scorecard_action(scorecard, "record", "A1", "positive", "예", "처음 판단")

    result = execute_scorecard_action(
        scorecard, "update", "A1", "negative", "아니요", "재확인 후 정정"
    )

    assert "오류" not in result
    assert scorecard.items["A1"]["status"] == "negative"


def test_the_open_question_advances_only_as_answers_are_recorded() -> None:
    scorecard = Scorecard()
    asked: list[str] = []

    for status, value in (
        ("negative", "아니요"),
        ("positive", "주 2회"),
        ("positive", "1년"),
        ("positive", "0"),
    ):
        question_id = scorecard.next_unanswered()
        assert question_id is not None
        asked.append(question_id)
        execute_scorecard_action(
            scorecard, "record", question_id, status, value, "근거"
        )

    assert asked == ["A1", "A2", "A3", "B1"]
