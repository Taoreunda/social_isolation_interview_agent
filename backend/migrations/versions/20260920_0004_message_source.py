"""Record whether a participant typed an answer or tapped a suggested reply.

Revision ID: 20260920_0004
Revises: 20260908_0003
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260920_0004"
down_revision = "20260908_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Null for interviewer messages and for answers given before this existed.
    op.add_column(
        "interview_messages",
        sa.Column("source", sa.String(length=16), nullable=True),
    )
    op.create_check_constraint(
        "ck_interview_messages_source",
        "interview_messages",
        "source IS NULL OR source IN ('typed', 'suggested')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_interview_messages_source",
        "interview_messages",
        type_="check",
    )
    op.drop_column("interview_messages", "source")
