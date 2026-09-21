"""The first administrator may come from the environment, once."""

from __future__ import annotations

import logging

import api
import pytest
from argon2 import PasswordHasher
from auth.env_bootstrap import BootstrapOutcome, bootstrap_admin_from_env
from auth.models import AuditEvent, UserAccount
from auth.security import PasswordService
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

USERNAME = "BOOTSTRAP_ADMIN_USERNAME"
PASSWORD = "BOOTSTRAP_ADMIN_PASSWORD"
SECRET = "a-long-first-passphrase"


@pytest.fixture
def fast_passwords() -> PasswordService:
    return PasswordService(PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1))


def factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


def test_the_first_administrator_comes_from_the_environment(
    db_session: Session,
    postgres_engine: Engine,
    fast_passwords: PasswordService,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)

    outcome = bootstrap_admin_from_env(
        environ={USERNAME: "First-Admin", PASSWORD: SECRET},
        session_factory=factory(postgres_engine),
        password_service=fast_passwords,
    )

    assert outcome is BootstrapOutcome.CREATED
    account = db_session.scalar(select(UserAccount))
    assert account is not None
    assert (account.display_username, account.role, account.participant_code) == ("First-Admin", "admin", None)
    assert fast_passwords.verify(account.password_hash, SECRET)
    event = db_session.scalar(select(AuditEvent).where(AuditEvent.action == "account.created"))
    assert event is not None and event.details == {"role": "admin", "source": "environment"}
    assert SECRET not in caplog.text, "the password never reaches a log"
    assert PASSWORD in caplog.text, "the operator is told to remove the variables"


def test_the_environment_is_ignored_once_an_administrator_exists(
    db_session: Session,
    postgres_engine: Engine,
    fast_passwords: PasswordService,
) -> None:
    bootstrap_admin_from_env(
        environ={USERNAME: "first-admin", PASSWORD: SECRET},
        session_factory=factory(postgres_engine),
        password_service=fast_passwords,
    )
    original_hash = db_session.scalar(select(UserAccount.password_hash))

    outcome = bootstrap_admin_from_env(
        environ={USERNAME: "first-admin", PASSWORD: "a-different-passphrase"},
        session_factory=factory(postgres_engine),
        password_service=fast_passwords,
    )

    assert outcome is BootstrapOutcome.ADMIN_EXISTS
    db_session.expire_all()
    assert db_session.scalar(select(func.count(UserAccount.id))) == 1
    assert db_session.scalar(select(UserAccount.password_hash)) == original_hash, (
        "an existing administrator is never rewritten from the environment"
    )


@pytest.mark.parametrize(
    "environ",
    [
        {USERNAME: "first-admin", PASSWORD: "short"},
        {USERNAME: "first-admin", PASSWORD: "first-admin"},
        {USERNAME: "no", PASSWORD: SECRET},
        {USERNAME: "first-admin"},
        {PASSWORD: SECRET},
    ],
)
def test_a_weak_or_incomplete_setting_creates_nothing(
    environ: dict[str, str],
    db_session: Session,
    postgres_engine: Engine,
    fast_passwords: PasswordService,
) -> None:
    outcome = bootstrap_admin_from_env(
        environ=environ,
        session_factory=factory(postgres_engine),
        password_service=fast_passwords,
    )

    assert outcome is BootstrapOutcome.REJECTED
    assert db_session.scalar(select(func.count(UserAccount.id))) == 0


def test_nothing_is_touched_when_the_variables_are_absent() -> None:
    def untouched() -> Session:
        raise AssertionError("the database must not be opened")

    assert bootstrap_admin_from_env(environ={}, session_factory=untouched) is BootstrapOutcome.NOT_CONFIGURED


def test_an_unreachable_database_does_not_stop_the_server(fast_passwords: PasswordService) -> None:
    def down() -> Session:
        raise OperationalError("connect", {}, Exception("refused"))

    outcome = bootstrap_admin_from_env(
        environ={USERNAME: "first-admin", PASSWORD: SECRET},
        session_factory=down,
        password_service=fast_passwords,
    )

    assert outcome is BootstrapOutcome.UNAVAILABLE


def test_the_server_bootstraps_on_startup_and_the_administrator_can_sign_in(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(USERNAME, "startup-admin")
    monkeypatch.setenv(PASSWORD, SECRET)

    with TestClient(api.app) as client:
        signed_in = client.post(
            "/api/auth/login",
            headers={"Origin": "http://127.0.0.1:5173"},
            json={"username": "startup-admin", "password": SECRET},
        )

    assert signed_in.status_code == 200
    assert signed_in.json()["role"] == "admin"
