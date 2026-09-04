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


def test_non_postgresql_database_url_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
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


def test_initial_migration_creates_only_auth_foundation_tables(
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
        assert set(inspect(engine).get_table_names()) == {
            "alembic_version",
            "audit_events",
            "auth_sessions",
            "user_accounts",
        }
    finally:
        engine.dispose()
        reset_database_state()
