"""Shared fixtures for tests that exercise the real PostgreSQL boundary."""

from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

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
