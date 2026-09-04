"""PostgreSQL engine and session configuration."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import ArgumentError, SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app_core.config import get_config_value


class DatabaseConfigurationError(RuntimeError):
    """Raised when the required PostgreSQL configuration is invalid."""


class Base(DeclarativeBase):
    """Declarative base shared by all PostgreSQL models."""


_engine: Optional[Engine] = None
_session_factory: Optional[sessionmaker[Session]] = None


def get_database_url() -> str:
    """Return a psycopg 3 SQLAlchemy URL, rejecting non-PostgreSQL storage."""
    raw_url = get_config_value("DATABASE_URL")
    if not raw_url:
        raise DatabaseConfigurationError("DATABASE_URL is required")

    try:
        url = make_url(str(raw_url))
    except ArgumentError as exc:
        raise DatabaseConfigurationError("DATABASE_URL is invalid") from exc

    if url.get_backend_name() != "postgresql":
        raise DatabaseConfigurationError("DATABASE_URL must use PostgreSQL")
    if url.drivername == "postgresql":
        url = url.set(drivername="postgresql+psycopg")
    if url.drivername != "postgresql+psycopg":
        raise DatabaseConfigurationError("DATABASE_URL must use PostgreSQL with psycopg 3")
    return url.render_as_string(hide_password=False)


def get_engine() -> Engine:
    """Return the cached engine without opening a connection eagerly."""
    global _engine
    if _engine is None:
        _engine = create_engine(get_database_url(), pool_pre_ping=True)
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    """Return the session factory bound to the configured PostgreSQL engine."""
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(
            bind=get_engine(),
            autoflush=False,
            expire_on_commit=False,
        )
    return _session_factory


def check_database() -> bool:
    """Return whether the required PostgreSQL dependency accepts a query."""
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
    except (DatabaseConfigurationError, SQLAlchemyError):
        return False
    return True


def reset_database_state() -> None:
    """Dispose cached database resources after configuration changes."""
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None
