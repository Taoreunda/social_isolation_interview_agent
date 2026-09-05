"""SQLAlchemy queries for durable interviews and expert reviews."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from auth.models import AuditEvent
from interview.models import ExpertReview, Interview, InterviewMessage, ScorecardItem
from sqlalchemy import case, select, text
from sqlalchemy.orm import Session, joinedload


class InterviewRepository:
    """Persist interview state without owning transaction boundaries."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def get_current(
        self,
        participant_id: UUID,
        *,
        for_update: bool = False,
    ) -> Interview | None:
        statement = (
            select(Interview)
            .where(
                Interview.participant_id == participant_id,
                Interview.status.in_(("active", "completed")),
            )
            .order_by(
                case((Interview.status == "active", 0), else_=1),
                Interview.updated_at.desc(),
                Interview.id,
            )
            .options(joinedload(Interview.messages))
            .limit(1)
        )
        if for_update:
            statement = statement.with_for_update(of=Interview)
        return self.session.execute(statement).unique().scalar_one_or_none()

    def get_owned(
        self,
        interview_id: UUID,
        participant_id: UUID,
        *,
        for_update: bool = False,
    ) -> Interview | None:
        statement = (
            select(Interview)
            .where(
                Interview.id == interview_id,
                Interview.participant_id == participant_id,
            )
            .options(
                joinedload(Interview.messages),
                joinedload(Interview.scorecard_items).joinedload(
                    ScorecardItem.expert_review
                ),
            )
        )
        if for_update:
            statement = statement.with_for_update(of=Interview)
        return self.session.execute(statement).unique().scalar_one_or_none()

    def get_for_admin(
        self,
        interview_id: UUID,
        *,
        for_update: bool = False,
    ) -> Interview | None:
        statement = (
            select(Interview)
            .where(Interview.id == interview_id)
            .options(
                joinedload(Interview.participant),
                joinedload(Interview.messages),
                joinedload(Interview.scorecard_items).joinedload(
                    ScorecardItem.expert_review
                ),
            )
        )
        if for_update:
            statement = statement.with_for_update(of=Interview)
        return self.session.execute(statement).unique().scalar_one_or_none()

    def list_for_admin(self) -> list[Interview]:
        statement = (
            select(Interview)
            .options(
                joinedload(Interview.participant),
                joinedload(Interview.scorecard_items).joinedload(
                    ScorecardItem.expert_review
                ),
            )
            .order_by(Interview.updated_at.desc(), Interview.id)
        )
        return list(self.session.execute(statement).unique().scalars())

    def statuses_for_participants(
        self,
        participant_ids: list[UUID],
    ) -> dict[UUID, str]:
        if not participant_ids:
            return {}
        rows = self.session.execute(
            select(Interview.participant_id, Interview.status)
            .where(Interview.participant_id.in_(participant_ids))
            .order_by(
                Interview.participant_id,
                case(
                    (Interview.status == "active", 0),
                    (Interview.status == "completed", 1),
                    else_=2,
                ),
                Interview.updated_at.desc(),
            )
        )
        statuses: dict[UUID, str] = {}
        for participant_id, status in rows:
            statuses.setdefault(participant_id, status)
        return statuses

    def lock_interview_start(self, participant_id: UUID) -> None:
        """Serialize the final active-interview check across API processes."""
        self.session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:lock_name))"),
            {"lock_name": f"dabom.interview.start.{participant_id}"},
        )

    def has_committed_turn(self, interview_id: UUID, client_turn_id: UUID) -> bool:
        return (
            self.session.scalar(
                select(InterviewMessage.id)
                .where(
                    InterviewMessage.interview_id == interview_id,
                    InterviewMessage.client_turn_id == client_turn_id,
                    InterviewMessage.role == "assistant",
                )
                .limit(1)
            )
            is not None
        )

    def add_interview(self, interview: Interview) -> Interview:
        self.session.add(interview)
        self.session.flush()
        return interview

    def add_audit_event(
        self,
        *,
        actor_user_id: UUID,
        action: str,
        target_id: UUID,
        occurred_at: datetime,
        details: dict[str, Any] | None = None,
    ) -> AuditEvent:
        event = AuditEvent(
            actor_user_id=actor_user_id,
            action=action,
            target_type="interview",
            target_id=target_id,
            occurred_at=occurred_at,
            details=details or {},
        )
        self.session.add(event)
        return event

    def add_review(self, review: ExpertReview) -> ExpertReview:
        self.session.add(review)
        self.session.flush()
        return review
