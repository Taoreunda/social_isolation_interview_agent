"""The fixed welcome every interview opens with.

Each participant has to receive the same introduction, so it is written here
rather than left to the model. It is stored as the first messages of the
interview, one short bubble per entry, and the first question follows it:
three bubbles in all.

It promises only what the interview can do. The interviewer speaks in fixed
question text and cannot answer a participant's own questions, so the welcome
does not invite them.
"""

from __future__ import annotations

WELCOME_MESSAGES: tuple[str, ...] = (
    "안녕하세요, 반갑습니다. 저는 이 면담을 진행하는 AI입니다. "
    "최근 한 달 동안 어떻게 지내셨는지 열 가지 남짓 여쭤볼게요.",
    "질문마다 아래 보기에서 고르시거나 직접 입력하시면 됩니다. "
    "정답은 없으니 편하게 답해 주세요. 10분 안팎이면 끝납니다.",
)

__all__ = ["WELCOME_MESSAGES"]
