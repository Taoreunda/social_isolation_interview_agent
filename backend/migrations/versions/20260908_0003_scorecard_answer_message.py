"""Link a scored question to the answer that produced it.

Revision ID: 20260908_0003
Revises: 20260905_0002
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260908_0003"
down_revision = "20260905_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "scorecard_items",
        sa.Column("answer_message_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_scorecard_items_answer_message",
        "scorecard_items",
        "interview_messages",
        ["answer_message_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_scorecard_items_answer_message",
        "scorecard_items",
        type_="foreignkey",
    )
    op.drop_column("scorecard_items", "answer_message_id")
