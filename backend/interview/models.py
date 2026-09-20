"""SQLAlchemy mappings for persisted research interviews."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from app_core.database import Base
from auth.models import UserAccount
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class Interview(Base):
    """One durable interview attempt owned by a participant account."""

    __tablename__ = "interviews"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'completed', 'archived')",
            name="ck_interviews_status",
        ),
        CheckConstraint(
            "progress >= 0 AND progress <= 100",
            name="ck_interviews_progress",
        ),
        Index(
            "uq_interviews_active_participant",
            "participant_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
        Index(
            "ix_interviews_participant_updated",
            "participant_id",
            "updated_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    @property
    def subject_label(self) -> str:
        """Name the subject: a participant code, or a labelled administrator."""
        account = self.participant
        if account.role == "admin":
            return f"관리자 ({account.display_username})"
        return account.participant_code or ""

    participant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_accounts.id", ondelete="RESTRICT"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active", server_default="active"
    )
    progress: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    criteria: Mapped[dict[str, bool | None]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    final_diagnosis: Mapped[str | None] = mapped_column(String(64), nullable=True)
    report: Mapped[str | None] = mapped_column(Text, nullable=True)
    algorithm_version: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="react-scorecard-v1",
        server_default="react-scorecard-v1",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    messages: Mapped[list[InterviewMessage]] = relationship(
        back_populates="interview",
        cascade="all, delete-orphan",
        order_by="InterviewMessage.sequence",
    )
    scorecard_items: Mapped[list[ScorecardItem]] = relationship(
        back_populates="interview",
        cascade="all, delete-orphan",
        order_by="ScorecardItem.position",
    )
    participant: Mapped[UserAccount] = relationship(lazy="joined")


class InterviewMessage(Base):
    """A visible participant or assistant message committed at a turn boundary."""

    __tablename__ = "interview_messages"
    __table_args__ = (
        CheckConstraint(
            "role IN ('user', 'assistant')",
            name="ck_interview_messages_role",
        ),
        CheckConstraint(
            "sequence >= 0",
            name="ck_interview_messages_sequence",
        ),
        CheckConstraint(
            "source IS NULL OR source IN ('typed', 'suggested')",
            name="ck_interview_messages_source",
        ),
        UniqueConstraint(
            "interview_id",
            "sequence",
            name="uq_interview_messages_sequence",
        ),
        UniqueConstraint(
            "interview_id",
            "client_turn_id",
            "role",
            name="uq_interview_messages_client_turn_role",
        ),
        Index(
            "ix_interview_messages_interview_created",
            "interview_id",
            "created_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    interview_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("interviews.id", ondelete="CASCADE"),
        nullable=False,
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # How a participant gave this answer: typed it, or tapped a suggested reply.
    # Null for interviewer messages and for answers from before this was recorded.
    source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    client_turn_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    interview: Mapped[Interview] = relationship(back_populates="messages")


class ScorecardItem(Base):
    """The latest AI evaluation state for one interview question."""

    __tablename__ = "scorecard_items"
    __table_args__ = (
        CheckConstraint(
            "ai_status IS NULL OR ai_status IN ('positive', 'negative', 'recorded')",
            name="ck_scorecard_items_ai_status",
        ),
        CheckConstraint(
            "position >= 0",
            name="ck_scorecard_items_position",
        ),
        CheckConstraint(
            "clarification_count >= 0",
            name="ck_scorecard_items_clarification_count",
        ),
        UniqueConstraint(
            "interview_id",
            "question_id",
            name="uq_scorecard_items_interview_question",
        ),
        UniqueConstraint(
            "interview_id",
            "position",
            name="uq_scorecard_items_interview_position",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    interview_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("interviews.id", ondelete="CASCADE"),
        nullable=False,
    )
    question_id: Mapped[str] = mapped_column(String(32), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    ai_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    answer_message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("interview_messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    answer_message: Mapped[InterviewMessage | None] = relationship(
        "InterviewMessage",
        lazy="joined",
    )
    clarification_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    evaluated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    interview: Mapped[Interview] = relationship(back_populates="scorecard_items")
    expert_review: Mapped[ExpertReview | None] = relationship(
        back_populates="scorecard_item",
        cascade="all, delete-orphan",
        uselist=False,
    )


class ExpertReview(Base):
    """The current researcher decision for one evaluated scorecard item."""

    __tablename__ = "expert_reviews"
    __table_args__ = (
        CheckConstraint(
            "original_status IN ('positive', 'negative', 'recorded')",
            name="ck_expert_reviews_original_status",
        ),
        CheckConstraint(
            "expert_status IN ('positive', 'negative', 'recorded')",
            name="ck_expert_reviews_expert_status",
        ),
        CheckConstraint(
            "action IN ('approve', 'override')",
            name="ck_expert_reviews_action",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    scorecard_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scorecard_items.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    reviewer_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_accounts.id", ondelete="RESTRICT"),
        nullable=False,
    )
    original_status: Mapped[str] = mapped_column(String(16), nullable=False)
    expert_status: Mapped[str] = mapped_column(String(16), nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    scorecard_item: Mapped[ScorecardItem] = relationship(
        back_populates="expert_review"
    )
