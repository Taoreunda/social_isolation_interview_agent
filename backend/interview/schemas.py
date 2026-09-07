"""Protected interview request and response contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from auth.policy import Role
from auth.schemas import ApiSchema
from interview.models import Interview
from pydantic import Field, model_validator

InterviewStatus = Literal["active", "completed", "archived"]
ScoreDecision = Literal["positive", "negative", "recorded"]
ReviewStatus = Literal["unreviewed", "in_review", "reviewed"]


class InterviewMessageRequest(ApiSchema):
    client_turn_id: UUID
    content: str = Field(min_length=1, max_length=4000)

    @model_validator(mode="after")
    def reject_blank_content(self) -> InterviewMessageRequest:
        if not self.content.strip():
            raise ValueError("Message cannot be blank")
        return self


class InterviewMessageResponse(ApiSchema):
    id: UUID
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime


class ParticipantInterviewResponse(ApiSchema):
    id: UUID
    status: InterviewStatus
    progress: int
    updated_at: datetime
    messages: list[InterviewMessageResponse]


class InterviewListItemResponse(ApiSchema):
    id: UUID
    participant_code: str
    status: InterviewStatus
    progress: int
    review_status: ReviewStatus
    updated_at: datetime


class ScorecardRowResponse(ApiSchema):
    question_id: str
    question: str
    value: str | None
    rationale: str | None
    ai_status: ScoreDecision | None
    expert_status: ScoreDecision | None
    expert_rationale: str | None


class InterviewDetailResponse(InterviewListItemResponse):
    messages: list[InterviewMessageResponse]
    scorecard: list[ScorecardRowResponse]


class ReviewScorecardRequest(ApiSchema):
    action: Literal["approve", "override"]
    expert_status: Literal["positive", "negative"] | None = None
    rationale: str | None = Field(default=None, max_length=4000)


def participant_response(interview: Interview) -> ParticipantInterviewResponse:
    return ParticipantInterviewResponse(
        id=interview.id,
        status=interview.status,
        progress=interview.progress,
        updated_at=interview.updated_at,
        messages=[
            InterviewMessageResponse(
                id=message.id,
                role=message.role,
                content=message.content,
                created_at=message.created_at,
            )
            for message in interview.messages
        ],
    )


def subject_label(interview: Interview) -> str:
    """Name the interview subject: a participant code, or a labelled administrator."""
    account = interview.participant
    if account.role == Role.ADMIN.value:
        return f"관리자 ({account.display_username})"
    return account.participant_code or ""


def admin_list_response(
    interview: Interview,
    review_status: ReviewStatus,
) -> InterviewListItemResponse:
    return InterviewListItemResponse(
        id=interview.id,
        participant_code=subject_label(interview),
        status=interview.status,
        progress=interview.progress,
        review_status=review_status,
        updated_at=interview.updated_at,
    )


def admin_detail_response(
    interview: Interview,
    review_status: ReviewStatus,
) -> InterviewDetailResponse:
    base = admin_list_response(interview, review_status)
    return InterviewDetailResponse(
        **base.model_dump(),
        messages=[
            InterviewMessageResponse(
                id=message.id,
                role=message.role,
                content=message.content,
                created_at=message.created_at,
            )
            for message in interview.messages
        ],
        scorecard=[
            ScorecardRowResponse(
                question_id=item.question_id,
                question=item.question,
                value=item.value,
                rationale=item.rationale,
                ai_status=item.ai_status,
                expert_status=(
                    item.expert_review.expert_status
                    if item.expert_review is not None
                    else None
                ),
                expert_rationale=(
                    item.expert_review.rationale
                    if item.expert_review is not None
                    else None
                ),
            )
            for item in interview.scorecard_items
        ],
    )
