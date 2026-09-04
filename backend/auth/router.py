"""Authentication HTTP endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import SQLAlchemyError

from auth.dependencies import (
    RequestIdentity,
    clear_auth_cookies,
    get_authentication_service,
    require_allowed_origin,
    require_csrf,
    require_current_user,
    set_login_cookies,
)
from auth.policy import PolicyViolation
from auth.schemas import ChangePasswordRequest, CurrentUserResponse, LoginRequest
from auth.service import (
    AuthenticationRequired,
    AuthenticationService,
    InvalidCredentials,
    InvalidCurrentPassword,
)

router = APIRouter(prefix="/auth", tags=["authentication"])


def _current_user(identity: RequestIdentity) -> CurrentUserResponse:
    account = identity.context.account
    return CurrentUserResponse(
        id=account.id,
        username=account.display_username,
        role=account.role,
        participant_code=account.participant_code,
    )


@router.post("/login", response_model=CurrentUserResponse)
def login(
    payload: LoginRequest,
    response: Response,
    _origin: None = Depends(require_allowed_origin),
    service: AuthenticationService = Depends(get_authentication_service),
) -> CurrentUserResponse:
    try:
        issued = service.login(
            payload.username,
            payload.password,
            payload.remember,
        )
    except InvalidCredentials as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인 정보를 확인해 주세요.",
        ) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="필수 서비스를 사용할 수 없습니다.",
        ) from exc

    set_login_cookies(response, issued)
    return CurrentUserResponse(
        id=issued.account.id,
        username=issued.account.display_username,
        role=issued.account.role,
        participant_code=issued.account.participant_code,
    )


@router.get("/me", response_model=CurrentUserResponse)
def current_user(
    identity: RequestIdentity = Depends(require_current_user),
) -> CurrentUserResponse:
    return _current_user(identity)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    _origin: None = Depends(require_allowed_origin),
    identity: RequestIdentity = Depends(require_csrf),
    service: AuthenticationService = Depends(get_authentication_service),
) -> Response:
    try:
        service.logout(identity.raw_session_token)
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="필수 서비스를 사용할 수 없습니다.",
        ) from exc
    clear_auth_cookies(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    _origin: None = Depends(require_allowed_origin),
    identity: RequestIdentity = Depends(require_csrf),
    service: AuthenticationService = Depends(get_authentication_service),
) -> Response:
    try:
        service.change_password(
            identity.context.account.id,
            current_password=payload.current_password,
            new_password=payload.new_password,
        )
    except InvalidCurrentPassword as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="현재 비밀번호를 확인해 주세요.",
        ) from exc
    except PolicyViolation as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except AuthenticationRequired as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인이 필요합니다.",
        ) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="필수 서비스를 사용할 수 없습니다.",
        ) from exc
    clear_auth_cookies(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
