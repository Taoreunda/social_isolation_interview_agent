"""FastAPI authentication, origin, CSRF, role, and cookie boundaries."""

from __future__ import annotations

import secrets
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app_core.config import get_bool_config, get_config_value, get_list_config
from app_core.database import DatabaseConfigurationError, get_session_factory
from auth.policy import Role, SessionKind
from auth.security import TokenService
from auth.service import (
    AuthContext,
    AuthenticationRequired,
    AuthenticationService,
    IssuedLogin,
)

DEFAULT_ALLOWED_ORIGINS = (
    "http://127.0.0.1:5173",
    "http://localhost:5173",
)


@dataclass(frozen=True)
class CookieSettings:
    session_name: str
    csrf_name: str
    secure: bool


@dataclass(frozen=True)
class RequestIdentity:
    context: AuthContext
    raw_session_token: str


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def get_allowed_origins() -> list[str]:
    configured = get_list_config(
        "AUTH_ALLOWED_ORIGINS",
        default=DEFAULT_ALLOWED_ORIGINS,
    )
    return [origin.rstrip("/") for origin in configured]


def get_cookie_settings() -> CookieSettings:
    return CookieSettings(
        session_name=str(get_config_value("AUTH_SESSION_COOKIE", "dabom_session")),
        csrf_name=str(get_config_value("AUTH_CSRF_COOKIE", "dabom_csrf")),
        secure=get_bool_config("AUTH_COOKIE_SECURE", default=False),
    )


def get_db() -> Iterator[Session]:
    try:
        factory = get_session_factory()
    except DatabaseConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="필수 서비스를 사용할 수 없습니다.",
        ) from exc
    with factory() as session:
        yield session


def get_clock() -> Callable[[], datetime]:
    return utc_now


def get_authentication_service(
    session: Session = Depends(get_db),
    clock: Callable[[], datetime] = Depends(get_clock),
) -> AuthenticationService:
    return AuthenticationService(session, clock=clock)


def require_allowed_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin is None or origin.rstrip("/") not in get_allowed_origins():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="허용되지 않은 요청입니다.",
        )


def _cookie_max_age(issued: IssuedLogin) -> int | None:
    if issued.auth_session.kind != SessionKind.REMEMBERED.value:
        return None
    return max(
        0,
        int(
            (issued.auth_session.expires_at - issued.auth_session.created_at).total_seconds()
        ),
    )


def set_login_cookies(response: Response, issued: IssuedLogin) -> None:
    settings = get_cookie_settings()
    max_age = _cookie_max_age(issued)
    response.set_cookie(
        settings.session_name,
        issued.session_token,
        max_age=max_age,
        httponly=True,
        secure=settings.secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        settings.csrf_name,
        issued.csrf_token,
        max_age=max_age,
        httponly=False,
        secure=settings.secure,
        samesite="lax",
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    settings = get_cookie_settings()
    response.delete_cookie(
        settings.session_name,
        httponly=True,
        secure=settings.secure,
        samesite="lax",
        path="/",
    )
    response.delete_cookie(
        settings.csrf_name,
        httponly=False,
        secure=settings.secure,
        samesite="lax",
        path="/",
    )


def require_current_user(
    request: Request,
    response: Response,
    service: AuthenticationService = Depends(get_authentication_service),
) -> RequestIdentity:
    settings = get_cookie_settings()
    raw_token = request.cookies.get(settings.session_name)
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인이 필요합니다.",
        )
    try:
        context = service.authenticate(raw_token)
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

    if context.cookie_renewed:
        remaining = max(
            0,
            int(
                (
                    context.auth_session.expires_at - context.authenticated_at
                ).total_seconds()
            ),
        )
        response.set_cookie(
            settings.session_name,
            raw_token,
            max_age=remaining,
            httponly=True,
            secure=settings.secure,
            samesite="lax",
            path="/",
        )
        raw_csrf = request.cookies.get(settings.csrf_name)
        if raw_csrf and secrets.compare_digest(
            TokenService.digest(raw_csrf),
            context.auth_session.csrf_token_hash,
        ):
            response.set_cookie(
                settings.csrf_name,
                raw_csrf,
                max_age=remaining,
                httponly=False,
                secure=settings.secure,
                samesite="lax",
                path="/",
            )
    return RequestIdentity(context=context, raw_session_token=raw_token)


def require_csrf(
    request: Request,
    identity: RequestIdentity = Depends(require_current_user),
) -> RequestIdentity:
    settings = get_cookie_settings()
    cookie_token = request.cookies.get(settings.csrf_name)
    header_token = request.headers.get("x-csrf-token")
    if (
        not cookie_token
        or not header_token
        or not secrets.compare_digest(cookie_token, header_token)
        or not secrets.compare_digest(
            TokenService.digest(header_token),
            identity.context.auth_session.csrf_token_hash,
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="요청을 확인할 수 없습니다.",
        )
    return identity


def require_admin(
    identity: RequestIdentity = Depends(require_current_user),
) -> RequestIdentity:
    if identity.context.account.role != Role.ADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자 권한이 필요합니다.",
        )
    return identity
