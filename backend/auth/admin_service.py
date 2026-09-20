"""Transactional administrator operations for centrally managed accounts."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth.models import UserAccount
from auth.policy import (
    STAFF_ROLES,
    AccountStatus,
    PolicyViolation,
    Role,
    normalize_participant_code,
    normalize_username,
)
from auth.repository import AuthRepository
from auth.security import PasswordService


class AccountConflict(Exception):
    """Raised when a normalized account identifier already exists."""


class AccountNotFound(Exception):
    """Raised when an administrator target is not a participant account."""


class AccountStateConflict(Exception):
    """Raised when an account transition is invalid for its current state."""


class BootstrapAdminExists(Exception):
    """Raised when the first-administrator command has already been used."""


class AccountAdministrationService:
    """Own centrally managed participant account mutations."""

    def __init__(
        self,
        session: Session,
        *,
        password_service: PasswordService | None = None,
        clock: Callable[[], datetime],
    ) -> None:
        self.session = session
        self.repository = AuthRepository(session)
        self.password_service = password_service or PasswordService()
        self.clock = clock

    def bootstrap_admin(self, *, username: str, password: str) -> UserAccount:
        normalized_username = normalize_username(username)
        password_hash = self.password_service.hash(password)
        now = self.clock()
        try:
            with self.session.begin():
                self.repository.lock_admin_bootstrap()
                if self.repository.has_admin():
                    raise BootstrapAdminExists
                account = self.repository.add_account(
                    UserAccount(
                        normalized_username=normalized_username,
                        display_username=username.strip(),
                        password_hash=password_hash,
                        role=Role.ADMIN.value,
                        status=AccountStatus.ACTIVE.value,
                        participant_code=None,
                        created_by_user_id=None,
                        created_at=now,
                        updated_at=now,
                        password_changed_at=now,
                    )
                )
                self.repository.add_audit_event(
                    actor_user_id=None,
                    action="account.created",
                    target_type="user_account",
                    target_id=account.id,
                    occurred_at=now,
                    details={"role": Role.ADMIN.value, "source": "bootstrap"},
                )
        except IntegrityError as exc:
            raise AccountConflict from exc
        return account

    def list_participants(self) -> list[UserAccount]:
        with self.session.begin():
            return self.repository.list_participants()

    def allocate_research_code(self) -> str:
        """Reserve the next code in the research sequence.

        Runs in its own transaction so the caller's session is left clean for
        the insert that follows.
        """
        with self.session.begin():
            return self.repository.next_research_code()

    def create_participant(
        self,
        *,
        actor_user_id: UUID,
        username: str,
        participant_code: str,
        password: str,
    ) -> UserAccount:
        normalized_username = normalize_username(username)
        normalized_code = normalize_participant_code(participant_code)
        password_hash = self.password_service.hash(password)
        now = self.clock()
        try:
            with self.session.begin():
                account = self.repository.add_account(
                    UserAccount(
                        normalized_username=normalized_username,
                        display_username=username.strip(),
                        password_hash=password_hash,
                        role=Role.PARTICIPANT.value,
                        status=AccountStatus.ACTIVE.value,
                        participant_code=normalized_code,
                        created_by_user_id=actor_user_id,
                        created_at=now,
                        updated_at=now,
                        password_changed_at=now,
                    )
                )
                self.repository.add_audit_event(
                    actor_user_id=actor_user_id,
                    action="account.created",
                    target_type="user_account",
                    target_id=account.id,
                    occurred_at=now,
                    details={"role": Role.PARTICIPANT.value},
                )
        except IntegrityError as exc:
            raise AccountConflict from exc
        return account

    def research_code_of(self, participant_id: UUID) -> str | None:
        """Return a participant's research code without opening a transaction."""
        with self.session.begin():
            account = self.repository.get_account_for_update(participant_id)
            return account.participant_code if account else None

    # -- one account at a time ------------------------------------------------
    # Participants and staff are managed the same way; `staff` picks which kind
    # of account an id may refer to, so one endpoint can never reach the other's.

    def _managed(self, account_id: UUID, *, staff: bool) -> UserAccount:
        lookup = (
            self.repository.get_staff_for_update
            if staff
            else self.repository.get_participant_for_update
        )
        account = lookup(account_id)
        if account is None:
            raise AccountNotFound
        return account

    def _reset_password(
        self, *, actor_user_id: UUID, account_id: UUID, password: str, staff: bool
    ) -> UserAccount:
        password_hash = self.password_service.hash(password)
        now = self.clock()
        with self.session.begin():
            account = self._managed(account_id, staff=staff)
            account.password_hash = password_hash
            account.password_changed_at = now
            account.updated_at = now
            self.repository.revoke_all_sessions(account.id, now)
            self.repository.add_audit_event(
                actor_user_id=actor_user_id,
                action="account.password_reset",
                target_type="user_account",
                target_id=account.id,
                occurred_at=now,
            )
        return account

    def _disable(self, *, actor_user_id: UUID, account_id: UUID, staff: bool) -> UserAccount:
        now = self.clock()
        with self.session.begin():
            account = self._managed(account_id, staff=staff)
            # An administrator who disables their own account locks the study out.
            if account.id == actor_user_id:
                raise AccountStateConflict
            if account.status == AccountStatus.DISABLED.value:
                raise AccountStateConflict
            account.status = AccountStatus.DISABLED.value
            account.updated_at = now
            self.repository.revoke_all_sessions(account.id, now)
            self.repository.add_audit_event(
                actor_user_id=actor_user_id,
                action="account.disabled",
                target_type="user_account",
                target_id=account.id,
                occurred_at=now,
            )
        return account

    def _enable(self, *, actor_user_id: UUID, account_id: UUID, staff: bool) -> UserAccount:
        now = self.clock()
        with self.session.begin():
            account = self._managed(account_id, staff=staff)
            if account.status != AccountStatus.DISABLED.value:
                raise AccountStateConflict
            account.status = AccountStatus.ACTIVE.value
            account.failed_login_count = 0
            account.failure_window_started_at = None
            account.temporary_locked_until = None
            account.lock_stage = 0
            account.updated_at = now
            self.repository.add_audit_event(
                actor_user_id=actor_user_id,
                action="account.enabled",
                target_type="user_account",
                target_id=account.id,
                occurred_at=now,
            )
            return account

    def _unlock(self, *, actor_user_id: UUID, account_id: UUID, staff: bool) -> UserAccount:
        now = self.clock()
        with self.session.begin():
            account = self._managed(account_id, staff=staff)
            if account.status != AccountStatus.ADMIN_LOCKED.value:
                raise AccountStateConflict
            account.status = AccountStatus.ACTIVE.value
            account.failed_login_count = 0
            account.failure_window_started_at = None
            account.temporary_locked_until = None
            account.lock_stage = 0
            account.last_unlocked_by_user_id = actor_user_id
            account.last_unlocked_at = now
            account.updated_at = now
            self.repository.revoke_all_sessions(account.id, now)
            self.repository.add_audit_event(
                actor_user_id=actor_user_id,
                action="account.unlocked",
                target_type="user_account",
                target_id=account.id,
                occurred_at=now,
            )
        return account

    # -- participants ---------------------------------------------------------

    def reset_participant_password(
        self, *, actor_user_id: UUID, participant_id: UUID, password: str
    ) -> UserAccount:
        return self._reset_password(
            actor_user_id=actor_user_id, account_id=participant_id, password=password, staff=False
        )

    def disable_participant(self, *, actor_user_id: UUID, participant_id: UUID) -> UserAccount:
        return self._disable(actor_user_id=actor_user_id, account_id=participant_id, staff=False)

    def enable_participant(self, *, actor_user_id: UUID, participant_id: UUID) -> UserAccount:
        """Bring a disabled participant back into the study."""
        return self._enable(actor_user_id=actor_user_id, account_id=participant_id, staff=False)

    def unlock_participant(self, *, actor_user_id: UUID, participant_id: UUID) -> UserAccount:
        return self._unlock(actor_user_id=actor_user_id, account_id=participant_id, staff=False)

    # -- staff: reviewers and administrators -------------------------------------

    def list_staff(self) -> list[UserAccount]:
        with self.session.begin():
            return self.repository.list_staff()

    def create_staff(
        self, *, actor_user_id: UUID, username: str, role: str, password: str
    ) -> UserAccount:
        if role not in STAFF_ROLES:
            raise PolicyViolation("역할은 검토자 또는 관리자여야 합니다.")
        normalized_username = normalize_username(username)
        password_hash = self.password_service.hash(password)
        now = self.clock()
        try:
            with self.session.begin():
                account = self.repository.add_account(
                    UserAccount(
                        normalized_username=normalized_username,
                        display_username=username.strip(),
                        password_hash=password_hash,
                        role=role,
                        status=AccountStatus.ACTIVE.value,
                        participant_code=None,
                        created_by_user_id=actor_user_id,
                        created_at=now,
                        updated_at=now,
                        password_changed_at=now,
                    )
                )
                self.repository.add_audit_event(
                    actor_user_id=actor_user_id,
                    action="account.created",
                    target_type="user_account",
                    target_id=account.id,
                    occurred_at=now,
                    details={"role": role},
                )
        except IntegrityError as exc:
            raise AccountConflict from exc
        return account

    def change_staff_role(self, *, actor_user_id: UUID, staff_id: UUID, role: str) -> UserAccount:
        """Move an account between reviewer and administrator.

        A participant account is out of reach here: it owns a research code and
        the interviews recorded under it. An administrator cannot change their
        own role, which also means the study always keeps one administrator.
        The account is signed out so the new role takes hold at once.
        """
        if role not in STAFF_ROLES:
            raise PolicyViolation("역할은 검토자 또는 관리자여야 합니다.")
        now = self.clock()
        with self.session.begin():
            account = self._managed(staff_id, staff=True)
            if account.id == actor_user_id or account.role == role:
                raise AccountStateConflict
            previous = account.role
            account.role = role
            account.updated_at = now
            self.repository.revoke_all_sessions(account.id, now)
            self.repository.add_audit_event(
                actor_user_id=actor_user_id,
                action="account.role_changed",
                target_type="user_account",
                target_id=account.id,
                occurred_at=now,
                details={"from": previous, "to": role},
            )
        return account

    def reset_staff_password(self, *, actor_user_id: UUID, staff_id: UUID, password: str) -> UserAccount:
        return self._reset_password(
            actor_user_id=actor_user_id, account_id=staff_id, password=password, staff=True
        )

    def disable_staff(self, *, actor_user_id: UUID, staff_id: UUID) -> UserAccount:
        return self._disable(actor_user_id=actor_user_id, account_id=staff_id, staff=True)

    def enable_staff(self, *, actor_user_id: UUID, staff_id: UUID) -> UserAccount:
        return self._enable(actor_user_id=actor_user_id, account_id=staff_id, staff=True)

    def unlock_staff(self, *, actor_user_id: UUID, staff_id: UUID) -> UserAccount:
        return self._unlock(actor_user_id=actor_user_id, account_id=staff_id, staff=True)
