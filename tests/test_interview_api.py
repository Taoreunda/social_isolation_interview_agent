"""Authenticated HTTP boundary tests for durable interviews."""

from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import api
import pytest
from argon2 import PasswordHasher
from auth.models import AuditEvent, UserAccount
from auth.policy import AccountStatus, Role
from auth.security import PasswordService
from fastapi.testclient import TestClient
from interview.engine import EngineTurnResult, InterviewGenerationError
from interview.router import get_interview_engine
from interview.scorecard import Scorecard
from sqlalchemy import select
from sqlalchemy.orm import Session

ALLOWED_ORIGIN = "http://127.0.0.1:5173"
VALID_PASSWORD = "research-passphrase"
NOW = datetime(2026, 9, 5, 3, 0, tzinfo=UTC)


class ApiFakeEngine:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def run_persisted_turn(
        self,
        session_id: str,
        messages: list[dict[str, str]],
        scorecard: dict[str, Any],
        user_input: str,
    ) -> EngineTurnResult:
        self.calls.append(
            {
                "session_id": session_id,
                "messages": deepcopy(messages),
                "user_input": user_input,
            }
        )
        if user_input == "provider-fail":
            raise InterviewGenerationError("secret upstream diagnostic")

        state = deepcopy(scorecard)
        if user_input:
            restored = Scorecard.from_dict(state)
            if restored.items["A1"]["status"] is None:
                restored.record("A1", "positive", "=external()", "답변에서 확인")
            state = restored.to_dict()
        return EngineTurnResult(
            participant_message=("첫 질문입니다." if not messages else "다음 질문입니다."),
            scorecard=state,
            interview_complete=False,
            final_diagnosis=None,
            report=None,
        )


@pytest.fixture
def api_fake_engine() -> ApiFakeEngine:
    engine = ApiFakeEngine()
    api.app.dependency_overrides[get_interview_engine] = lambda: engine
    try:
        yield engine
    finally:
        api.app.dependency_overrides.pop(get_interview_engine, None)


@pytest.fixture
def api_password_service() -> PasswordService:
    return PasswordService(PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1))


def create_account(
    session: Session,
    password_service: PasswordService,
    *,
    username: str,
    role: str,
    participant_code: str | None,
) -> UserAccount:
    account = UserAccount(
        normalized_username=username,
        display_username=username,
        password_hash=password_service.hash(VALID_PASSWORD),
        role=role,
        status=AccountStatus.ACTIVE.value,
        participant_code=participant_code,
        created_at=NOW,
        updated_at=NOW,
        password_changed_at=NOW,
    )
    session.add(account)
    session.commit()
    return account


def login(client: TestClient, account: UserAccount) -> str:
    response = client.post(
        "/api/auth/login",
        headers={"Origin": ALLOWED_ORIGIN},
        json={"username": account.display_username, "password": VALID_PASSWORD},
    )
    assert response.status_code == 200
    csrf = client.cookies.get("dabom_csrf")
    assert csrf is not None
    return csrf


def mutation_headers(csrf: str) -> dict[str, str]:
    return {"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": csrf}


def test_unauthenticated_legacy_interview_routes_are_not_registered() -> None:
    legacy_paths = {
        "/api/start",
        "/api/message",
        "/api/stream",
        "/api/reset",
        "/api/review",
        "/api/review/bulk-approve",
        "/api/csv/{session_id}",
        "/api/sessions",
        "/api/sessions/{session_id}",
    }

    with TestClient(api.app) as client:
        registered_paths = set(client.get("/openapi.json").json()["paths"])

    assert legacy_paths.isdisjoint(registered_paths)


def test_model_initialization_failure_returns_a_safe_service_error(
    db_session: Session,
    api_password_service: PasswordService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import interview.router as interview_router

    participant = create_account(
        db_session,
        api_password_service,
        username="participant-no-model",
        role=Role.PARTICIPANT.value,
        participant_code="P-NO-MODEL",
    )

    def fail_engine() -> None:
        raise RuntimeError("secret provider setup detail")

    interview_router.get_interview_engine.cache_clear()
    monkeypatch.setattr(interview_router, "InterviewEngine", fail_engine)
    try:
        with TestClient(api.app, raise_server_exceptions=False) as client:
            csrf = login(client, participant)
            response = client.post(
                "/api/interviews",
                headers=mutation_headers(csrf),
            )
    finally:
        interview_router.get_interview_engine.cache_clear()

    assert response.status_code == 503
    assert "secret provider setup detail" not in response.text


def test_participant_start_requires_auth_origin_csrf_and_correct_role(
    db_session: Session,
    api_password_service: PasswordService,
    api_fake_engine: ApiFakeEngine,
) -> None:
    participant = create_account(
        db_session,
        api_password_service,
        username="participant-101",
        role=Role.PARTICIPANT.value,
        participant_code="P-101",
    )
    admin = create_account(
        db_session,
        api_password_service,
        username="admin-101",
        role=Role.ADMIN.value,
        participant_code=None,
    )

    with TestClient(api.app) as anonymous:
        assert anonymous.get("/api/interviews/current").status_code == 401

    with TestClient(api.app) as participant_client:
        csrf = login(participant_client, participant)
        assert participant_client.get("/api/interviews/current").status_code == 404
        assert participant_client.post("/api/interviews").status_code == 403
        started = participant_client.post(
            "/api/interviews",
            headers=mutation_headers(csrf),
        )
        current = participant_client.get("/api/interviews/current")

    assert started.status_code == 201
    assert started.json() == current.json()
    assert started.json()["status"] == "active"
    assert started.json()["messages"][0]["content"] == "첫 질문입니다."
    assert "participantCode" not in started.json()
    assert "scorecard" not in started.json()
    assert len(api_fake_engine.calls) == 1

    with TestClient(api.app) as admin_client:
        admin_csrf = login(admin_client, admin)
        admin_started = admin_client.post(
            "/api/interviews",
            headers=mutation_headers(admin_csrf),
        )
    assert admin_started.status_code == 201
    assert admin_started.json()["id"] != started.json()["id"], (
        "an administrator gets an interview of their own, never the participant's"
    )


def test_message_retry_ownership_and_generation_failure_are_safe(
    db_session: Session,
    api_password_service: PasswordService,
    api_fake_engine: ApiFakeEngine,
) -> None:
    owner = create_account(
        db_session,
        api_password_service,
        username="participant-owner",
        role=Role.PARTICIPANT.value,
        participant_code="P-OWNER",
    )
    other = create_account(
        db_session,
        api_password_service,
        username="participant-other",
        role=Role.PARTICIPANT.value,
        participant_code="P-OTHER",
    )
    turn_id = str(uuid4())

    with TestClient(api.app) as owner_client:
        csrf = login(owner_client, owner)
        started = owner_client.post(
            "/api/interviews", headers=mutation_headers(csrf)
        ).json()
        interview_id = started["id"]

        missing_csrf = owner_client.post(
            f"/api/interviews/{interview_id}/messages",
            headers={"Origin": ALLOWED_ORIGIN},
            json={"clientTurnId": turn_id, "content": "첫 답변"},
        )
        committed = owner_client.post(
            f"/api/interviews/{interview_id}/messages",
            headers=mutation_headers(csrf),
            json={"clientTurnId": turn_id, "content": "첫 답변"},
        )
        duplicate = owner_client.post(
            f"/api/interviews/{interview_id}/messages",
            headers=mutation_headers(csrf),
            json={"clientTurnId": turn_id, "content": "다른 재시도 본문"},
        )
        failed = owner_client.post(
            f"/api/interviews/{interview_id}/messages",
            headers=mutation_headers(csrf),
            json={"clientTurnId": str(uuid4()), "content": "provider-fail"},
        )
        after_failure = owner_client.get("/api/interviews/current")

    assert missing_csrf.status_code == 403
    assert committed.status_code == 200
    assert duplicate.json() == committed.json()
    assert len(committed.json()["messages"]) == 3
    assert failed.status_code == 503
    assert "secret upstream diagnostic" not in failed.text
    assert after_failure.json() == committed.json()
    assert len(api_fake_engine.calls) == 3

    with TestClient(api.app) as other_client:
        other_csrf = login(other_client, other)
        hidden = other_client.post(
            f"/api/interviews/{interview_id}/messages",
            headers=mutation_headers(other_csrf),
            json={"clientTurnId": str(uuid4()), "content": "권한 없는 답변"},
        )
    assert hidden.status_code == 404


def test_admin_list_detail_review_export_and_participant_status(
    db_session: Session,
    api_password_service: PasswordService,
    api_fake_engine: ApiFakeEngine,
) -> None:
    participant = create_account(
        db_session,
        api_password_service,
        username="participant-201",
        role=Role.PARTICIPANT.value,
        participant_code="P-201",
    )
    admin = create_account(
        db_session,
        api_password_service,
        username="admin-201",
        role=Role.ADMIN.value,
        participant_code=None,
    )

    with TestClient(api.app) as participant_client:
        participant_csrf = login(participant_client, participant)
        started = participant_client.post(
            "/api/interviews", headers=mutation_headers(participant_csrf)
        ).json()
        interview_id = started["id"]
        participant_client.post(
            f"/api/interviews/{interview_id}/messages",
            headers=mutation_headers(participant_csrf),
            json={"clientTurnId": str(uuid4()), "content": "답변"},
        )
        assert participant_client.get("/api/admin/interviews").status_code == 403

    with TestClient(api.app) as admin_client:
        admin_csrf = login(admin_client, admin)
        listing = admin_client.get("/api/admin/interviews")
        detail = admin_client.get(f"/api/admin/interviews/{interview_id}")
        participant_listing = admin_client.get("/api/admin/participants")
        missing_csrf = admin_client.post(
            f"/api/admin/interviews/{interview_id}/scorecard/A1",
            headers={"Origin": ALLOWED_ORIGIN},
            json={"action": "approve"},
        )
        invalid_null_review = admin_client.post(
            f"/api/admin/interviews/{interview_id}/scorecard/A2",
            headers=mutation_headers(admin_csrf),
            json={"action": "approve"},
        )
        reviewed = admin_client.post(
            f"/api/admin/interviews/{interview_id}/scorecard/A1",
            headers=mutation_headers(admin_csrf),
            json={"action": "approve"},
        )
        missing_export_csrf = admin_client.post(
            f"/api/admin/interviews/{interview_id}/csv",
            headers={"Origin": ALLOWED_ORIGIN},
        )
        exported = admin_client.post(
            f"/api/admin/interviews/{interview_id}/csv",
            headers=mutation_headers(admin_csrf),
        )
        disabled = admin_client.post(
            f"/api/admin/participants/{participant.id}/disable",
            headers=mutation_headers(admin_csrf),
        )
        own_interview = admin_client.get("/api/interviews/current")

    assert listing.status_code == 200
    assert listing.json()[0]["participantCode"] == "P-201"
    assert listing.json()[0]["reviewStatus"] == "unreviewed"
    assert detail.status_code == 200
    assert detail.json()["scorecard"][0]["aiStatus"] == "positive"
    assert "finalDiagnosis" not in detail.json()
    assert participant_listing.json()[0]["interviewStatus"] == "active"
    assert missing_csrf.status_code == 403
    assert invalid_null_review.status_code == 400
    assert reviewed.status_code == 200
    assert reviewed.json()["reviewStatus"] == "reviewed"
    assert missing_export_csrf.status_code == 403
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("text/csv")
    assert "attachment" in exported.headers["content-disposition"]
    assert "'=external()" in exported.text
    assert disabled.json()["interviewStatus"] == "active"
    assert own_interview.status_code == 404, (
        "the administrator has no interview of their own here"
    )

    actions = list(db_session.scalars(select(AuditEvent.action)))
    assert "interview.scorecard_reviewed" in actions
    assert "interview.csv_exported" in actions


def test_an_administrator_can_run_an_interview_for_debugging(
    db_session: Session,
    api_password_service: PasswordService,
    api_fake_engine: ApiFakeEngine,
) -> None:
    admin = create_account(
        db_session,
        api_password_service,
        username="debug-admin",
        role=Role.ADMIN.value,
        participant_code=None,
    )
    participant = create_account(
        db_session,
        api_password_service,
        username="other-participant",
        role=Role.PARTICIPANT.value,
        participant_code="P-OTHER",
    )

    with TestClient(api.app) as admin_client:
        csrf = login(admin_client, admin)

        assert admin_client.get("/api/interviews/current").status_code == 404

        started = admin_client.post("/api/interviews", headers=mutation_headers(csrf))
        assert started.status_code == 201
        interview_id = started.json()["id"]

        turn = admin_client.post(
            f"/api/interviews/{interview_id}/messages",
            headers=mutation_headers(csrf),
            json={"clientTurnId": str(uuid4()), "content": "관리자 점검 응답"},
        )
        assert turn.status_code == 200
        assert len(turn.json()["messages"]) == 3

        listed = admin_client.get("/api/admin/interviews").json()
        own = next(row for row in listed if row["id"] == interview_id)
        assert own["participantCode"] == "관리자 (debug-admin)"

    with TestClient(api.app) as participant_client:
        participant_csrf = login(participant_client, participant)
        assert participant_client.get(
            f"/api/admin/interviews/{interview_id}"
        ).status_code == 403
        assert participant_client.post(
            f"/api/interviews/{interview_id}/messages",
            headers=mutation_headers(participant_csrf),
            json={"clientTurnId": str(uuid4()), "content": "남의 인터뷰"},
        ).status_code == 404
