"""Role-protected participant and administrator interview endpoints."""

from __future__ import annotations

from collections.abc import Callable
from functools import lru_cache
from uuid import UUID

from auth.dependencies import (
    RequestIdentity,
    get_clock,
    get_db,
    require_admin,
    require_admin_csrf,
    require_allowed_origin,
    require_participant,
    require_participant_csrf,
)
from fastapi import APIRouter, Depends, HTTPException, Response, status
from interview.engine import InterviewEngine, InterviewGenerationError
from interview.schemas import (
    InterviewDetailResponse,
    InterviewListItemResponse,
    InterviewMessageRequest,
    ParticipantInterviewResponse,
    ReviewScorecardRequest,
    admin_detail_response,
    admin_list_response,
    participant_response,
)
from interview.service import (
    InterviewBusy,
    InterviewNotFound,
    InterviewService,
    InterviewStateConflict,
    InvalidReview,
    PersistedTurnEngine,
)
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

router = APIRouter(tags=["research interviews"])


@lru_cache(maxsize=1)
def get_interview_engine() -> InterviewEngine:
    """Build the configured model only when a turn endpoint needs it."""
    try:
        return InterviewEngine()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="인터뷰 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        ) from exc


def get_interview_read_service(
    session: Session = Depends(get_db),
    clock: Callable = Depends(get_clock),
) -> InterviewService:
    return InterviewService(session, clock=clock)


def get_interview_turn_service(
    session: Session = Depends(get_db),
    clock: Callable = Depends(get_clock),
    engine: PersistedTurnEngine = Depends(get_interview_engine),
) -> InterviewService:
    return InterviewService(session, engine=engine, clock=clock)


def _translate_error(exc: Exception) -> HTTPException:
    if isinstance(exc, InterviewNotFound):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="인터뷰를 찾을 수 없습니다.",
        )
    if isinstance(exc, (InterviewBusy, InterviewStateConflict)):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="현재 인터뷰 상태에서는 요청을 처리할 수 없습니다.",
        )
    if isinstance(exc, InvalidReview):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="검토 내용을 확인해 주세요.",
        )
    if isinstance(exc, (InterviewGenerationError, SQLAlchemyError)):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="인터뷰 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        )
    raise exc


@router.get(
    "/interviews/current",
    response_model=ParticipantInterviewResponse,
)
def get_current_interview(
    identity: RequestIdentity = Depends(require_participant),
    service: InterviewService = Depends(get_interview_read_service),
) -> ParticipantInterviewResponse:
    try:
        interview = service.get_current(identity.context.account.id)
    except SQLAlchemyError as exc:
        raise _translate_error(exc) from exc
    if interview is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="인터뷰를 찾을 수 없습니다.",
        )
    return participant_response(interview)


@router.post(
    "/interviews",
    response_model=ParticipantInterviewResponse,
    status_code=status.HTTP_201_CREATED,
)
async def start_interview(
    _origin: None = Depends(require_allowed_origin),
    identity: RequestIdentity = Depends(require_participant_csrf),
    service: InterviewService = Depends(get_interview_turn_service),
) -> ParticipantInterviewResponse:
    try:
        interview = await service.start(identity.context.account.id)
    except (InterviewBusy, InterviewGenerationError, SQLAlchemyError) as exc:
        raise _translate_error(exc) from exc
    return participant_response(interview)


@router.post(
    "/interviews/{interview_id}/messages",
    response_model=ParticipantInterviewResponse,
)
async def submit_interview_message(
    interview_id: UUID,
    payload: InterviewMessageRequest,
    _origin: None = Depends(require_allowed_origin),
    identity: RequestIdentity = Depends(require_participant_csrf),
    service: InterviewService = Depends(get_interview_turn_service),
) -> ParticipantInterviewResponse:
    try:
        interview = await service.submit_turn(
            participant_id=identity.context.account.id,
            interview_id=interview_id,
            client_turn_id=payload.client_turn_id,
            content=payload.content.strip(),
        )
    except (
        InterviewNotFound,
        InterviewBusy,
        InterviewStateConflict,
        InterviewGenerationError,
        SQLAlchemyError,
    ) as exc:
        raise _translate_error(exc) from exc
    return participant_response(interview)


@router.get(
    "/admin/interviews",
    response_model=list[InterviewListItemResponse],
)
def list_interviews(
    _identity: RequestIdentity = Depends(require_admin),
    service: InterviewService = Depends(get_interview_read_service),
) -> list[InterviewListItemResponse]:
    try:
        interviews = service.list_for_admin()
    except SQLAlchemyError as exc:
        raise _translate_error(exc) from exc
    return [
        admin_list_response(interview, service.review_status(interview))
        for interview in interviews
    ]


@router.get(
    "/admin/interviews/{interview_id}",
    response_model=InterviewDetailResponse,
)
def get_interview_detail(
    interview_id: UUID,
    _identity: RequestIdentity = Depends(require_admin),
    service: InterviewService = Depends(get_interview_read_service),
) -> InterviewDetailResponse:
    try:
        interview = service.get_for_admin(interview_id)
    except (InterviewNotFound, SQLAlchemyError) as exc:
        raise _translate_error(exc) from exc
    return admin_detail_response(interview, service.review_status(interview))


@router.post(
    "/admin/interviews/{interview_id}/scorecard/{question_id}",
    response_model=InterviewDetailResponse,
)
def review_scorecard(
    interview_id: UUID,
    question_id: str,
    payload: ReviewScorecardRequest,
    _origin: None = Depends(require_allowed_origin),
    identity: RequestIdentity = Depends(require_admin_csrf),
    service: InterviewService = Depends(get_interview_read_service),
) -> InterviewDetailResponse:
    try:
        interview = service.review_scorecard(
            reviewer_user_id=identity.context.account.id,
            interview_id=interview_id,
            question_id=question_id,
            action=payload.action,
            expert_status=payload.expert_status,
            rationale=payload.rationale,
        )
    except (InterviewNotFound, InvalidReview, SQLAlchemyError) as exc:
        raise _translate_error(exc) from exc
    return admin_detail_response(interview, service.review_status(interview))


@router.post("/admin/interviews/{interview_id}/csv")
def export_interview_csv(
    interview_id: UUID,
    _origin: None = Depends(require_allowed_origin),
    identity: RequestIdentity = Depends(require_admin_csrf),
    service: InterviewService = Depends(get_interview_read_service),
) -> Response:
    try:
        content = service.export_csv(
            reviewer_user_id=identity.context.account.id,
            interview_id=interview_id,
        )
    except (InterviewNotFound, SQLAlchemyError) as exc:
        raise _translate_error(exc) from exc
    return Response(
        content=content.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="interview-{interview_id}.csv"'
        },
    )
