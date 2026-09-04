"""Transactional account authentication services."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from auth.models import AuthSession, UserAccount
from auth.policy import (
    AccountStatus,
    LAST_SEEN_WRITE_INTERVAL,
    LOGIN_WINDOW,
    MAX_LOGIN_FAILURES,
    NORMAL_SESSION_DURATION,
    PolicyViolation,
    REMEMBERED_ABSOLUTE_DURATION,
    REMEMBERED_RENEWAL_THRESHOLD,
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


@dataclass(frozen=True)
class AuthContext:
    account: UserAccount
    auth_session: AuthSession
    cookie_renewed: bool


class AuthenticationRequired(Exception):
    """Raised when a server session cannot authenticate a request."""


class InvalidCurrentPassword(Exception):
    """Raised when an authenticated password change cannot verify its secret."""


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

    def authenticate(self, raw_token: str) -> AuthContext:
        now = self.clock()
        context: AuthContext | None = None
        with self.session.begin():
            auth_session = self.repository.get_session_by_digest_for_update(
                self.token_service.digest(raw_token)
            )
            if (
                auth_session is not None
                and auth_session.revoked_at is None
                and now < auth_session.expires_at
                and now < auth_session.absolute_expires_at
                and auth_session.user.status == AccountStatus.ACTIVE.value
            ):
                cookie_renewed = False
                if (
                    auth_session.kind == SessionKind.REMEMBERED.value
                    and auth_session.expires_at - now
                    <= REMEMBERED_RENEWAL_THRESHOLD
                ):
                    renewed_expiry = min(
                        now + REMEMBERED_SESSION_DURATION,
                        auth_session.absolute_expires_at,
                    )
                    if renewed_expiry > auth_session.expires_at:
                        auth_session.expires_at = renewed_expiry
                        cookie_renewed = True
                if now - auth_session.last_seen_at >= LAST_SEEN_WRITE_INTERVAL:
                    auth_session.last_seen_at = now
                context = AuthContext(
                    account=auth_session.user,
                    auth_session=auth_session,
                    cookie_renewed=cookie_renewed,
                )

        if context is None:
            raise AuthenticationRequired
        return context

    def logout(self, raw_token: str) -> None:
        now = self.clock()
        with self.session.begin():
            auth_session = self.repository.get_session_by_digest_for_update(
                self.token_service.digest(raw_token)
            )
            if auth_session is not None and auth_session.revoked_at is None:
                auth_session.revoked_at = now

    def change_password(
        self,
        user_id: UUID,
        *,
        current_password: str,
        new_password: str,
    ) -> None:
        now = self.clock()
        with self.session.begin():
            account = self.repository.get_account_for_update(user_id)
            if account is None or account.status != AccountStatus.ACTIVE.value:
                raise AuthenticationRequired
            if not self.password_service.verify(
                account.password_hash,
                current_password,
            ):
                raise InvalidCurrentPassword

            account.password_hash = self.password_service.hash(new_password)
            account.password_changed_at = now
            account.updated_at = now
            self.repository.revoke_all_sessions(account.id, now)
            self.repository.add_audit_event(
                actor_user_id=account.id,
                action="account.password_changed",
                target_type="user_account",
                target_id=account.id,
                occurred_at=now,
            )

    def cleanup_sessions(self, *, retention: timedelta) -> int:
        if retention < timedelta(0):
            raise ValueError("Session retention cannot be negative")
        cutoff = self.clock() - retention
        with self.session.begin():
            return self.repository.delete_sessions_older_than(cutoff)
