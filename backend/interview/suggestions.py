"""Replies a participant can tap instead of typing.

Each set splits the question at its cut-off and reads as the coded value the
scorecard keeps, so a tapped reply is judged the same way a typed one is. The
composer stays available: the interview is semi-structured, and a participant's
own words remain the evidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .scorecard import Scorecard


@dataclass(frozen=True)
class SuggestedReply:
    text: str
    # False puts the text in the composer for the participant to finish
    # instead of sending it as it is.
    send: bool = True


def _replies(*texts: str) -> tuple[SuggestedReply, ...]:
    return tuple(SuggestedReply(text) for text in texts)


# Yes/no and free-response questions offer whole sentences, so a reply reads as
# something to say. Each pair is the same length and register, so neither one
# looks like the expected answer.
_STAYED_HOME = _replies("예, 대부분 집이나 방에서 보냈어요", "아니요, 밖에서 보낸 시간이 더 많았어요")
# The cut-off is four outings a week, so the two replies meet there: "3회 이하"
# rather than "3회 미만", which would leave exactly three without a reply.
_TIMES_A_WEEK = _replies("주 3회 이하", "주 4회 이상")
_PEOPLE = _replies("0명", "1명", "2명", "3명 이상")
# A3 turns at six months and the other durations at three; these five steps split both.
_DURATION = _replies("1개월 미만", "1~3개월", "3~6개월", "6개월~1년", "1년 이상")
_SCORE = _replies("없음", *(f"{score}점" for score in range(1, 11)))
_COUNSELLING = (SuggestedReply("아니요, 받은 적 없어요"), SuggestedReply("네, 받은 적 있어요", send=False))
_ILLNESS = (SuggestedReply("아니요, 없어요"), SuggestedReply("네, 있어요", send=False))

SUGGESTED_REPLIES: dict[str, tuple[SuggestedReply, ...]] = {
    "A1": _STAYED_HOME,
    "A2": _TIMES_A_WEEK,
    "A3": _DURATION,
    "B1": _PEOPLE,
    "B2": _DURATION,
    "C1": _PEOPLE,
    "C2": _DURATION,
    "D1": _SCORE,
    "D1_duration": _DURATION,
    "D2": _SCORE,
    "D2_duration": _DURATION,
    "E1": _COUNSELLING,
    "E2": _ILLNESS,
}


def suggested_replies_for(question_id: str | None) -> tuple[SuggestedReply, ...]:
    if question_id is None:
        return ()
    return SUGGESTED_REPLIES.get(question_id, ())


def was_offered(question_id: str | None, content: str) -> bool:
    """Whether this exact text was a reply the participant could send with one tap."""
    return any(
        reply.send and reply.text == content
        for reply in suggested_replies_for(question_id)
    )


class _ScoredItem(Protocol):
    question_id: str
    ai_status: str | None


class _ScoredInterview(Protocol):
    status: str
    scorecard_items: list[_ScoredItem]


def open_question_id(interview: _ScoredInterview) -> str | None:
    """The question the participant is being asked, skips included."""
    if interview.status != "active":
        return None
    scorecard = Scorecard()
    for item in interview.scorecard_items:
        if item.question_id in scorecard.items:
            scorecard.items[item.question_id]["status"] = item.ai_status
    return scorecard.next_unanswered()


__all__ = [
    "SUGGESTED_REPLIES",
    "SuggestedReply",
    "open_question_id",
    "suggested_replies_for",
    "was_offered",
]
