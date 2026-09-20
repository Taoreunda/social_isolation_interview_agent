"""Protected interview request and response contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from auth.schemas import ApiSchema
from interview.models import Interview
from interview.suggestions import open_question_id, suggested_replies_for
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


class SuggestedReplyResponse(ApiSchema):
    text: str
    send: bool


class ParticipantInterviewResponse(ApiSchema):
    id: UUID
    status: InterviewStatus
    progress: int
    updated_at: datetime
    messages: list[InterviewMessageResponse]
    suggested_replies: list[SuggestedReplyResponse] = Field(default_factory=list)


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
    answer: str | None
    value: str | None
    rationale: str | None
    ai_status: ScoreDecision | None
    expert_status: ScoreDecision | None
    expert_rationale: str | None


class InterviewDetailResponse(InterviewListItemResponse):
    messages: list[InterviewMessageResponse]
    scorecard: list[ScorecardRowResponse]
    final_diagnosis: str | None
    criteria: dict[str, bool | None]
    report: str | None
    algorithm_version: str
    completed_at: datetime | None


class ExportInterviewsRequest(ApiSchema):
    interview_ids: list[UUID] = Field(default_factory=list)
    participant_ids: list[UUID] = Field(default_factory=list)


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
        suggested_replies=[
            SuggestedReplyResponse(text=reply.text, send=reply.send)
            for reply in suggested_replies_for(open_question_id(interview))
        ],
    )


def admin_list_response(
    interview: Interview,
    review_status: ReviewStatus,
) -> InterviewListItemResponse:
    return InterviewListItemResponse(
        id=interview.id,
        participant_code=interview.subject_label,
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
        final_diagnosis=interview.final_diagnosis,
        criteria=interview.criteria or {},
        report=interview.report,
        algorithm_version=interview.algorithm_version,
        completed_at=interview.completed_at,
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
                answer=item.answer_message.content if item.answer_message else None,
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
