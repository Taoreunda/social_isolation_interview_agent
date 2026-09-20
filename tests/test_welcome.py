"""The fixed welcome every interview opens with."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from interview.welcome import WELCOME_MESSAGES  # noqa: E402


def test_the_welcome_is_two_bubbles_so_the_first_question_makes_three() -> None:
    assert len(WELCOME_MESSAGES) == 2
    assert all(len(message) <= 80 for message in WELCOME_MESSAGES), (
        "each bubble has to read at a glance"
    )


def test_the_welcome_says_who_is_speaking_and_how_to_answer() -> None:
    text = " ".join(WELCOME_MESSAGES)

    assert "AI" in text
    assert "고르" in text and "입력" in text, "a participant may tap a reply or type one"


def test_the_welcome_promises_only_what_the_interview_can_do() -> None:
    # The interviewer speaks in fixed question text and cannot answer a
    # participant's own questions, so the welcome must not invite them. It also
    # leaves out any coaching about answering "I don't know".
    text = " ".join(WELCOME_MESSAGES)

    assert "물어보" not in text
    assert "모르겠" not in text
