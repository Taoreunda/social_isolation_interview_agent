"""Research administrator account-management HTTP endpoints."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError

from auth.admin_service import (
    AccountAdministrationService,
    AccountConflict,
    AccountNotFound,
    AccountStateConflict,
)
from auth.dependencies import (
    RequestIdentity,
    get_account_administration_service,
    get_clock,
    get_db,
    require_admin,
    require_admin_csrf,
    require_allowed_origin,
)
from auth.policy import PolicyViolation
from auth.schemas import (
    CreateParticipantRequest,
    ParticipantCredentialResponse,
    ParticipantResponse,
    PasswordAssignmentResponse,
    ResetParticipantPasswordRequest,
)
from auth.security import generate_participant_password, generate_password
from interview.service import InterviewService
from sqlalchemy.orm import Session

router = APIRouter(prefix="/admin/participants", tags=["participant administration"])


def get_participant_status_service(
    session: Session = Depends(get_db),
    clock=Depends(get_clock),
) -> InterviewService:
    return InterviewService(session, clock=clock)


def _participant_response(
    account,
    interview_status: str = "not_started",
) -> ParticipantResponse:
    return ParticipantResponse(
        id=account.id,
        username=account.display_username,
        participant_code=account.participant_code,
        status=account.status,
        interview_status=interview_status,
    )


@router.get("", response_model=list[ParticipantResponse])
def list_participants(
    _identity: RequestIdentity = Depends(require_admin),
    service: AccountAdministrationService = Depends(get_account_administration_service),
    interview_service: InterviewService = Depends(get_participant_status_service),
) -> list[ParticipantResponse]:
    try:
        accounts = service.list_participants()
        interview_statuses = interview_service.statuses_for_participants(
            [account.id for account in accounts]
        )
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="필수 서비스를 사용할 수 없습니다.",
        ) from exc
    return [
        _participant_response(
            account,
            interview_statuses.get(account.id, "not_started"),
        )
        for account in accounts
    ]


@router.post(
    "",
    response_model=ParticipantCredentialResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_participant(
    payload: CreateParticipantRequest,
    _origin: None = Depends(require_allowed_origin),
    identity: RequestIdentity = Depends(require_admin_csrf),
    service: AccountAdministrationService = Depends(get_account_administration_service),
) -> ParticipantCredentialResponse:
    try:
        participant_code = payload.participant_code or service.allocate_research_code()
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="필수 서비스를 사용할 수 없습니다.",
        ) from exc
    username = payload.username or participant_code.lower()

    assigned_password = (
        generate_participant_password(participant_code)
        if payload.generate_password
        else None
    )
    password = assigned_password if assigned_password is not None else payload.password
    if password is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="비밀번호가 필요합니다.",
        )
    try:
        account = service.create_participant(
            actor_user_id=identity.context.account.id,
            username=username,
            participant_code=participant_code,
            password=password,
        )
    except PolicyViolation as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except AccountConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 사용 중인 계정 정보입니다.",
        ) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="필수 서비스를 사용할 수 없습니다.",
        ) from exc

    return ParticipantCredentialResponse(
        participant=_participant_response(account),
        assigned_password=assigned_password,
    )


@router.post(
    "/{participant_id}/password",
    response_model=PasswordAssignmentResponse,
)
def reset_participant_password(
    participant_id: UUID,
    payload: ResetParticipantPasswordRequest,
    _origin: None = Depends(require_allowed_origin),
    identity: RequestIdentity = Depends(require_admin_csrf),
    service: AccountAdministrationService = Depends(get_account_administration_service),
) -> PasswordAssignmentResponse:
    assigned_password = None
    if payload.generate_password:
        try:
            code = service.research_code_of(participant_id)
        except SQLAlchemyError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="필수 서비스를 사용할 수 없습니다.",
            ) from exc
        assigned_password = (
            generate_participant_password(code) if code else generate_password()
        )
    password = assigned_password if assigned_password is not None else payload.password
    if password is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="비밀번호가 필요합니다.",
        )
    try:
        service.reset_participant_password(
            actor_user_id=identity.context.account.id,
            participant_id=participant_id,
            password=password,
        )
    except AccountNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="참여자를 찾을 수 없습니다.",
        ) from exc
    except PolicyViolation as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="필수 서비스를 사용할 수 없습니다.",
        ) from exc
    return PasswordAssignmentResponse(assigned_password=assigned_password)


@router.post("/{participant_id}/disable", response_model=ParticipantResponse)
def disable_participant(
    participant_id: UUID,
    _origin: None = Depends(require_allowed_origin),
    identity: RequestIdentity = Depends(require_admin_csrf),
    service: AccountAdministrationService = Depends(get_account_administration_service),
    interview_service: InterviewService = Depends(get_participant_status_service),
) -> ParticipantResponse:
    try:
        interview_status = interview_service.statuses_for_participants(
            [participant_id]
        ).get(participant_id, "not_started")
        account = service.disable_participant(
            actor_user_id=identity.context.account.id,
            participant_id=participant_id,
        )
    except AccountNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="참여자를 찾을 수 없습니다.",
        ) from exc
    except AccountStateConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="현재 계정 상태에서는 수행할 수 없습니다.",
        ) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="필수 서비스를 사용할 수 없습니다.",
        ) from exc
    return _participant_response(account, interview_status)


@router.post("/{participant_id}/enable", response_model=ParticipantResponse)
def enable_participant(
    participant_id: UUID,
    _origin: None = Depends(require_allowed_origin),
    identity: RequestIdentity = Depends(require_admin_csrf),
    service: AccountAdministrationService = Depends(get_account_administration_service),
    interview_service: InterviewService = Depends(get_participant_status_service),
) -> ParticipantResponse:
    try:
        interview_status = interview_service.statuses_for_participants(
            [participant_id]
        ).get(participant_id, "not_started")
        account = service.enable_participant(
            actor_user_id=identity.context.account.id,
            participant_id=participant_id,
        )
    except AccountNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="참여자를 찾을 수 없습니다.",
        ) from exc
    except AccountStateConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="현재 계정 상태에서는 수행할 수 없습니다.",
        ) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="필수 서비스를 사용할 수 없습니다.",
        ) from exc
    return _participant_response(account, interview_status)


@router.post("/{participant_id}/unlock", response_model=ParticipantResponse)
def unlock_participant(
    participant_id: UUID,
    _origin: None = Depends(require_allowed_origin),
    identity: RequestIdentity = Depends(require_admin_csrf),
    service: AccountAdministrationService = Depends(get_account_administration_service),
    interview_service: InterviewService = Depends(get_participant_status_service),
) -> ParticipantResponse:
    try:
        interview_status = interview_service.statuses_for_participants(
            [participant_id]
        ).get(participant_id, "not_started")
        account = service.unlock_participant(
            actor_user_id=identity.context.account.id,
            participant_id=participant_id,
        )
    except AccountNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="참여자를 찾을 수 없습니다.",
        ) from exc
    except AccountStateConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="관리자 잠금 상태가 아닙니다.",
        ) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="필수 서비스를 사용할 수 없습니다.",
        ) from exc
    return _participant_response(account, interview_status)
