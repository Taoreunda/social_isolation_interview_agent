"""Operator command tests for first-admin bootstrap and session cleanup."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from argon2 import PasswordHasher
from auth.models import AuditEvent, AuthSession, UserAccount
from auth.policy import AccountStatus, Role, SessionKind
from auth.security import PasswordService, TokenService
from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

VALID_ADMIN_PASSWORD = "administrator-passphrase"


@pytest.fixture
def cli_session_factory(
    postgres_engine: Engine,
    db_session: Session,
) -> sessionmaker[Session]:
    del db_session
    return sessionmaker(
        bind=postgres_engine,
        autoflush=False,
        expire_on_commit=False,
    )


def password_reader(values: list[str]) -> Callable[[str], str]:
    remaining = iter(values)
    return lambda _prompt: next(remaining)


def test_bootstrap_creates_only_first_admin_without_printing_prompted_password(
    cli_session_factory: sessionmaker[Session],
    db_session: Session,
) -> None:
    from auth.cli import main

    output: list[str] = []
    first = main(
        ["bootstrap-admin", "--username", "research-admin"],
        session_factory=cli_session_factory,
        password_reader=password_reader([VALID_ADMIN_PASSWORD, VALID_ADMIN_PASSWORD]),
        output=output.append,
    )
    second = main(
        ["bootstrap-admin", "--username", "second-admin"],
        session_factory=cli_session_factory,
        password_reader=password_reader([VALID_ADMIN_PASSWORD, VALID_ADMIN_PASSWORD]),
        output=output.append,
    )

    assert first == 0
    assert second == 2
    assert all(VALID_ADMIN_PASSWORD not in line for line in output)
    accounts = db_session.scalars(select(UserAccount)).all()
    assert len(accounts) == 1
    assert accounts[0].normalized_username == "research-admin"
    assert accounts[0].role == Role.ADMIN.value
    assert accounts[0].participant_code is None
    assert PasswordService(
        PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1)
    ).verify(accounts[0].password_hash, VALID_ADMIN_PASSWORD)
    assert db_session.scalar(select(func.count(AuditEvent.id))) == 1
    event = db_session.scalar(select(AuditEvent))
    assert event is not None
    assert event.action == "account.created"
    assert event.actor_user_id is None
    assert event.details == {"role": "admin", "source": "bootstrap"}


def test_cleanup_command_removes_only_sessions_past_retention(
    cli_session_factory: sessionmaker[Session],
    db_session: Session,
) -> None:
    from auth.cli import main

    now = datetime.now(UTC)
    account = UserAccount(
        normalized_username="research-admin",
        display_username="research-admin",
        password_hash=PasswordService(
            PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1)
        ).hash(VALID_ADMIN_PASSWORD),
        role=Role.ADMIN.value,
        status=AccountStatus.ACTIVE.value,
        participant_code=None,
        created_at=now,
        updated_at=now,
        password_changed_at=now,
    )
    db_session.add(account)
    db_session.flush()

    def auth_session(name: str) -> AuthSession:
        return AuthSession(
            user_id=account.id,
            token_hash=TokenService.digest(f"session-{name}"),
            csrf_token_hash=TokenService.digest(f"csrf-{name}"),
            kind=SessionKind.NORMAL.value,
            created_at=now - timedelta(days=40),
            last_seen_at=now - timedelta(days=40),
            expires_at=now + timedelta(days=1),
            absolute_expires_at=now + timedelta(days=1),
        )

    active = auth_session("active")
    old_expired = auth_session("old-expired")
    old_expired.expires_at = now - timedelta(days=8)
    old_expired.absolute_expires_at = now - timedelta(days=8)
    old_revoked = auth_session("old-revoked")
    old_revoked.revoked_at = now - timedelta(days=8)
    db_session.add_all([active, old_expired, old_revoked])
    db_session.commit()

    output: list[str] = []
    result = main(
        ["cleanup-sessions", "--retention-days", "7"],
        session_factory=cli_session_factory,
        output=output.append,
    )

    assert result == 0
    assert output == ["인증 세션 2개를 정리했습니다."]
    assert set(db_session.scalars(select(AuthSession.id)).all()) == {active.id}


def test_generated_bootstrap_password_is_printed_once_after_commit(
    cli_session_factory: sessionmaker[Session],
    db_session: Session,
) -> None:
    from auth.cli import main

    output: list[str] = []
    result = main(
        [
            "bootstrap-admin",
            "--username",
            "research-admin",
            "--generate-password",
        ],
        session_factory=cli_session_factory,
        output=output.append,
    )

    assert result == 0
    prefix = "초기 관리자 비밀번호: "
    password_lines = [line for line in output if line.startswith(prefix)]
    assert len(password_lines) == 1
    generated = password_lines[0].removeprefix(prefix)
    assert len(generated) == 20
    assert "\n".join(output).count(generated) == 1
    account = db_session.scalar(select(UserAccount))
    assert account is not None
    assert PasswordService(
        PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1)
    ).verify(account.password_hash, generated)


def test_bootstrap_password_mismatch_creates_nothing(
    cli_session_factory: sessionmaker[Session],
    db_session: Session,
) -> None:
    from auth.cli import main

    output: list[str] = []
    result = main(
        ["bootstrap-admin", "--username", "research-admin"],
        session_factory=cli_session_factory,
        password_reader=password_reader(
            [VALID_ADMIN_PASSWORD, "different-administrator-passphrase"]
        ),
        output=output.append,
    )

    assert result == 2
    assert output == ["비밀번호가 일치하지 않습니다."]
    assert db_session.scalar(select(func.count(UserAccount.id))) == 0
    assert db_session.scalar(select(func.count(AuditEvent.id))) == 0
