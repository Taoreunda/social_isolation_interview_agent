"""Add the reviewer role.

A reviewer judges scorecards and exports data but neither manages accounts nor
sits an interview. Like an administrator, a reviewer has no participant code.

Revision ID: 20260921_0005
Revises: 20260920_0004
"""

from __future__ import annotations

from alembic import op

revision = "20260921_0005"
down_revision = "20260920_0004"
branch_labels = None
depends_on = None

ROLE = "ck_user_accounts_role"
CODE = "ck_user_accounts_participant_code_role"


def _replace(roles: str, staff: str) -> None:
    op.drop_constraint(CODE, "user_accounts", type_="check")
    op.drop_constraint(ROLE, "user_accounts", type_="check")
    op.create_check_constraint(ROLE, "user_accounts", f"role IN ({roles})")
    op.create_check_constraint(
        CODE,
        "user_accounts",
        "((role = 'participant' AND participant_code IS NOT NULL) "
        f"OR ({staff} AND participant_code IS NULL))",
    )


def upgrade() -> None:
    _replace("'participant', 'reviewer', 'admin'", "role IN ('reviewer', 'admin')")


def downgrade() -> None:
    # Fails while reviewer accounts exist; remove or promote them first.
    _replace("'participant', 'admin'", "role = 'admin'")
