"""FastAPI authentication boundary tests."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import api
import pytest
from argon2 import PasswordHasher
from auth.models import AuditEvent, AuthSession, UserAccount
from auth.policy import AccountStatus, Role
from auth.security import PasswordService
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

ALLOWED_ORIGIN = "http://127.0.0.1:5173"
VALID_PASSWORD = "research-passphrase"


class ApiClock:
    def __init__(self) -> None:
        self.now = datetime(2026, 9, 4, 1, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **delta: float) -> None:
        self.now += timedelta(**delta)


@pytest.fixture
def api_password_service() -> PasswordService:
    return PasswordService(PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1))


@pytest.fixture
def api_participant(
    db_session: Session,
    api_password_service: PasswordService,
) -> UserAccount:
    now = datetime(2026, 9, 4, 1, 0, tzinfo=UTC)
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


@pytest.fixture
def api_admin(
    db_session: Session,
    api_password_service: PasswordService,
) -> UserAccount:
    now = datetime(2026, 9, 4, 1, 0, tzinfo=UTC)
    account = UserAccount(
        normalized_username="research-admin",
        display_username="research-admin",
        password_hash=api_password_service.hash(VALID_PASSWORD),
        role=Role.ADMIN.value,
        status=AccountStatus.ACTIVE.value,
        participant_code=None,
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


def test_admin_creates_participant_with_one_time_generated_password(
    api_admin: UserAccount,
    api_password_service: PasswordService,
    db_session: Session,
) -> None:
    with TestClient(api.app) as client:
        login = client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_admin.display_username,
                "password": VALID_PASSWORD,
            },
        )
        csrf_token = client.cookies.get("dabom_csrf")
        assert login.status_code == 200
        assert csrf_token is not None

        response = client.post(
            "/api/admin/participants",
            headers={"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": csrf_token},
            json={
                "username": "participant-002",
                "participantCode": "p-002",
                "generatePassword": True,
            },
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["participant"] == {
        "id": payload["participant"]["id"],
        "username": "participant-002",
        "participantCode": "P-002",
        "status": "active",
        "interviewStatus": "not_started",
        "temporaryLockedUntil": None,
    }
    assigned_password = payload["assignedPassword"]
    assert len(assigned_password) >= 10
    assert "-" in assigned_password, "the password is derived from the research code"
    assert "passwordHash" not in response.text

    created = db_session.scalar(
        select(UserAccount).where(UserAccount.normalized_username == "participant-002")
    )
    assert created is not None
    assert api_password_service.verify(created.password_hash, assigned_password)
    event = db_session.scalar(
        select(AuditEvent).where(AuditEvent.action == "account.created")
    )
    assert event is not None
    assert event.actor_user_id == api_admin.id
    assert event.target_id == created.id
    assert event.details == {"role": "participant"}


def test_the_participant_listing_shows_a_temporary_lock_deadline(
    api_admin: UserAccount,
    api_participant: UserAccount,
    db_session: Session,
) -> None:
    """An administrator has to be able to see why a participant cannot log in."""
    deadline = datetime(2026, 9, 4, 2, 15, tzinfo=UTC)
    api_participant.failed_login_count = 5
    api_participant.temporary_locked_until = deadline
    db_session.commit()

    with TestClient(api.app) as client:
        login = client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_admin.display_username,
                "password": VALID_PASSWORD,
            },
        )
        assert login.status_code == 200

        response = client.get("/api/admin/participants")

    assert response.status_code == 200
    row = response.json()[0]
    assert row["status"] == "active", "the account itself is not administratively locked"
    assert row["temporaryLockedUntil"] == deadline.isoformat().replace("+00:00", "Z")


def test_admin_lists_participants_including_administrator_lock_state(
    api_admin: UserAccount,
    api_participant: UserAccount,
    db_session: Session,
) -> None:
    api_participant.status = AccountStatus.ADMIN_LOCKED.value
    db_session.commit()

    with TestClient(api.app) as client:
        login = client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_admin.display_username,
                "password": VALID_PASSWORD,
            },
        )
        assert login.status_code == 200

        response = client.get("/api/admin/participants")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": str(api_participant.id),
            "username": api_participant.display_username,
            "participantCode": api_participant.participant_code,
            "status": "admin_locked",
            "interviewStatus": "not_started",
            "temporaryLockedUntil": None,
        }
    ]


def test_participant_cannot_use_admin_route_and_keeps_session(
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

        forbidden = client.get("/api/admin/participants")
        current_user = client.get("/api/auth/me")

    assert forbidden.status_code == 403
    assert current_user.status_code == 200
    assert current_user.json()["role"] == "participant"


def test_admin_password_reset_revokes_only_target_sessions_and_returns_password_once(
    api_admin: UserAccount,
    api_participant: UserAccount,
    api_password_service: PasswordService,
    db_session: Session,
) -> None:
    with TestClient(api.app) as participant_client:
        participant_login = participant_client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_participant.display_username,
                "password": VALID_PASSWORD,
                "remember": True,
            },
        )
        assert participant_login.status_code == 200

    with TestClient(api.app) as admin_client:
        admin_login = admin_client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_admin.display_username,
                "password": VALID_PASSWORD,
            },
        )
        csrf_token = admin_client.cookies.get("dabom_csrf")
        assert admin_login.status_code == 200
        assert csrf_token is not None

        response = admin_client.post(
            f"/api/admin/participants/{api_participant.id}/password",
            headers={"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": csrf_token},
            json={"generatePassword": True},
        )
        admin_still_authenticated = admin_client.get("/api/auth/me")

    assert response.status_code == 200
    assigned_password = response.json()["assignedPassword"]
    assert len(assigned_password) >= 10
    assert "-" in assigned_password, "the password is derived from the research code"
    db_session.refresh(api_participant)
    assert api_password_service.verify(api_participant.password_hash, assigned_password)
    sessions = db_session.scalars(select(AuthSession)).all()
    for auth_session in sessions:
        db_session.refresh(auth_session)
    target_sessions = [
        auth_session
        for auth_session in sessions
        if auth_session.user_id == api_participant.id
    ]
    admin_sessions = [
        auth_session
        for auth_session in sessions
        if auth_session.user_id == api_admin.id
    ]
    assert target_sessions
    assert all(auth_session.revoked_at is not None for auth_session in target_sessions)
    assert admin_sessions
    assert all(auth_session.revoked_at is None for auth_session in admin_sessions)
    assert admin_still_authenticated.status_code == 200
    event = db_session.scalar(
        select(AuditEvent).where(AuditEvent.action == "account.password_reset")
    )
    assert event is not None
    assert event.actor_user_id == api_admin.id
    assert event.target_id == api_participant.id


def test_admin_disable_revokes_target_session_and_writes_audit(
    api_admin: UserAccount,
    api_participant: UserAccount,
    db_session: Session,
) -> None:
    with TestClient(api.app) as participant_client, TestClient(api.app) as admin_client:
        participant_login = participant_client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_participant.display_username,
                "password": VALID_PASSWORD,
            },
        )
        admin_login = admin_client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_admin.display_username,
                "password": VALID_PASSWORD,
            },
        )
        csrf_token = admin_client.cookies.get("dabom_csrf")
        assert participant_login.status_code == 200
        assert admin_login.status_code == 200
        assert csrf_token is not None

        response = admin_client.post(
            f"/api/admin/participants/{api_participant.id}/disable",
            headers={"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": csrf_token},
        )
        target_session = participant_client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.json()["status"] == "disabled"
    assert target_session.status_code == 401
    db_session.refresh(api_participant)
    assert api_participant.status == AccountStatus.DISABLED.value
    event = db_session.scalar(
        select(AuditEvent).where(AuditEvent.action == "account.disabled")
    )
    assert event is not None
    assert event.actor_user_id == api_admin.id
    assert event.target_id == api_participant.id


def test_disable_does_not_commit_when_interview_status_lookup_fails(
    api_admin: UserAccount,
    api_participant: UserAccount,
    db_session: Session,
) -> None:
    from auth.admin_router import get_participant_status_service

    class FailingInterviewStatusService:
        def statuses_for_participants(self, _participant_ids):
            raise OperationalError("interview status", {}, RuntimeError("offline"))

    api.app.dependency_overrides[get_participant_status_service] = (
        lambda: FailingInterviewStatusService()
    )
    try:
        with TestClient(api.app, raise_server_exceptions=False) as client:
            login = client.post(
                "/api/auth/login",
                headers={"Origin": ALLOWED_ORIGIN},
                json={
                    "username": api_admin.display_username,
                    "password": VALID_PASSWORD,
                },
            )
            csrf_token = client.cookies.get("dabom_csrf")
            assert login.status_code == 200
            assert csrf_token is not None

            response = client.post(
                f"/api/admin/participants/{api_participant.id}/disable",
                headers={
                    "Origin": ALLOWED_ORIGIN,
                    "X-CSRF-Token": csrf_token,
                },
            )
    finally:
        api.app.dependency_overrides.pop(get_participant_status_service, None)

    assert response.status_code == 503
    db_session.refresh(api_participant)
    assert api_participant.status == AccountStatus.ACTIVE.value


def test_admin_unlock_resets_failure_state_without_restoring_old_session(
    api_admin: UserAccount,
    api_participant: UserAccount,
    db_session: Session,
) -> None:
    with TestClient(api.app) as participant_client:
        participant_login = participant_client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_participant.display_username,
                "password": VALID_PASSWORD,
            },
        )
        assert participant_login.status_code == 200

        locked_at = datetime(2026, 9, 4, 2, 0, tzinfo=UTC)
        api_participant.status = AccountStatus.ADMIN_LOCKED.value
        api_participant.failed_login_count = 4
        api_participant.failure_window_started_at = locked_at - timedelta(minutes=2)
        api_participant.temporary_locked_until = locked_at + timedelta(minutes=10)
        api_participant.lock_stage = 1
        api_participant.admin_locked_at = locked_at
        db_session.commit()

        with TestClient(api.app) as admin_client:
            admin_login = admin_client.post(
                "/api/auth/login",
                headers={"Origin": ALLOWED_ORIGIN},
                json={
                    "username": api_admin.display_username,
                    "password": VALID_PASSWORD,
                },
            )
            csrf_token = admin_client.cookies.get("dabom_csrf")
            assert admin_login.status_code == 200
            assert csrf_token is not None

            response = admin_client.post(
                f"/api/admin/participants/{api_participant.id}/unlock",
                headers={"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": csrf_token},
            )
        old_session = participant_client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.json()["status"] == "active"
    assert old_session.status_code == 401
    db_session.refresh(api_participant)
    assert api_participant.failed_login_count == 0
    assert api_participant.failure_window_started_at is None
    assert api_participant.temporary_locked_until is None
    assert api_participant.lock_stage == 0
    assert api_participant.last_unlocked_by_user_id == api_admin.id
    assert api_participant.last_unlocked_at is not None
    event = db_session.scalar(
        select(AuditEvent).where(AuditEvent.action == "account.unlocked")
    )
    assert event is not None
    assert event.actor_user_id == api_admin.id
    assert event.target_id == api_participant.id


def test_direct_password_is_not_echoed_and_normalized_duplicates_conflict(
    api_admin: UserAccount,
) -> None:
    direct_password = "direct-research-passphrase"
    with TestClient(api.app) as client:
        login = client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_admin.display_username,
                "password": VALID_PASSWORD,
            },
        )
        csrf_token = client.cookies.get("dabom_csrf")
        assert login.status_code == 200
        assert csrf_token is not None
        headers = {"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": csrf_token}

        created = client.post(
            "/api/admin/participants",
            headers=headers,
            json={
                "username": "participant-003",
                "participantCode": "P-003",
                "password": direct_password,
            },
        )
        duplicate_username = client.post(
            "/api/admin/participants",
            headers=headers,
            json={
                "username": "PARTICIPANT-003",
                "participantCode": "P-004",
                "password": direct_password,
            },
        )
        duplicate_code = client.post(
            "/api/admin/participants",
            headers=headers,
            json={
                "username": "participant-004",
                "participantCode": "p-003",
                "password": direct_password,
            },
        )

    assert created.status_code == 201
    assert created.json()["assignedPassword"] is None
    assert direct_password not in created.text
    assert duplicate_username.status_code == 409
    assert duplicate_code.status_code == 409
    assert duplicate_username.json() == duplicate_code.json()


def test_unlock_rejects_non_locked_or_missing_participant(
    api_admin: UserAccount,
    api_participant: UserAccount,
) -> None:
    with TestClient(api.app) as client:
        login = client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_admin.display_username,
                "password": VALID_PASSWORD,
            },
        )
        csrf_token = client.cookies.get("dabom_csrf")
        assert login.status_code == 200
        assert csrf_token is not None
        headers = {"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": csrf_token}

        active = client.post(
            f"/api/admin/participants/{api_participant.id}/unlock",
            headers=headers,
        )
        missing = client.post(
            f"/api/admin/participants/{uuid4()}/unlock",
            headers=headers,
        )

    assert active.status_code == 409
    assert missing.status_code == 404


def test_participant_cannot_run_administrator_mutation_with_valid_csrf(
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

        forbidden = client.post(
            "/api/admin/participants",
            headers={"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": csrf_token},
            json={
                "username": "participant-005",
                "participantCode": "P-005",
                "generatePassword": True,
            },
        )
        current_user = client.get("/api/auth/me")

    assert forbidden.status_code == 403
    assert current_user.status_code == 200


def _sign_in_admin(client: TestClient, admin: UserAccount) -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        headers={"Origin": ALLOWED_ORIGIN},
        json={"username": admin.display_username, "password": VALID_PASSWORD},
    )
    assert response.status_code == 200
    csrf = client.cookies.get("dabom_csrf")
    assert csrf is not None
    return {"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": csrf}


def test_creating_a_participant_allocates_the_next_research_code(
    db_session: Session,
    api_admin: UserAccount,
) -> None:
    with TestClient(api.app) as client:
        headers = _sign_in_admin(client, api_admin)
        first = client.post(
            "/api/admin/participants",
            headers=headers,
            json={"generatePassword": True},
        )
        second = client.post(
            "/api/admin/participants",
            headers=headers,
            json={"generatePassword": True},
        )

    assert first.status_code == 201, first.text
    assert first.json()["participant"]["participantCode"] == "KU-001"
    assert first.json()["participant"]["username"] == "ku-001"
    assert second.json()["participant"]["participantCode"] == "KU-002"

    assigned = first.json()["assignedPassword"]
    assert assigned.startswith("ku-001-")
    assert len(assigned) >= 10

    with TestClient(api.app) as participant_client:
        signed_in = participant_client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={"username": "ku-001", "password": assigned},
        )
    assert signed_in.status_code == 200, "the assigned password actually works"


def test_an_explicit_code_and_username_are_still_honoured(
    db_session: Session,
    api_admin: UserAccount,
) -> None:
    with TestClient(api.app) as client:
        headers = _sign_in_admin(client, api_admin)
        created = client.post(
            "/api/admin/participants",
            headers=headers,
            json={
                "username": "custom-name",
                "participantCode": "X-9",
                "generatePassword": True,
            },
        )

    assert created.status_code == 201, created.text
    assert created.json()["participant"]["participantCode"] == "X-9"
    assert created.json()["participant"]["username"] == "custom-name"


def test_a_disabled_participant_can_be_brought_back(
    db_session: Session,
    api_admin: UserAccount,
    api_participant: UserAccount,
) -> None:
    with TestClient(api.app) as client:
        headers = _sign_in_admin(client, api_admin)
        disabled = client.post(
            f"/api/admin/participants/{api_participant.id}/disable",
            headers=headers,
        )
        enabled = client.post(
            f"/api/admin/participants/{api_participant.id}/enable",
            headers=headers,
        )
        already_active = client.post(
            f"/api/admin/participants/{api_participant.id}/enable",
            headers=headers,
        )

    assert disabled.status_code == 200
    assert disabled.json()["status"] == "disabled"
    assert enabled.status_code == 200
    assert enabled.json()["status"] == "active"
    assert already_active.status_code == 409, "enabling an active account is a no-op conflict"

    with TestClient(api.app) as participant_client:
        signed_in = participant_client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={
                "username": api_participant.display_username,
                "password": VALID_PASSWORD,
            },
        )
    assert signed_in.status_code == 200, "the participant can sign in again"

    actions = list(db_session.scalars(select(AuditEvent.action)))
    assert "account.enabled" in actions
