"""Transactional account authentication services."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from auth.models import AuthSession, UserAccount
from auth.policy import (
    AccountStatus,
    LOGIN_WINDOW,
    MAX_LOGIN_FAILURES,
    NORMAL_SESSION_DURATION,
    PolicyViolation,
    REMEMBERED_ABSOLUTE_DURATION,
    REMEMBERED_SESSION_DURATION,
    SessionKind,
    TEMPORARY_LOCK_DURATION,
    normalize_username,
)
from auth.repository import AuthRepository
from auth.security import PasswordService, TokenService

_DUMMY_PASSWORD_HASH = PasswordService().hash("not-a-real-account-password")


class InvalidCredentials(Exception):
    """Generic login rejection that does not reveal account state."""


@dataclass(frozen=True)
class IssuedLogin:
    account: UserAccount
    auth_session: AuthSession
    session_token: str
    csrf_token: str


class AuthenticationService:
    """Own the login lock state machine and server session lifecycle."""

    def __init__(
        self,
        session: Session,
        *,
        password_service: PasswordService | None = None,
        token_service: TokenService | None = None,
        clock: Callable[[], datetime],
    ) -> None:
        self.session = session
        self.repository = AuthRepository(session)
        self.password_service = password_service or PasswordService()
        self.token_service = token_service or TokenService()
        self.clock = clock

    def login(self, username: str, password: str, remember: bool) -> IssuedLogin:
        try:
            normalized_username = normalize_username(username)
        except PolicyViolation as exc:
            raise InvalidCredentials from exc

        now = self.clock()
        invalid = False
        issued_login: IssuedLogin | None = None
        with self.session.begin():
            account = self.repository.get_account_by_username_for_update(
                normalized_username
            )
            temporarily_locked = bool(
                account is not None
                and account.temporary_locked_until is not None
                and now < account.temporary_locked_until
            )
            account_available = bool(
                account is not None
                and account.status == AccountStatus.ACTIVE.value
            )
            password_matches = False
            replacement_hash: str | None = None
            if account_available and not temporarily_locked:
                password_matches, replacement_hash = (
                    self.password_service.verify_and_rehash(
                        account.password_hash,
                        password,
                    )
                )
            else:
                self.password_service.verify(_DUMMY_PASSWORD_HASH, password)
            if not account_available or temporarily_locked or not password_matches:
                invalid = True
                if (
                    account_available
                    and account is not None
                    and not temporarily_locked
                ):
                    if (
                        account.temporary_locked_until is not None
                        and now >= account.temporary_locked_until
                    ):
                        account.temporary_locked_until = None
                    if (
                        account.failure_window_started_at is None
                        or now - account.failure_window_started_at >= LOGIN_WINDOW
                    ):
                        account.failure_window_started_at = now
                        account.failed_login_count = 1
                    else:
                        account.failed_login_count += 1

                    if account.failed_login_count >= MAX_LOGIN_FAILURES:
                        account.failed_login_count = 0
                        account.failure_window_started_at = None
                        if account.lock_stage == 0:
                            account.lock_stage = 1
                            account.temporary_locked_until = (
                                now + TEMPORARY_LOCK_DURATION
                            )
                        else:
                            account.status = AccountStatus.ADMIN_LOCKED.value
                            account.admin_locked_at = now
                            account.temporary_locked_until = None
                            self.repository.revoke_all_sessions(account.id, now)
                            self.repository.add_audit_event(
                                actor_user_id=None,
                                action="account.admin_locked",
                                target_type="user_account",
                                target_id=account.id,
                                occurred_at=now,
                            )
                    account.updated_at = now
            else:
                account.failed_login_count = 0
                account.failure_window_started_at = None
                account.temporary_locked_until = None
                account.lock_stage = 0
                account.updated_at = now
                if replacement_hash is not None:
                    account.password_hash = replacement_hash

                session_token = self.token_service.issue()
                csrf_token = self.token_service.issue()
                kind = SessionKind.REMEMBERED if remember else SessionKind.NORMAL
                if kind is SessionKind.REMEMBERED:
                    expires_at = now + REMEMBERED_SESSION_DURATION
                    absolute_expires_at = now + REMEMBERED_ABSOLUTE_DURATION
                else:
                    expires_at = now + NORMAL_SESSION_DURATION
                    absolute_expires_at = expires_at
                auth_session = self.repository.add_session(
                    AuthSession(
                        user_id=account.id,
                        token_hash=session_token.digest,
                        csrf_token_hash=csrf_token.digest,
                        kind=kind.value,
                        created_at=now,
                        last_seen_at=now,
                        expires_at=expires_at,
                        absolute_expires_at=absolute_expires_at,
                    )
                )
                issued_login = IssuedLogin(
                    account=account,
                    auth_session=auth_session,
                    session_token=session_token.raw,
                    csrf_token=csrf_token.raw,
                )

        if invalid:
            raise InvalidCredentials
        if issued_login is None:
            raise RuntimeError("Login completed without issuing a session")
        return issued_login
