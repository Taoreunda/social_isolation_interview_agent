"""The fixed welcome every interview opens with.

Each participant has to receive the same introduction, so it is written here
rather than left to the model. It is stored as the first messages of the
interview, one short bubble per entry, and the first question follows it.

It promises only what the interview can do. The interviewer speaks in fixed
question text and cannot answer a participant's own questions, so the welcome
does not invite them; it says an unclear question will be asked again.
"""

from __future__ import annotations

WELCOME_MESSAGES: tuple[str, ...] = (
    "안녕하세요, 반갑습니다. 저는 이 면담을 진행하는 AI입니다.",
    "최근 한 달 동안 어떻게 지내셨는지 열 가지 남짓 여쭤볼게요. "
    "10분 안팎이면 끝나고, 중간에 멈췄다가 이어서 하셔도 됩니다.",
    "질문마다 아래에 나오는 보기 중 하나를 고르시거나, 답변을 직접 입력하시면 됩니다.",
    "정답은 없어요. 질문이 어렵거나 잘 모르겠으면 \"잘 모르겠어요\"라고 하셔도 됩니다. 다시 여쭤볼게요.",
)

__all__ = ["WELCOME_MESSAGES"]
