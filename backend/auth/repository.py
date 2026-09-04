"""SQLAlchemy queries used by authentication services."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from auth.models import AuditEvent, AuthSession, UserAccount


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
