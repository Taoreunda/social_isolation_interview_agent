"""The fixed welcome every interview opens with.

Each participant has to receive the same introduction, so it is written here
rather than left to the model. It is stored as the first messages of the
interview, one bubble per entry, and the first question follows it.
"""

from __future__ import annotations

WELCOME_MESSAGES: tuple[str, ...] = (
    "안녕하세요, 반갑습니다. 저는 이 면담을 진행하는 AI입니다.",
    "최근 한 달 동안 어떻게 지내셨는지 열 가지 남짓 여쭤볼 거예요. 10분 안팎이면 끝납니다.",
    "정답은 없습니다. 짧게 답하셔도 되고, 잘 모르겠으면 모르겠다고 하셔도 괜찮아요. "
    "중간에 멈췄다가 나중에 이어서 하셔도 됩니다.",
    "그럼 첫 질문 드릴게요.",
)

__all__ = ["WELCOME_MESSAGES"]
