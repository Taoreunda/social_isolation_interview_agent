"""Authenticated HTTP boundary tests for durable interviews."""

from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import api
import pytest
from argon2 import PasswordHasher
from auth.models import AuditEvent, UserAccount
from auth.policy import AccountStatus, Role
from auth.security import PasswordService
from fastapi.testclient import TestClient
from interview.engine import EngineTurnResult, InterviewGenerationError
from interview.router import get_interview_engine
from interview.welcome import WELCOME_MESSAGES
from interview.models import Interview
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
    opening = [message["content"] for message in started.json()["messages"]]
    assert opening == [*WELCOME_MESSAGES, "첫 질문입니다."]
    assert started.json()["suggestedReplies"] == [
        {"text": "예", "send": True},
        {"text": "아니요", "send": True},
    ], "the open question arrives with the replies a participant can tap"
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
    assert len(committed.json()["messages"]) == len(WELCOME_MESSAGES) + 3
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
    assert "finalDiagnosis" in detail.json(), (
        "the administrator detail carries the research outcome"
    )
    assert participant_listing.json()[0]["interviewStatus"] == "active"
    assert missing_csrf.status_code == 403
    assert invalid_null_review.status_code == 400
    assert reviewed.status_code == 200
    assert reviewed.json()["reviewStatus"] == "in_review", (
        "a running interview is never fully reviewed"
    )
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
        assert len(turn.json()["messages"]) == len(WELCOME_MESSAGES) + 3

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


def test_admin_detail_carries_the_research_outcome_and_participants_never_see_it(
    db_session: Session,
    api_password_service: PasswordService,
    api_fake_engine: ApiFakeEngine,
) -> None:
    participant = create_account(
        db_session,
        api_password_service,
        username="outcome-participant",
        role=Role.PARTICIPANT.value,
        participant_code="P-OUT",
    )
    admin = create_account(
        db_session,
        api_password_service,
        username="outcome-admin",
        role=Role.ADMIN.value,
        participant_code=None,
    )

    with TestClient(api.app) as participant_client:
        csrf = login(participant_client, participant)
        started = participant_client.post("/api/interviews", headers=mutation_headers(csrf))
        interview_id = started.json()["id"]
        participant_client.post(
            f"/api/interviews/{interview_id}/messages",
            headers=mutation_headers(csrf),
            json={"clientTurnId": str(uuid4()), "content": "응답"},
        )
        current = participant_client.get("/api/interviews/current").json()

    interview = db_session.get(Interview, UUID(interview_id))
    interview.final_diagnosis = "히키코모리"
    interview.criteria = {"A": True, "B": True, "C": False, "D": None}
    interview.report = "평가를 마쳤습니다."
    db_session.commit()

    assert not {"finalDiagnosis", "criteria", "report"} & set(current)

    with TestClient(api.app) as admin_client:
        login(admin_client, admin)
        detail = admin_client.get(f"/api/admin/interviews/{interview_id}").json()

    assert detail["finalDiagnosis"] == "히키코모리"
    assert detail["criteria"] == {"A": True, "B": True, "C": False, "D": None}
    assert detail["report"] == "평가를 마쳤습니다."
    assert detail["algorithmVersion"]


def test_admin_exports_every_interview_or_only_the_selected_ones(
    db_session: Session,
    api_password_service: PasswordService,
    api_fake_engine: ApiFakeEngine,
) -> None:
    admin = create_account(
        db_session,
        api_password_service,
        username="bulk-admin",
        role=Role.ADMIN.value,
        participant_code=None,
    )
    codes = ("P-B1", "P-B2")
    interview_ids: list[str] = []
    for index, code in enumerate(codes):
        participant = create_account(
            db_session,
            api_password_service,
            username=f"bulk-participant-{index}",
            role=Role.PARTICIPANT.value,
            participant_code=code,
        )
        with TestClient(api.app) as participant_client:
            csrf = login(participant_client, participant)
            started = participant_client.post("/api/interviews", headers=mutation_headers(csrf))
            interview_ids.append(started.json()["id"])

    with TestClient(api.app) as admin_client:
        admin_csrf = login(admin_client, admin)

        every = admin_client.post(
            "/api/admin/interviews/csv",
            headers=mutation_headers(admin_csrf),
            json={},
        )
        selected = admin_client.post(
            "/api/admin/interviews/csv",
            headers=mutation_headers(admin_csrf),
            json={"interviewIds": [interview_ids[1]]},
        )
        without_csrf = admin_client.post(
            "/api/admin/interviews/csv",
            headers={"Origin": ALLOWED_ORIGIN},
            json={},
        )

    assert every.status_code == 200
    assert every.headers["content-type"].startswith("text/csv")
    assert "attachment" in every.headers["content-disposition"]
    assert "finalDiagnosis" in every.text
    assert "P-B1" in every.text and "P-B2" in every.text

    assert selected.status_code == 200
    assert "P-B2" in selected.text
    assert "P-B1" not in selected.text
    assert "관리자 (bulk-admin)" not in every.text, "this administrator ran no interview"

    assert without_csrf.status_code == 403

    actions = list(db_session.scalars(select(AuditEvent.action)))
    assert actions.count("interview.csv_exported") >= 3


def test_an_administrator_run_is_labelled_in_the_export(
    db_session: Session,
    api_password_service: PasswordService,
    api_fake_engine: ApiFakeEngine,
) -> None:
    admin = create_account(
        db_session,
        api_password_service,
        username="export-admin",
        role=Role.ADMIN.value,
        participant_code=None,
    )

    with TestClient(api.app) as admin_client:
        csrf = login(admin_client, admin)
        admin_client.post("/api/interviews", headers=mutation_headers(csrf))
        exported = admin_client.post(
            "/api/admin/interviews/csv",
            headers=mutation_headers(csrf),
            json={},
        )

    assert exported.status_code == 200
    assert "관리자 (export-admin)" in exported.text


def test_the_review_payload_carries_the_answer_and_both_rationales(
    db_session: Session,
    api_password_service: PasswordService,
    api_fake_engine: ApiFakeEngine,
) -> None:
    participant = create_account(
        db_session,
        api_password_service,
        username="answer-participant",
        role=Role.PARTICIPANT.value,
        participant_code="P-ANS2",
    )
    admin = create_account(
        db_session,
        api_password_service,
        username="answer-admin",
        role=Role.ADMIN.value,
        participant_code=None,
    )

    with TestClient(api.app) as participant_client:
        csrf = login(participant_client, participant)
        started = participant_client.post("/api/interviews", headers=mutation_headers(csrf))
        interview_id = started.json()["id"]
        participant_client.post(
            f"/api/interviews/{interview_id}/messages",
            headers=mutation_headers(csrf),
            json={"clientTurnId": str(uuid4()), "content": "하루 대부분 집에 있습니다"},
        )

    with TestClient(api.app) as admin_client:
        admin_csrf = login(admin_client, admin)
        admin_client.post(
            f"/api/admin/interviews/{interview_id}/scorecard/A1",
            headers=mutation_headers(admin_csrf),
            json={"action": "override", "expertStatus": "negative", "rationale": "재확인 결과 다름"},
        )
        detail = admin_client.get(f"/api/admin/interviews/{interview_id}").json()
        exported = admin_client.post(
            f"/api/admin/interviews/{interview_id}/csv",
            headers=mutation_headers(admin_csrf),
        )

    a1 = next(row for row in detail["scorecard"] if row["questionId"] == "A1")
    assert a1["answer"] == "하루 대부분 집에 있습니다"
    assert a1["rationale"], "the AI rationale reaches the reviewer"
    assert a1["expertRationale"] == "재확인 결과 다름"

    assert "answer" in exported.text.splitlines()[0]
    assert "하루 대부분 집에 있습니다" in exported.text


def test_the_export_can_be_selected_by_participant(
    db_session: Session,
    api_password_service: PasswordService,
    api_fake_engine: ApiFakeEngine,
) -> None:
    admin = create_account(
        db_session,
        api_password_service,
        username="by-participant-admin",
        role=Role.ADMIN.value,
        participant_code=None,
    )
    chosen_id = None
    for index, code in enumerate(("P-S1", "P-S2")):
        participant = create_account(
            db_session,
            api_password_service,
            username=f"by-participant-{index}",
            role=Role.PARTICIPANT.value,
            participant_code=code,
        )
        if code == "P-S2":
            chosen_id = str(participant.id)
        with TestClient(api.app) as participant_client:
            csrf = login(participant_client, participant)
            participant_client.post("/api/interviews", headers=mutation_headers(csrf))

    with TestClient(api.app) as admin_client:
        admin_csrf = login(admin_client, admin)
        exported = admin_client.post(
            "/api/admin/interviews/csv",
            headers=mutation_headers(admin_csrf),
            json={"participantIds": [chosen_id]},
        )

    assert exported.status_code == 200
    assert "P-S2" in exported.text
    assert "P-S1" not in exported.text


def test_archiving_a_finished_interview_frees_the_participant(
    db_session: Session,
    api_password_service: PasswordService,
    api_fake_engine: ApiFakeEngine,
) -> None:
    participant = create_account(
        db_session,
        api_password_service,
        username="archive-participant",
        role=Role.PARTICIPANT.value,
        participant_code="P-ARCH",
    )
    admin = create_account(
        db_session,
        api_password_service,
        username="archive-admin",
        role=Role.ADMIN.value,
        participant_code=None,
    )

    with TestClient(api.app) as participant_client:
        csrf = login(participant_client, participant)
        started = participant_client.post("/api/interviews", headers=mutation_headers(csrf))
        first_id = started.json()["id"]

    interview = db_session.get(Interview, UUID(first_id))
    interview.status = "completed"
    db_session.commit()

    with TestClient(api.app) as participant_client:
        csrf = login(participant_client, participant)
        after_finishing = participant_client.post(
            "/api/interviews", headers=mutation_headers(csrf)
        )
    second_id = after_finishing.json()["id"]
    assert second_id != first_id, (
        "a finished interview is history; asking again starts a new one"
    )
    assert after_finishing.json()["status"] == "active"

    with TestClient(api.app) as admin_client:
        admin_csrf = login(admin_client, admin)
        archived = admin_client.post(
            f"/api/admin/interviews/{first_id}/archive",
            headers=mutation_headers(admin_csrf),
        )
        again = admin_client.post(
            f"/api/admin/interviews/{first_id}/archive",
            headers=mutation_headers(admin_csrf),
        )
        abandoned = admin_client.post(
            f"/api/admin/interviews/{second_id}/archive",
            headers=mutation_headers(admin_csrf),
        )

    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"
    assert again.status_code == 409, "an archived interview cannot be archived twice"
    assert abandoned.status_code == 200, (
        "an abandoned interview can be closed out of the queue too"
    )

    with TestClient(api.app) as participant_client:
        csrf = login(participant_client, participant)
        assert participant_client.get("/api/interviews/current").status_code == 404
        fresh = participant_client.post("/api/interviews", headers=mutation_headers(csrf))

    assert fresh.status_code == 201
    assert fresh.json()["id"] not in (first_id, second_id), (
        "the participant gets a brand new interview"
    )

    with TestClient(api.app) as admin_client:
        login(admin_client, admin)
        listed = admin_client.get("/api/admin/interviews").json()
    assert any(row["id"] == first_id for row in listed), "archived work stays in the record"

    actions = list(db_session.scalars(select(AuditEvent.action)))
    assert "interview.archived" in actions
