"""Alembic environment for the PostgreSQL-only schema."""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from app_core.database import Base, get_database_url
from auth import models  # noqa: F401  (register mappings with Base.metadata)
from interview import models as interview_models  # noqa: F401
from sqlalchemy import create_engine, pool

config = context.config
if config.config_file_name is not None:
    # Keep the application's own loggers alive: the default silences every logger created before this call.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=get_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(get_database_url(), poolclass=pool.NullPool)
    try:
        with connectable.connect() as connection:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                compare_type=True,
            )
            with context.begin_transaction():
                context.run_migrations()
    finally:
        connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
