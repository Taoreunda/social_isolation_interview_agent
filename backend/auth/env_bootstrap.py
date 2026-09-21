"""Create the first administrator from the environment, once.

A fresh deployment has no way in: accounts are made by an administrator, and
there is none yet. `./dev.sh admin` solves that by hand. This solves it for a
server nobody logs into: set BOOTSTRAP_ADMIN_USERNAME and
BOOTSTRAP_ADMIN_PASSWORD, start the application, sign in, change the password,
and remove the two variables.

The variables are read only while no administrator exists. After that they are
ignored, so they can never reset a password or undo a change made on screen.
Every further administrator is created by an administrator.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from enum import StrEnum

from app_core.database import DatabaseConfigurationError, get_session_factory
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from auth.admin_service import (
    AccountAdministrationService,
    AccountConflict,
    BootstrapAdminExists,
)
from auth.policy import PolicyViolation
from auth.security import PasswordService

USERNAME_VARIABLE = "BOOTSTRAP_ADMIN_USERNAME"
PASSWORD_VARIABLE = "BOOTSTRAP_ADMIN_PASSWORD"

logger = logging.getLogger("dabom.bootstrap")


class BootstrapOutcome(StrEnum):
    NOT_CONFIGURED = "not_configured"
    CREATED = "created"
    ADMIN_EXISTS = "admin_exists"
    REJECTED = "rejected"
    UNAVAILABLE = "unavailable"


def _utc_now() -> datetime:
    return datetime.now(UTC)


def bootstrap_admin_from_env(
    *,
    environ: Mapping[str, str] | None = None,
    session_factory: Callable[[], Session] | None = None,
    password_service: PasswordService | None = None,
) -> BootstrapOutcome:
    """Never raises: a misconfigured bootstrap must not keep the server from starting."""
    values = os.environ if environ is None else environ
    username = (values.get(USERNAME_VARIABLE) or "").strip()
    password = values.get(PASSWORD_VARIABLE) or ""
    if not username and not password:
        return BootstrapOutcome.NOT_CONFIGURED

    return _create(username, password, session_factory, password_service)


def _create(
    username: str,
    password: str,
    session_factory: Callable[[], Session] | None,
    password_service: PasswordService | None,
) -> BootstrapOutcome:
    if not username or not password:
        logger.error("Both %s and %s are required; no administrator was created.", USERNAME_VARIABLE, PASSWORD_VARIABLE)
        return BootstrapOutcome.REJECTED
    if password.strip().lower() == username.lower():
        logger.error("%s must differ from the username; no administrator was created.", PASSWORD_VARIABLE)
        return BootstrapOutcome.REJECTED

    try:
        factory = session_factory or get_session_factory()
        with factory() as session:
            service = AccountAdministrationService(
                session,
                password_service=password_service or PasswordService(),
                clock=_utc_now,
            )
            service.bootstrap_admin(username=username, password=password, source="environment")
    except BootstrapAdminExists:
        logger.warning(
            "An administrator already exists, so %s and %s were ignored. Remove them from the environment.",
            USERNAME_VARIABLE,
            PASSWORD_VARIABLE,
        )
        return BootstrapOutcome.ADMIN_EXISTS
    except PolicyViolation as exc:
        logger.error("The bootstrap administrator was rejected: %s", exc)
        return BootstrapOutcome.REJECTED
    except AccountConflict:
        logger.error("The bootstrap username is already taken by another account; no administrator was created.")
        return BootstrapOutcome.REJECTED
    except DatabaseConfigurationError as exc:
        logger.error("The bootstrap administrator was not created: %s.", exc)
        return BootstrapOutcome.UNAVAILABLE
    except SQLAlchemyError as exc:
        # Only the error's type: driver messages can carry connection details.
        logger.error("The bootstrap administrator was not created: the database failed (%s).", type(exc).__name__)
        return BootstrapOutcome.UNAVAILABLE

    # Warnings reach the console under uvicorn's default logging; the password itself is never logged.
    logger.warning(
        "Created the first administrator '%s'. Sign in, change the password, then remove %s and %s.",
        username,
        USERNAME_VARIABLE,
        PASSWORD_VARIABLE,
    )
    return BootstrapOutcome.CREATED


__all__ = [
    "PASSWORD_VARIABLE",
    "USERNAME_VARIABLE",
    "BootstrapOutcome",
    "bootstrap_admin_from_env",
]
