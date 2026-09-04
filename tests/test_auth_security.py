"""Authentication policy and cryptographic boundary tests."""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest
from argon2 import PasswordHasher

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


@pytest.mark.parametrize(
    ("raw", "expected"),
    [(" Alice-01 ", "alice-01"), ("USER.name", "user.name")],
)
def test_username_is_trimmed_and_normalized_to_lowercase_ascii(
    raw: str,
    expected: str,
) -> None:
    from auth.policy import normalize_username

    assert normalize_username(raw) == expected


@pytest.mark.parametrize(
    "raw",
    ["ab", "a" * 65, "이용자", "user name", "user@example.com"],
)
def test_username_outside_the_closed_ascii_contract_is_rejected(raw: str) -> None:
    from auth.policy import PolicyViolation, normalize_username

    with pytest.raises(PolicyViolation):
        normalize_username(raw)


def test_participant_code_is_normalized_without_accepting_free_text() -> None:
    from auth.policy import PolicyViolation, normalize_participant_code

    assert normalize_participant_code(" p-001 ") == "P-001"
    with pytest.raises(PolicyViolation):
        normalize_participant_code("participant 001")


@pytest.mark.parametrize("password", ["123456789", "x" * 129])
def test_passwords_outside_ten_to_128_characters_are_rejected(password: str) -> None:
    from auth.policy import PolicyViolation, validate_password

    with pytest.raises(PolicyViolation):
        validate_password(password)


def test_password_service_uses_argon2id_and_handles_mismatch() -> None:
    from auth.security import PasswordService

    service = PasswordService(
        PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1)
    )
    encoded = service.hash("correct-horse")

    assert encoded.startswith("$argon2id$")
    assert service.verify(encoded, "correct-horse") is True
    assert service.verify(encoded, "wrong-password") is False
    assert service.verify("not-a-password-hash", "correct-horse") is False


def test_password_service_returns_replacement_for_outdated_valid_hash() -> None:
    from auth.security import PasswordService

    old_service = PasswordService(
        PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1)
    )
    current_service = PasswordService(
        PasswordHasher(time_cost=2, memory_cost=8192, parallelism=1)
    )
    old_hash = old_service.hash("correct-horse")

    verified, replacement = current_service.verify_and_rehash(
        old_hash,
        "correct-horse",
    )

    assert verified is True
    assert replacement is not None
    assert replacement != old_hash
    assert current_service.verify(replacement, "correct-horse") is True


def test_generated_password_has_required_length_and_character_groups() -> None:
    from auth.security import generate_password

    generated = generate_password()

    assert len(generated) == 20
    assert re.search(r"[a-z]", generated)
    assert re.search(r"[A-Z]", generated)
    assert re.search(r"[0-9]", generated)
    assert re.search(r"[^A-Za-z0-9]", generated)


def test_opaque_token_digest_never_contains_the_raw_credential() -> None:
    from auth.security import TokenService

    issued = TokenService(raw_factory=lambda: "raw-secret-token").issue()

    assert issued.raw == "raw-secret-token"
    assert issued.digest == (
        "208308741470cb23b7110a5d7d10846244011e60b918c5745a10e012f9c0a106"
    )
    assert issued.raw not in issued.digest
