"""Administrator endpoints for reviewer and administrator accounts.

Participants have their own endpoints: they carry a research code and an
interview, staff carry a role. Keeping the two apart means an id meant for one
can never reach the other.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar
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
    require_admin,
    require_admin_csrf,
    require_allowed_origin,
)
from auth.models import UserAccount
from auth.policy import PolicyViolation
from auth.schemas import (
    ChangeStaffRoleRequest,
    CreateStaffRequest,
    PasswordAssignmentResponse,
    ResetPasswordRequest,
    StaffCredentialResponse,
    StaffResponse,
)
from auth.security import generate_password

router = APIRouter(prefix="/admin/staff", tags=["staff administration"])

T = TypeVar("T")


def _staff_response(account: UserAccount) -> StaffResponse:
    return StaffResponse(
        id=account.id,
        username=account.display_username,
        role=account.role,
        status=account.status,
        temporary_locked_until=account.temporary_locked_until,
    )


def _run(operation: Callable[[], T]) -> T:
    """Translate the service's failures into the API's answers, in one place."""
    try:
        return operation()
    except AccountNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="계정을 찾을 수 없습니다.",
        ) from exc
    except AccountStateConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="지금 상태에서는 할 수 없는 작업입니다.",
        ) from exc
    except AccountConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 사용 중인 계정 정보입니다.",
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


@router.get("", response_model=list[StaffResponse])
def list_staff(
    _identity: RequestIdentity = Depends(require_admin),
    service: AccountAdministrationService = Depends(get_account_administration_service),
) -> list[StaffResponse]:
    return [_staff_response(account) for account in _run(service.list_staff)]


@router.post("", response_model=StaffCredentialResponse, status_code=status.HTTP_201_CREATED)
def create_staff(
    payload: CreateStaffRequest,
    _origin: None = Depends(require_allowed_origin),
    identity: RequestIdentity = Depends(require_admin_csrf),
    service: AccountAdministrationService = Depends(get_account_administration_service),
) -> StaffCredentialResponse:
    assigned_password = generate_password() if payload.generate_password else None
    password = assigned_password if assigned_password is not None else payload.password
    assert password is not None  # CreateStaffRequest requires exactly one source
    account = _run(
        lambda: service.create_staff(
            actor_user_id=identity.context.account.id,
            username=payload.username,
            role=payload.role,
            password=password,
        )
    )
    return StaffCredentialResponse(staff=_staff_response(account), assigned_password=assigned_password)


@router.post("/{staff_id}/role", response_model=StaffResponse)
def change_staff_role(
    staff_id: UUID,
    payload: ChangeStaffRoleRequest,
    _origin: None = Depends(require_allowed_origin),
    identity: RequestIdentity = Depends(require_admin_csrf),
    service: AccountAdministrationService = Depends(get_account_administration_service),
) -> StaffResponse:
    return _staff_response(
        _run(
            lambda: service.change_staff_role(
                actor_user_id=identity.context.account.id,
                staff_id=staff_id,
                role=payload.role,
            )
        )
    )


@router.post("/{staff_id}/password", response_model=PasswordAssignmentResponse)
def reset_staff_password(
    staff_id: UUID,
    payload: ResetPasswordRequest,
    _origin: None = Depends(require_allowed_origin),
    identity: RequestIdentity = Depends(require_admin_csrf),
    service: AccountAdministrationService = Depends(get_account_administration_service),
) -> PasswordAssignmentResponse:
    assigned_password = generate_password() if payload.generate_password else None
    password = assigned_password if assigned_password is not None else payload.password
    assert password is not None  # ResetPasswordRequest requires exactly one source
    _run(
        lambda: service.reset_staff_password(
            actor_user_id=identity.context.account.id,
            staff_id=staff_id,
            password=password,
        )
    )
    return PasswordAssignmentResponse(assigned_password=assigned_password)


def _state_change(name: str) -> None:
    """Register disable, enable and unlock, which differ only in the service call."""

    @router.post(f"/{{staff_id}}/{name}", response_model=StaffResponse, name=f"{name}_staff")
    def change(
        staff_id: UUID,
        _origin: None = Depends(require_allowed_origin),
        identity: RequestIdentity = Depends(require_admin_csrf),
        service: AccountAdministrationService = Depends(get_account_administration_service),
    ) -> StaffResponse:
        operation = getattr(service, f"{name}_staff")
        return _staff_response(
            _run(lambda: operation(actor_user_id=identity.context.account.id, staff_id=staff_id))
        )


for _name in ("disable", "enable", "unlock"):
    _state_change(_name)
