"""Create durable interview, message, scorecard, and review tables."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260905_0002"
down_revision: str | Sequence[str] | None = "20260904_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "interviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("participant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "status", sa.String(length=16), server_default="active", nullable=False
        ),
        sa.Column(
            "progress", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "criteria",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("final_diagnosis", sa.String(length=64), nullable=True),
        sa.Column("report", sa.Text(), nullable=True),
        sa.Column(
            "algorithm_version",
            sa.String(length=64),
            server_default="react-scorecard-v1",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "progress >= 0 AND progress <= 100", name="ck_interviews_progress"
        ),
        sa.CheckConstraint(
            "status IN ('active', 'completed', 'archived')",
            name="ck_interviews_status",
        ),
        sa.ForeignKeyConstraint(
            ["participant_id"], ["user_accounts.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_interviews_participant_updated",
        "interviews",
        ["participant_id", "updated_at"],
        unique=False,
    )
    op.create_index(
        "uq_interviews_active_participant",
        "interviews",
        ["participant_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )

    op.create_table(
        "interview_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("interview_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("client_turn_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "role IN ('user', 'assistant')", name="ck_interview_messages_role"
        ),
        sa.CheckConstraint(
            "sequence >= 0", name="ck_interview_messages_sequence"
        ),
        sa.ForeignKeyConstraint(
            ["interview_id"], ["interviews.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "interview_id",
            "client_turn_id",
            "role",
            name="uq_interview_messages_client_turn_role",
        ),
        sa.UniqueConstraint(
            "interview_id", "sequence", name="uq_interview_messages_sequence"
        ),
    )
    op.create_index(
        "ix_interview_messages_interview_created",
        "interview_messages",
        ["interview_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "scorecard_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("interview_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("question_id", sa.String(length=32), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("ai_status", sa.String(length=16), nullable=True),
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column(
            "clarification_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "ai_status IS NULL OR ai_status IN ('positive', 'negative', 'recorded')",
            name="ck_scorecard_items_ai_status",
        ),
        sa.CheckConstraint(
            "clarification_count >= 0",
            name="ck_scorecard_items_clarification_count",
        ),
        sa.CheckConstraint("position >= 0", name="ck_scorecard_items_position"),
        sa.ForeignKeyConstraint(
            ["interview_id"], ["interviews.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "interview_id",
            "position",
            name="uq_scorecard_items_interview_position",
        ),
        sa.UniqueConstraint(
            "interview_id",
            "question_id",
            name="uq_scorecard_items_interview_question",
        ),
    )

    op.create_table(
        "expert_reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("scorecard_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reviewer_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("original_status", sa.String(length=16), nullable=False),
        sa.Column("expert_status", sa.String(length=16), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column(
            "reviewed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "action IN ('approve', 'override')", name="ck_expert_reviews_action"
        ),
        sa.CheckConstraint(
            "expert_status IN ('positive', 'negative', 'recorded')",
            name="ck_expert_reviews_expert_status",
        ),
        sa.CheckConstraint(
            "original_status IN ('positive', 'negative', 'recorded')",
            name="ck_expert_reviews_original_status",
        ),
        sa.ForeignKeyConstraint(
            ["reviewer_user_id"], ["user_accounts.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["scorecard_item_id"], ["scorecard_items.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scorecard_item_id"),
    )


def downgrade() -> None:
    op.drop_table("expert_reviews")
    op.drop_table("scorecard_items")
    op.drop_index(
        "ix_interview_messages_interview_created", table_name="interview_messages"
    )
    op.drop_table("interview_messages")
    op.drop_index("uq_interviews_active_participant", table_name="interviews")
    op.drop_index("ix_interviews_participant_updated", table_name="interviews")
    op.drop_table("interviews")
