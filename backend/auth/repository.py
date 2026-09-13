"""SQLAlchemy queries used by authentication services."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, or_, select, text, update
from sqlalchemy.orm import Session, joinedload

from auth.models import AuditEvent, AuthSession, UserAccount


RESEARCH_CODE_PREFIX = "KU"
_RESEARCH_CODE = re.compile(rf"^{RESEARCH_CODE_PREFIX}-(\d{{3,}})$")


class AuthRepository:
    """Persist authentication state without owning transaction boundaries."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def get_account_by_username_for_update(
        self,
        normalized_username: str,
    ) -> UserAccount | None:
        return self.session.scalar(
            select(UserAccount)
            .where(UserAccount.normalized_username == normalized_username)
            .with_for_update()
        )

    def get_account_for_update(self, user_id: UUID) -> UserAccount | None:
        return self.session.scalar(
            select(UserAccount).where(UserAccount.id == user_id).with_for_update()
        )

    def get_participant_for_update(self, user_id: UUID) -> UserAccount | None:
        return self.session.scalar(
            select(UserAccount)
            .where(
                UserAccount.id == user_id,
                UserAccount.role == "participant",
            )
            .with_for_update()
        )

    def add_account(self, account: UserAccount) -> UserAccount:
        self.session.add(account)
        self.session.flush()
        return account

    def list_participants(self) -> list[UserAccount]:
        return list(
            self.session.scalars(
                select(UserAccount)
                .where(UserAccount.role == "participant")
                .order_by(UserAccount.participant_code, UserAccount.id)
            )
        )

    def next_research_code(self) -> str:
        """Return the next KU-### code, continuing the existing sequence."""
        codes = self.session.scalars(
            select(UserAccount.participant_code).where(
                UserAccount.participant_code.is_not(None)
            )
        )
        highest = 0
        for code in codes:
            match = _RESEARCH_CODE.match(code or "")
            if match:
                highest = max(highest, int(match.group(1)))
        return f"{RESEARCH_CODE_PREFIX}-{highest + 1:03d}"

    def lock_admin_bootstrap(self) -> None:
        self.session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:lock_name))"),
            {"lock_name": "dabom.bootstrap_admin"},
        )

    def has_admin(self) -> bool:
        return (
            self.session.scalar(
                select(UserAccount.id).where(UserAccount.role == "admin").limit(1)
            )
            is not None
        )

    def revoke_all_sessions(self, user_id: UUID, now: datetime) -> int:
        result = self.session.execute(
            update(AuthSession)
            .where(
                AuthSession.user_id == user_id,
                AuthSession.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        return int(result.rowcount or 0)

    def add_session(self, auth_session: AuthSession) -> AuthSession:
        self.session.add(auth_session)
        self.session.flush()
        return auth_session

    def get_session_by_digest_for_update(
        self,
        token_hash: str,
    ) -> AuthSession | None:
        return self.session.scalar(
            select(AuthSession)
            .where(AuthSession.token_hash == token_hash)
            .options(joinedload(AuthSession.user))
            .with_for_update(of=AuthSession)
        )

    def delete_sessions_older_than(self, cutoff: datetime) -> int:
        result = self.session.execute(
            delete(AuthSession).where(
                or_(
                    AuthSession.expires_at <= cutoff,
                    AuthSession.revoked_at <= cutoff,
                )
            )
        )
        return int(result.rowcount or 0)

    def add_audit_event(
        self,
        *,
        actor_user_id: UUID | None,
        action: str,
        target_type: str,
        target_id: UUID,
        occurred_at: datetime,
        details: dict[str, Any] | None = None,
    ) -> AuditEvent:
        event = AuditEvent(
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            occurred_at=occurred_at,
            details=details or {},
        )
        self.session.add(event)
        return event
