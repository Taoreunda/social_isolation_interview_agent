"""PostgreSQL runtime configuration tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def test_database_url_is_required(monkeypatch: pytest.MonkeyPatch) -> None:
    from app_core.database import (
        DatabaseConfigurationError,
        get_database_url,
        reset_database_state,
    )

    monkeypatch.delenv("DATABASE_URL", raising=False)
    reset_database_state()

    with pytest.raises(DatabaseConfigurationError, match="DATABASE_URL"):
        get_database_url()


def test_non_postgresql_database_url_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app_core.database import (
        DatabaseConfigurationError,
        get_database_url,
        reset_database_state,
    )

    monkeypatch.setenv("DATABASE_URL", "sqlite:///local.db")
    reset_database_state()

    with pytest.raises(DatabaseConfigurationError, match="PostgreSQL"):
        get_database_url()


def test_engine_is_created_lazily_and_failed_probe_returns_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app_core.database import check_database, get_engine, reset_database_state

    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://dabom:local@127.0.0.1:1/dabom?connect_timeout=1",
    )
    reset_database_state()

    engine = get_engine()

    assert engine.dialect.driver == "psycopg"
    assert check_database() is False
    reset_database_state()


def test_migrations_create_auth_and_research_tables(
    monkeypatch: pytest.MonkeyPatch,
    postgres_url: str,
) -> None:
    from app_core.database import reset_database_state

    monkeypatch.setenv("DATABASE_URL", postgres_url)
    reset_database_state()
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))

    command.downgrade(config, "base")
    command.upgrade(config, "head")

    engine = create_engine(postgres_url)
    try:
        inspector = inspect(engine)
        assert set(inspector.get_table_names()) == {
            "alembic_version",
            "audit_events",
            "auth_sessions",
            "expert_reviews",
            "interview_messages",
            "interviews",
            "scorecard_items",
            "user_accounts",
        }

        interview_checks = {
            check["name"] for check in inspector.get_check_constraints("interviews")
        }
        assert {
            "ck_interviews_progress",
            "ck_interviews_status",
        } <= interview_checks

        interview_indexes = {
            index["name"]: index for index in inspector.get_indexes("interviews")
        }
        active_index = interview_indexes["uq_interviews_active_participant"]
        assert active_index["unique"] is True
        assert active_index["column_names"] == ["participant_id"]
        active_predicate = str(
            active_index["dialect_options"]["postgresql_where"]
        )
        assert "status" in active_predicate
        assert "'active'" in active_predicate

        message_uniques = {
            tuple(constraint["column_names"])
            for constraint in inspector.get_unique_constraints("interview_messages")
        }
        assert ("interview_id", "sequence") in message_uniques
        assert ("interview_id", "client_turn_id", "role") in message_uniques

        foreign_key_targets = {
            (foreign_key["constrained_columns"][0], foreign_key["referred_table"])
            for table in (
                "interviews",
                "interview_messages",
                "scorecard_items",
                "expert_reviews",
            )
            for foreign_key in inspector.get_foreign_keys(table)
        }
        assert {
            ("participant_id", "user_accounts"),
            ("interview_id", "interviews"),
            ("scorecard_item_id", "scorecard_items"),
            ("reviewer_user_id", "user_accounts"),
        } <= foreign_key_targets
    finally:
        engine.dispose()
        reset_database_state()
