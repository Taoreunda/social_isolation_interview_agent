"""FastAPI authentication boundary tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

import api
from auth.models import UserAccount
from auth.policy import AccountStatus, Role
from auth.security import PasswordService

ALLOWED_ORIGIN = "http://127.0.0.1:5173"
VALID_PASSWORD = "research-passphrase"


class ApiClock:
    def __init__(self) -> None:
        self.now = datetime(2026, 9, 4, 1, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **delta: float) -> None:
        self.now += timedelta(**delta)


@pytest.fixture
def api_password_service() -> PasswordService:
    return PasswordService(
        PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1)
    )


@pytest.fixture
def api_participant(
    db_session: Session,
    api_password_service: PasswordService,
) -> UserAccount:
    now = datetime(2026, 9, 4, 1, 0, tzinfo=timezone.utc)
    account = UserAccount(
        normalized_username="participant-001",
        display_username="participant-001",
        password_hash=api_password_service.hash(VALID_PASSWORD),
        role=Role.PARTICIPANT.value,
        status=AccountStatus.ACTIVE.value,
        participant_code="P-001",
        created_at=now,
        updated_at=now,
        password_changed_at=now,
    )
    db_session.add(account)
    db_session.commit()
    return account


def test_login_sets_http_only_session_and_csrf_cookies(
    api_participant: UserAccount,
) -> None:
    with TestClient(api.app) as client:
        response = client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_participant.display_username,
                "password": VALID_PASSWORD,
                "remember": True,
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "id": str(api_participant.id),
        "username": api_participant.display_username,
        "role": "participant",
        "participantCode": "P-001",
    }
    cookies = response.headers.get_list("set-cookie")
    session_cookie = next(item for item in cookies if item.startswith("dabom_session="))
    csrf_cookie = next(item for item in cookies if item.startswith("dabom_csrf="))
    assert "HttpOnly" in session_cookie
    assert "SameSite=lax" in session_cookie
    assert "Max-Age=2592000" in session_cookie
    assert "HttpOnly" not in csrf_cookie
    assert "SameSite=lax" in csrf_cookie
    assert "session_token" not in response.text
    assert "csrf_token" not in response.text


def test_login_uses_one_generic_error_for_unknown_wrong_and_disabled_accounts(
    api_participant: UserAccount,
    db_session: Session,
) -> None:
    with TestClient(api.app) as client:
        unknown = client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={"username": "missing-user", "password": VALID_PASSWORD},
        )
        wrong = client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_participant.display_username,
                "password": "wrong-password",
            },
        )
        api_participant.status = AccountStatus.DISABLED.value
        db_session.commit()
        disabled = client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_participant.display_username,
                "password": VALID_PASSWORD,
            },
        )

    assert [unknown.status_code, wrong.status_code, disabled.status_code] == [
        401,
        401,
        401,
    ]
    assert {response.json()["detail"] for response in (unknown, wrong, disabled)} == {
        "로그인 정보를 확인해 주세요."
    }


@pytest.mark.parametrize("origin", [None, "https://attacker.example"])
def test_login_rejects_missing_or_disallowed_origin(
    api_participant: UserAccount,
    origin: str | None,
) -> None:
    headers = {"Origin": origin} if origin is not None else {}

    with TestClient(api.app) as client:
        response = client.post(
            "/api/auth/login",
            headers=headers,
            json={
                "username": api_participant.display_username,
                "password": VALID_PASSWORD,
            },
        )

    assert response.status_code == 403


def test_logout_requires_origin_and_matching_double_submit_csrf(
    api_participant: UserAccount,
) -> None:
    with TestClient(api.app) as client:
        login = client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_participant.display_username,
                "password": VALID_PASSWORD,
            },
        )
        assert login.status_code == 200
        csrf_token = client.cookies.get("dabom_csrf")
        assert csrf_token is not None

        missing_csrf = client.post(
            "/api/auth/logout",
            headers={"Origin": ALLOWED_ORIGIN},
        )
        wrong_origin = client.post(
            "/api/auth/logout",
            headers={
                "Origin": "https://attacker.example",
                "X-CSRF-Token": csrf_token,
            },
        )
        wrong_header = client.post(
            "/api/auth/logout",
            headers={"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": "wrong-token"},
        )
        success = client.post(
            "/api/auth/logout",
            headers={"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": csrf_token},
        )
        after_logout = client.get("/api/auth/me")

    assert missing_csrf.status_code == 403
    assert wrong_origin.status_code == 403
    assert wrong_header.status_code == 403
    assert success.status_code == 204
    assert client.cookies.get("dabom_session") is None
    assert client.cookies.get("dabom_csrf") is None
    assert after_logout.status_code == 401


def test_me_refreshes_remembered_cookie_when_server_session_renews(
    api_participant: UserAccount,
) -> None:
    from auth.dependencies import get_clock

    clock = ApiClock()
    api.app.dependency_overrides[get_clock] = lambda: clock
    try:
        with TestClient(api.app) as client:
            login = client.post(
                "/api/auth/login",
                headers={"Origin": ALLOWED_ORIGIN},
                json={
                    "username": api_participant.display_username,
                    "password": VALID_PASSWORD,
                    "remember": True,
                },
            )
            assert login.status_code == 200
            clock.advance(days=23)

            response = client.get("/api/auth/me")
    finally:
        api.app.dependency_overrides.pop(get_clock, None)

    assert response.status_code == 200
    refreshed = response.headers.get_list("set-cookie")
    assert any(
        item.startswith("dabom_session=") and "Max-Age=2592000" in item
        for item in refreshed
    )
    assert any(
        item.startswith("dabom_csrf=") and "Max-Age=2592000" in item
        for item in refreshed
    )


def test_password_change_accepts_camel_case_and_clears_revoked_session(
    api_participant: UserAccount,
) -> None:
    with TestClient(api.app) as client:
        login = client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_participant.display_username,
                "password": VALID_PASSWORD,
            },
        )
        assert login.status_code == 200
        csrf_token = client.cookies.get("dabom_csrf")
        assert csrf_token is not None

        changed = client.post(
            "/api/auth/password",
            headers={"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": csrf_token},
            json={
                "currentPassword": VALID_PASSWORD,
                "newPassword": "changed-research-passphrase",
            },
        )
        current_user = client.get("/api/auth/me")

    assert changed.status_code == 204
    assert client.cookies.get("dabom_session") is None
    assert client.cookies.get("dabom_csrf") is None
    assert current_user.status_code == 401


def test_wrong_current_password_keeps_authenticated_session(
    api_participant: UserAccount,
) -> None:
    with TestClient(api.app) as client:
        login = client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_participant.display_username,
                "password": VALID_PASSWORD,
            },
        )
        csrf_token = client.cookies.get("dabom_csrf")
        assert login.status_code == 200
        assert csrf_token is not None

        response = client.post(
            "/api/auth/password",
            headers={"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": csrf_token},
            json={
                "currentPassword": "wrong-password",
                "newPassword": "changed-research-passphrase",
            },
        )
        current_user = client.get("/api/auth/me")

    assert response.status_code == 400
    assert current_user.status_code == 200


def test_cors_allows_only_configured_application_origin() -> None:
    with TestClient(api.app) as client:
        allowed = client.options(
            "/api/auth/login",
            headers={
                "Origin": ALLOWED_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        denied = client.options(
            "/api/auth/login",
            headers={
                "Origin": "https://attacker.example",
                "Access-Control-Request-Method": "POST",
            },
        )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    assert allowed.headers["access-control-allow-credentials"] == "true"
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers


def test_health_is_live_and_readiness_reflects_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with TestClient(api.app) as client:
        live = client.get("/api/health")
        ready = client.get("/api/ready")
        monkeypatch.setattr(api, "check_database", lambda: False)
        unavailable = client.get("/api/ready")

    assert live.status_code == 200
    assert live.json() == {"status": "ok"}
    assert ready.status_code == 200
    assert ready.json() == {"status": "ready"}
    assert unavailable.status_code == 503
    assert unavailable.json() == {"detail": "필수 서비스를 사용할 수 없습니다."}


def test_secure_cookie_flag_is_environment_controlled(
    api_participant: UserAccount,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "true")

    with TestClient(api.app) as client:
        response = client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_participant.display_username,
                "password": VALID_PASSWORD,
            },
        )

    assert response.status_code == 200
    assert all("Secure" in item for item in response.headers.get_list("set-cookie"))


def test_logout_database_failure_returns_safe_service_unavailable(
    api_participant: UserAccount,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from auth.service import AuthenticationService

    with TestClient(api.app, raise_server_exceptions=False) as client:
        login = client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_participant.display_username,
                "password": VALID_PASSWORD,
            },
        )
        csrf_token = client.cookies.get("dabom_csrf")
        assert login.status_code == 200
        assert csrf_token is not None

        def fail_logout(_service, _raw_token: str) -> None:
            raise OperationalError("session revocation", {}, RuntimeError("offline"))

        monkeypatch.setattr(AuthenticationService, "logout", fail_logout)
        response = client.post(
            "/api/auth/logout",
            headers={"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": csrf_token},
        )

    assert response.status_code == 503
    assert response.json() == {"detail": "필수 서비스를 사용할 수 없습니다."}
    assert "offline" not in response.text
