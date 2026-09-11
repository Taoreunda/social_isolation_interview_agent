"""Password hashing and high-entropy opaque credential helpers."""

from __future__ import annotations

import hashlib
import secrets
import string
from collections.abc import Callable
from dataclasses import dataclass

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from auth.policy import PolicyViolation, validate_password

_PASSWORD_PUNCTUATION = "!@#$%&*+-_=?"


class PasswordService:
    """Small Argon2id boundary that never leaks verification exceptions."""

    def __init__(self, hasher: PasswordHasher | None = None) -> None:
        self._hasher = hasher or PasswordHasher()

    def hash(self, password: str) -> str:
        validate_password(password)
        return self._hasher.hash(password)

    def verify(self, encoded: str, password: str) -> bool:
        try:
            return bool(self._hasher.verify(encoded, password))
        except (InvalidHashError, VerificationError, VerifyMismatchError):
            return False

    def verify_and_rehash(self, encoded: str, password: str) -> tuple[bool, str | None]:
        if not self.verify(encoded, password):
            return False, None
        if self._hasher.check_needs_rehash(encoded):
            return True, self.hash(password)
        return True, None


@dataclass(frozen=True)
class IssuedToken:
    raw: str
    digest: str


class TokenService:
    """Issue opaque credentials and derive their one-way database keys."""

    def __init__(self, raw_factory: Callable[[], str] | None = None) -> None:
        self._raw_factory = raw_factory or (lambda: secrets.token_urlsafe(32))

    def issue(self) -> IssuedToken:
        raw = self._raw_factory()
        return IssuedToken(raw=raw, digest=self.digest(raw))

    @staticmethod
    def digest(raw: str) -> str:
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()


_PASSWORD_TAIL = string.ascii_lowercase + string.digits
MINIMUM_PASSWORD_LENGTH = 10


def generate_participant_password(participant_code: str) -> str:
    """Derive a readable one-time password from the research code.

    The code makes the password easy to hand over; the random tail keeps it
    from being guessable by anyone who merely knows the code.
    """
    prefix = participant_code.strip().lower()
    tail_length = 4
    while True:
        tail = "".join(secrets.choice(_PASSWORD_TAIL) for _ in range(tail_length))
        candidate = f"{prefix}-{tail}"
        if len(candidate) >= MINIMUM_PASSWORD_LENGTH:
            return candidate
        tail_length += 1


def generate_password(length: int = 20) -> str:
    """Generate a one-time administrator-assigned password of at least 16 chars."""
    if length < 16:
        raise PolicyViolation("Generated passwords must contain at least 16 characters")

    groups = (
        string.ascii_lowercase,
        string.ascii_uppercase,
        string.digits,
        _PASSWORD_PUNCTUATION,
    )
    alphabet = "".join(groups)
    characters = [secrets.choice(group) for group in groups]
    characters.extend(secrets.choice(alphabet) for _ in range(length - len(characters)))
    secrets.SystemRandom().shuffle(characters)
    return "".join(characters)
