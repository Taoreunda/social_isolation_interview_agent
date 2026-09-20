"""Stable account and session policy shared by services and HTTP schemas."""

from __future__ import annotations

import re
from datetime import timedelta
from enum import StrEnum

LOGIN_WINDOW = timedelta(minutes=15)
TEMPORARY_LOCK_DURATION = timedelta(minutes=15)
NORMAL_SESSION_DURATION = timedelta(hours=24)
REMEMBERED_SESSION_DURATION = timedelta(days=30)
REMEMBERED_RENEWAL_THRESHOLD = timedelta(days=7)
REMEMBERED_ABSOLUTE_DURATION = timedelta(days=90)
LAST_SEEN_WRITE_INTERVAL = timedelta(minutes=15)
MAX_LOGIN_FAILURES = 5

_USERNAME_PATTERN = re.compile(r"[a-z0-9._-]{3,64}", re.ASCII)
_PARTICIPANT_CODE_PATTERN = re.compile(r"[A-Z0-9._-]{1,64}", re.ASCII)


class Role(StrEnum):
    PARTICIPANT = "participant"
    REVIEWER = "reviewer"
    ADMIN = "admin"


# Reviewers and administrators: accounts that work on the study rather than take part in it.
STAFF_ROLES = (Role.REVIEWER.value, Role.ADMIN.value)


class AccountStatus(StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"
    ADMIN_LOCKED = "admin_locked"


class SessionKind(StrEnum):
    NORMAL = "normal"
    REMEMBERED = "remembered"


class PolicyViolation(ValueError):
    """Raised when an account input is outside the closed research policy."""


def normalize_username(raw: str) -> str:
    """Trim and normalize a login name to the canonical lowercase key."""
    if not isinstance(raw, str):
        raise PolicyViolation("Username must be text")
    normalized = raw.strip().lower()
    if _USERNAME_PATTERN.fullmatch(normalized) is None:
        raise PolicyViolation("Username must match [a-z0-9._-]{3,64}")
    return normalized


def normalize_participant_code(raw: str) -> str:
    """Normalize a pseudonymous research code to its canonical key."""
    if not isinstance(raw, str):
        raise PolicyViolation("Participant code must be text")
    normalized = raw.strip().upper()
    if _PARTICIPANT_CODE_PATTERN.fullmatch(normalized) is None:
        raise PolicyViolation("Participant code must match [A-Z0-9._-]{1,64}")
    return normalized


def validate_password(password: str) -> None:
    """Enforce the agreed password length without imposing composition rules."""
    if not isinstance(password, str) or not 10 <= len(password) <= 128:
        raise PolicyViolation("Password must contain 10 to 128 characters")
