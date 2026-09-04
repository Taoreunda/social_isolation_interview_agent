"""Create account, authentication session, and audit tables."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260904_0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("normalized_username", sa.String(length=64), nullable=False),
        sa.Column("display_username", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="active", nullable=False),
        sa.Column("participant_code", sa.String(length=64), nullable=True),
        sa.Column("failed_login_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("failure_window_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("temporary_locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lock_stage", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("admin_locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_unlocked_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_unlocked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("password_changed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("failed_login_count >= 0", name="ck_user_accounts_failed_login_count"),
        sa.CheckConstraint("lock_stage IN (0, 1)", name="ck_user_accounts_lock_stage"),
        sa.CheckConstraint(
            "((role = 'participant' AND participant_code IS NOT NULL) "
            "OR (role = 'admin' AND participant_code IS NULL))",
            name="ck_user_accounts_participant_code_role",
        ),
        sa.CheckConstraint("role IN ('participant', 'admin')", name="ck_user_accounts_role"),
        sa.CheckConstraint(
            "status IN ('active', 'disabled', 'admin_locked')",
            name="ck_user_accounts_status",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["user_accounts.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["last_unlocked_by_user_id"], ["user_accounts.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("normalized_username"),
        sa.UniqueConstraint("participant_code"),
    )
    op.create_table(
        "auth_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("csrf_token_hash", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "expires_at <= absolute_expires_at", name="ck_auth_sessions_expiry_order"
        ),
        sa.CheckConstraint(
            "kind IN ('normal', 'remembered')", name="ck_auth_sessions_kind"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user_accounts.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_auth_sessions_user_revoked",
        "auth_sessions",
        ["user_id", "revoked_at"],
        unique=False,
    )
    op.create_table(
        "audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=64), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"], ["user_accounts.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_audit_events_occurred_at", "audit_events", ["occurred_at"], unique=False
    )
    op.create_index(
        "ix_audit_events_target",
        "audit_events",
        ["target_type", "target_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_audit_events_target", table_name="audit_events")
    op.drop_index("ix_audit_events_occurred_at", table_name="audit_events")
    op.drop_table("audit_events")
    op.drop_index("ix_auth_sessions_user_revoked", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_table("user_accounts")
