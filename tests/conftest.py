"""Shared fixtures for tests that exercise the real PostgreSQL boundary."""

from __future__ import annotations

import os
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
BACKEND = REPOSITORY_ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

DEFAULT_TEST_DATABASE_URL = (
    "postgresql+psycopg://dabom:dabom-local@127.0.0.1:54330/dabom_test"
)


@pytest.fixture(scope="session")
def postgres_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)
    engine = create_engine(url, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        pytest.fail(
            "PostgreSQL test service is unavailable; run "
            "`docker compose --profile test up -d db-test`\n"
            f"{exc.__class__.__name__}",
            pytrace=False,
        )
    finally:
        engine.dispose()
    return url


@pytest.fixture(scope="session")
def postgres_engine(postgres_url: str) -> Iterator[Engine]:
    from app_core.database import reset_database_state

    previous_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = postgres_url
    reset_database_state()
    command.upgrade(Config(str(REPOSITORY_ROOT / "alembic.ini")), "head")
    engine = create_engine(postgres_url, pool_pre_ping=True)
    try:
        yield engine
    finally:
        engine.dispose()
        reset_database_state()
        if previous_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_url


@pytest.fixture
def db_session(postgres_engine: Engine) -> Iterator[Session]:
    with postgres_engine.begin() as connection:
        connection.execute(
            text("TRUNCATE TABLE audit_events, auth_sessions, user_accounts CASCADE")
        )

    with Session(postgres_engine, expire_on_commit=False) as session:
        yield session
        session.rollback()

    with postgres_engine.begin() as connection:
        connection.execute(
            text("TRUNCATE TABLE audit_events, auth_sessions, user_accounts CASCADE")
        )
