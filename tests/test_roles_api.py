"""Three roles: what a reviewer may do, and how an administrator grants roles."""

from __future__ import annotations

from uuid import uuid4

import api
from auth.models import AuditEvent
from auth.policy import Role
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_interview_api import (  # noqa: F401  (fixtures are used by name)
    ALLOWED_ORIGIN,
    ApiFakeEngine,
    api_fake_engine,
    api_password_service,
    create_account,
    login,
    mutation_headers,
)


def _staff(db_session, password_service, username: str, role: str):
    return create_account(db_session, password_service, username=username, role=role, participant_code=None)


def test_a_reviewer_reviews_and_exports_but_does_nothing_else(
    db_session: Session,
    api_password_service,
    api_fake_engine: ApiFakeEngine,
) -> None:
    participant = create_account(
        db_session, api_password_service, username="role-participant",
        role=Role.PARTICIPANT.value, participant_code="P-ROLE",
    )
    reviewer = _staff(db_session, api_password_service, "role-reviewer", Role.REVIEWER.value)

    with TestClient(api.app) as participant_client:
        csrf = login(participant_client, participant)
        started = participant_client.post("/api/interviews", headers=mutation_headers(csrf))
        interview_id = started.json()["id"]
        participant_client.post(
            f"/api/interviews/{interview_id}/messages",
            headers=mutation_headers(csrf),
            json={"clientTurnId": str(uuid4()), "content": "하루 대부분 집에 있습니다"},
        )

    with TestClient(api.app) as client:
        csrf = login(client, reviewer)
        me = client.get("/api/auth/me")
        listing = client.get("/api/admin/interviews")
        detail = client.get(f"/api/admin/interviews/{interview_id}")
        judged = client.post(
            f"/api/admin/interviews/{interview_id}/scorecard/A1",
            headers=mutation_headers(csrf),
            json={"action": "approve"},
        )
        one_csv = client.post(f"/api/admin/interviews/{interview_id}/csv", headers=mutation_headers(csrf))
        all_csv = client.post("/api/admin/interviews/csv", headers=mutation_headers(csrf), json={})

        archive = client.post(f"/api/admin/interviews/{interview_id}/archive", headers=mutation_headers(csrf))
        participants = client.get("/api/admin/participants")
        staff = client.get("/api/admin/staff")
        create = client.post(
            "/api/admin/participants", headers=mutation_headers(csrf), json={"generatePassword": True},
        )
        own_interview = client.get("/api/interviews/current")
        start = client.post("/api/interviews", headers=mutation_headers(csrf))

    assert me.json()["role"] == "reviewer"
    assert [r.status_code for r in (listing, detail, judged, one_csv, all_csv)] == [200] * 5
    assert [r.status_code for r in (archive, participants, staff, create, own_interview, start)] == [403] * 6


def test_an_administrator_creates_staff_and_the_new_reviewer_can_sign_in(
    db_session: Session,
    api_password_service,
) -> None:
    admin = _staff(db_session, api_password_service, "grant-admin", Role.ADMIN.value)

    with TestClient(api.app) as client:
        csrf = login(client, admin)
        created = client.post(
            "/api/admin/staff",
            headers=mutation_headers(csrf),
            json={"username": "New-Reviewer", "role": "reviewer", "generatePassword": True},
        )
        as_participant = client.post(
            "/api/admin/staff",
            headers=mutation_headers(csrf),
            json={"username": "not-staff", "role": "participant", "generatePassword": True},
        )
        duplicate = client.post(
            "/api/admin/staff",
            headers=mutation_headers(csrf),
            json={"username": "new-reviewer", "role": "admin", "generatePassword": True},
        )
        listing = client.get("/api/admin/staff")

    assert created.status_code == 201
    assert created.json()["staff"] == {
        "id": created.json()["staff"]["id"],
        "username": "New-Reviewer",
        "role": "reviewer",
        "status": "active",
        "temporaryLockedUntil": None,
    }
    password = created.json()["assignedPassword"]
    assert len(password) >= 10
    assert as_participant.status_code == 422, "participants are created through their own endpoint"
    assert duplicate.status_code == 409
    assert {(row["username"], row["role"]) for row in listing.json()} == {
        ("grant-admin", "admin"),
        ("New-Reviewer", "reviewer"),
    }

    with TestClient(api.app) as reviewer_client:
        signed_in = reviewer_client.post(
            "/api/auth/login",
            headers={"Origin": ALLOWED_ORIGIN},
            json={"username": "new-reviewer", "password": password},
        )
    assert signed_in.status_code == 200
    assert signed_in.json()["role"] == "reviewer"

    created_event = db_session.scalar(
        select(AuditEvent).where(AuditEvent.action == "account.created").order_by(AuditEvent.occurred_at.desc())
    )
    assert created_event is not None and created_event.details == {"role": "reviewer"}


def test_roles_move_between_reviewer_and_administrator_only(
    db_session: Session,
    api_password_service,
) -> None:
    admin = _staff(db_session, api_password_service, "move-admin", Role.ADMIN.value)
    reviewer = _staff(db_session, api_password_service, "move-reviewer", Role.REVIEWER.value)
    participant = create_account(
        db_session, api_password_service, username="move-participant",
        role=Role.PARTICIPANT.value, participant_code="P-MOVE",
    )

    with TestClient(api.app) as reviewer_client:
        login(reviewer_client, reviewer)

        with TestClient(api.app) as client:
            csrf = login(client, admin)
            promoted = client.post(
                f"/api/admin/staff/{reviewer.id}/role", headers=mutation_headers(csrf), json={"role": "admin"},
            )
            unchanged = client.post(
                f"/api/admin/staff/{reviewer.id}/role", headers=mutation_headers(csrf), json={"role": "admin"},
            )
            own = client.post(
                f"/api/admin/staff/{admin.id}/role", headers=mutation_headers(csrf), json={"role": "reviewer"},
            )
            a_participant = client.post(
                f"/api/admin/staff/{participant.id}/role", headers=mutation_headers(csrf), json={"role": "reviewer"},
            )
            to_participant = client.post(
                f"/api/admin/staff/{reviewer.id}/role", headers=mutation_headers(csrf), json={"role": "participant"},
            )
        stale_session = reviewer_client.get("/api/auth/me")

    assert promoted.status_code == 200 and promoted.json()["role"] == "admin"
    assert unchanged.status_code == 409, "granting the role an account already has changes nothing"
    assert own.status_code == 409, "an administrator cannot change their own role"
    assert a_participant.status_code == 404, "a participant account keeps its role: its interviews belong to it"
    assert to_participant.status_code == 422
    assert stale_session.status_code == 401, "a role change signs the account out so the new role takes hold"

    event = db_session.scalar(select(AuditEvent).where(AuditEvent.action == "account.role_changed"))
    assert event is not None
    assert event.details == {"from": "reviewer", "to": "admin"}


def test_staff_accounts_are_managed_like_any_other_but_never_by_themselves(
    db_session: Session,
    api_password_service,
) -> None:
    admin = _staff(db_session, api_password_service, "manage-admin", Role.ADMIN.value)
    reviewer = _staff(db_session, api_password_service, "manage-reviewer", Role.REVIEWER.value)

    with TestClient(api.app) as client:
        csrf = login(client, admin)
        reset = client.post(
            f"/api/admin/staff/{reviewer.id}/password",
            headers=mutation_headers(csrf), json={"generatePassword": True},
        )
        disabled = client.post(f"/api/admin/staff/{reviewer.id}/disable", headers=mutation_headers(csrf))
        enabled = client.post(f"/api/admin/staff/{reviewer.id}/enable", headers=mutation_headers(csrf))
        own_disable = client.post(f"/api/admin/staff/{admin.id}/disable", headers=mutation_headers(csrf))

    assert reset.status_code == 200 and len(reset.json()["assignedPassword"]) >= 10
    assert disabled.status_code == 200 and disabled.json()["status"] == "disabled"
    assert enabled.status_code == 200 and enabled.json()["status"] == "active"
    assert own_disable.status_code == 409, "an administrator cannot lock themselves out"
