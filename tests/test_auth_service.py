"""Transactional authentication state-machine tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from argon2 import PasswordHasher
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth.models import AuditEvent, AuthSession, UserAccount
from auth.policy import AccountStatus, Role, SessionKind
from auth.security import PasswordService, TokenService

VALID_PASSWORD = "research-passphrase"


class MutableClock:
    def __init__(self) -> None:
        self.now = datetime(2026, 9, 4, 1, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **delta: float) -> None:
        self.now += timedelta(**delta)


@pytest.fixture
def clock() -> MutableClock:
    return MutableClock()


@pytest.fixture
def password_service() -> PasswordService:
    return PasswordService(
        PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1)
    )


@pytest.fixture
def participant(
    db_session: Session,
    password_service: PasswordService,
    clock: MutableClock,
) -> UserAccount:
    account = UserAccount(
        normalized_username="participant-001",
        display_username="participant-001",
        password_hash=password_service.hash(VALID_PASSWORD),
        role=Role.PARTICIPANT.value,
        status=AccountStatus.ACTIVE.value,
        participant_code="P-001",
        created_at=clock.now,
        updated_at=clock.now,
        password_changed_at=clock.now,
    )
    db_session.add(account)
    db_session.commit()
    return account


@pytest.fixture
def auth_service(
    db_session: Session,
    password_service: PasswordService,
    clock: MutableClock,
):
    from auth.service import AuthenticationService

    issued = iter(f"test-opaque-token-{index}" for index in range(100))
    return AuthenticationService(
        db_session,
        password_service=password_service,
        token_service=TokenService(raw_factory=lambda: next(issued)),
        clock=clock,
    )


def fail_login(auth_service, username: str, count: int) -> None:
    from auth.service import InvalidCredentials

    for _ in range(count):
        with pytest.raises(InvalidCredentials):
            auth_service.login(username, "wrong-password", remember=False)


def test_first_five_failures_temporarily_lock_account(
    auth_service,
    participant: UserAccount,
    db_session: Session,
    clock: MutableClock,
) -> None:
    fail_login(auth_service, participant.display_username, count=5)

    db_session.refresh(participant)
    assert participant.status == AccountStatus.ACTIVE.value
    assert participant.lock_stage == 1
    assert participant.failed_login_count == 0
    assert participant.failure_window_started_at is None
    assert participant.temporary_locked_until == clock.now + timedelta(minutes=15)


def test_attempts_during_temporary_lock_do_not_advance_second_stage(
    auth_service,
    participant: UserAccount,
    db_session: Session,
    clock: MutableClock,
) -> None:
    fail_login(auth_service, participant.display_username, count=5)
    first_deadline = clock.now + timedelta(minutes=15)

    fail_login(auth_service, participant.display_username, count=3)

    db_session.refresh(participant)
    assert participant.status == AccountStatus.ACTIVE.value
    assert participant.lock_stage == 1
    assert participant.failed_login_count == 0
    assert participant.failure_window_started_at is None
    assert participant.temporary_locked_until == first_deadline


def test_second_five_failures_transition_to_administrator_lock(
    auth_service,
    participant: UserAccount,
    db_session: Session,
    clock: MutableClock,
) -> None:
    fail_login(auth_service, participant.display_username, count=5)
    clock.advance(minutes=16)

    fail_login(auth_service, participant.display_username, count=5)

    db_session.refresh(participant)
    assert participant.status == AccountStatus.ADMIN_LOCKED.value
    assert participant.admin_locked_at == clock.now
    assert participant.failed_login_count == 0
    assert participant.failure_window_started_at is None
    assert participant.temporary_locked_until is None
    events = db_session.scalars(select(AuditEvent)).all()
    assert [(event.action, event.target_id) for event in events] == [
        ("account.admin_locked", participant.id)
    ]


def test_success_after_temporary_lock_resets_failures_and_creates_new_session(
    auth_service,
    participant: UserAccount,
    db_session: Session,
    clock: MutableClock,
) -> None:
    fail_login(auth_service, participant.display_username, count=5)
    clock.advance(minutes=16)
    fail_login(auth_service, participant.display_username, count=2)

    issued = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=False,
    )

    db_session.refresh(participant)
    assert participant.failed_login_count == 0
    assert participant.failure_window_started_at is None
    assert participant.temporary_locked_until is None
    assert participant.lock_stage == 0
    stored_session = db_session.get(AuthSession, issued.auth_session.id)
    assert stored_session is not None
    assert stored_session.kind == SessionKind.NORMAL.value
    assert stored_session.user_id == participant.id
    assert stored_session.token_hash == TokenService.digest(issued.session_token)
    assert stored_session.csrf_token_hash == TokenService.digest(issued.csrf_token)
    assert issued.session_token != stored_session.token_hash


@pytest.mark.parametrize(
    "status",
    [AccountStatus.DISABLED.value, AccountStatus.ADMIN_LOCKED.value],
)
def test_unavailable_accounts_reject_a_correct_password_without_creating_session(
    auth_service,
    participant: UserAccount,
    db_session: Session,
    status: str,
) -> None:
    from auth.service import InvalidCredentials

    participant.status = status
    db_session.commit()

    with pytest.raises(InvalidCredentials):
        auth_service.login(
            participant.display_username,
            VALID_PASSWORD,
            remember=False,
        )

    assert db_session.scalars(select(AuthSession)).all() == []


def test_failure_window_restarts_after_fifteen_minutes(
    auth_service,
    participant: UserAccount,
    db_session: Session,
    clock: MutableClock,
) -> None:
    fail_login(auth_service, participant.display_username, count=4)
    clock.advance(minutes=15)

    fail_login(auth_service, participant.display_username, count=1)

    db_session.refresh(participant)
    assert participant.failed_login_count == 1
    assert participant.failure_window_started_at == clock.now
    assert participant.lock_stage == 0
    assert participant.temporary_locked_until is None


def test_automatic_administrator_lock_revokes_existing_sessions(
    auth_service,
    participant: UserAccount,
    db_session: Session,
    clock: MutableClock,
) -> None:
    issued = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=True,
    )
    fail_login(auth_service, participant.display_username, count=5)
    clock.advance(minutes=16)

    fail_login(auth_service, participant.display_username, count=5)

    stored_session = db_session.get(AuthSession, issued.auth_session.id)
    assert stored_session is not None
    db_session.refresh(stored_session)
    assert stored_session.revoked_at == clock.now


@pytest.mark.parametrize("username", ["missing-user", "잘못된 이름"])
def test_unknown_or_invalid_usernames_share_generic_rejection(
    auth_service,
    db_session: Session,
    username: str,
) -> None:
    from auth.service import InvalidCredentials

    with pytest.raises(InvalidCredentials):
        auth_service.login(username, VALID_PASSWORD, remember=False)

    assert db_session.scalars(select(AuthSession)).all() == []


def test_normal_session_stays_fixed_at_24_hours_after_activity(
    auth_service,
    participant: UserAccount,
    clock: MutableClock,
) -> None:
    issued = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=False,
    )
    original_expiry = clock.now + timedelta(hours=24)
    clock.advance(hours=23)

    context = auth_service.authenticate(issued.session_token)

    assert context.account.id == participant.id
    assert context.auth_session.expires_at == original_expiry
    assert context.auth_session.absolute_expires_at == original_expiry
    assert context.cookie_renewed is False


def test_last_seen_writes_are_throttled_to_fifteen_minutes(
    auth_service,
    participant: UserAccount,
    db_session: Session,
    clock: MutableClock,
) -> None:
    issued = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=False,
    )
    created_at = clock.now
    clock.advance(minutes=14)

    auth_service.authenticate(issued.session_token)

    stored_session = db_session.get(AuthSession, issued.auth_session.id)
    assert stored_session is not None
    db_session.refresh(stored_session)
    assert stored_session.last_seen_at == created_at
    db_session.commit()

    clock.advance(minutes=1)
    auth_service.authenticate(issued.session_token)
    db_session.refresh(stored_session)
    assert stored_session.last_seen_at == clock.now


def test_remembered_session_renews_when_exactly_seven_days_remain(
    auth_service,
    participant: UserAccount,
    clock: MutableClock,
) -> None:
    issued = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=True,
    )
    absolute_expiry = clock.now + timedelta(days=90)
    clock.advance(days=23)

    context = auth_service.authenticate(issued.session_token)

    assert context.cookie_renewed is True
    assert context.auth_session.expires_at == clock.now + timedelta(days=30)
    assert context.auth_session.absolute_expires_at == absolute_expiry


def test_remembered_session_does_not_renew_before_threshold(
    auth_service,
    participant: UserAccount,
    clock: MutableClock,
) -> None:
    issued = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=True,
    )
    original_expiry = clock.now + timedelta(days=30)
    clock.advance(days=22, hours=23)

    context = auth_service.authenticate(issued.session_token)

    assert context.cookie_renewed is False
    assert context.auth_session.expires_at == original_expiry


def test_remembered_session_renewal_is_capped_at_ninety_days(
    auth_service,
    participant: UserAccount,
    clock: MutableClock,
) -> None:
    from auth.service import AuthenticationRequired

    issued = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=True,
    )
    absolute_expiry = clock.now + timedelta(days=90)

    clock.advance(days=23)
    assert auth_service.authenticate(issued.session_token).auth_session.expires_at == (
        clock.now + timedelta(days=30)
    )
    clock.advance(days=23)
    assert auth_service.authenticate(issued.session_token).auth_session.expires_at == (
        clock.now + timedelta(days=30)
    )
    clock.advance(days=23)
    capped = auth_service.authenticate(issued.session_token)

    assert capped.cookie_renewed is True
    assert capped.auth_session.expires_at == absolute_expiry
    clock.advance(days=21)
    with pytest.raises(AuthenticationRequired):
        auth_service.authenticate(issued.session_token)


def test_logout_revokes_only_the_current_session(
    auth_service,
    participant: UserAccount,
    db_session: Session,
    clock: MutableClock,
) -> None:
    from auth.service import AuthenticationRequired

    first = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=False,
    )
    second = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=False,
    )

    auth_service.logout(first.session_token)

    first_row = db_session.get(AuthSession, first.auth_session.id)
    second_row = db_session.get(AuthSession, second.auth_session.id)
    assert first_row is not None
    assert second_row is not None
    db_session.refresh(first_row)
    db_session.refresh(second_row)
    assert first_row.revoked_at == clock.now
    assert second_row.revoked_at is None
    db_session.commit()
    with pytest.raises(AuthenticationRequired):
        auth_service.authenticate(first.session_token)
    assert auth_service.authenticate(second.session_token).account.id == participant.id


def test_password_change_rehashes_password_and_revokes_every_session(
    auth_service,
    participant: UserAccount,
    password_service: PasswordService,
    db_session: Session,
    clock: MutableClock,
) -> None:
    first = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=False,
    )
    second = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=True,
    )

    auth_service.change_password(
        participant.id,
        current_password=VALID_PASSWORD,
        new_password="new-research-passphrase",
    )

    db_session.refresh(participant)
    assert password_service.verify(
        participant.password_hash,
        "new-research-passphrase",
    )
    assert not password_service.verify(participant.password_hash, VALID_PASSWORD)
    assert participant.password_changed_at == clock.now
    sessions = db_session.scalars(
        select(AuthSession).where(AuthSession.user_id == participant.id)
    ).all()
    for auth_session in sessions:
        db_session.refresh(auth_session)
    assert {auth_session.id for auth_session in sessions} == {
        first.auth_session.id,
        second.auth_session.id,
    }
    assert all(auth_session.revoked_at == clock.now for auth_session in sessions)
    event = db_session.scalar(
        select(AuditEvent).where(AuditEvent.action == "account.password_changed")
    )
    assert event is not None
    assert event.actor_user_id == participant.id
    assert event.target_id == participant.id


def test_wrong_current_password_leaves_password_and_sessions_unchanged(
    auth_service,
    participant: UserAccount,
    password_service: PasswordService,
    db_session: Session,
) -> None:
    from auth.service import InvalidCurrentPassword

    issued = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=False,
    )

    with pytest.raises(InvalidCurrentPassword):
        auth_service.change_password(
            participant.id,
            current_password="wrong-password",
            new_password="new-research-passphrase",
        )

    db_session.refresh(participant)
    stored_session = db_session.get(AuthSession, issued.auth_session.id)
    assert stored_session is not None
    db_session.refresh(stored_session)
    assert password_service.verify(participant.password_hash, VALID_PASSWORD)
    assert stored_session.revoked_at is None


def test_expired_or_unknown_session_cannot_authenticate(
    auth_service,
    participant: UserAccount,
    clock: MutableClock,
) -> None:
    from auth.service import AuthenticationRequired

    issued = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=False,
    )
    clock.advance(hours=24)

    with pytest.raises(AuthenticationRequired):
        auth_service.authenticate(issued.session_token)
    with pytest.raises(AuthenticationRequired):
        auth_service.authenticate("unknown-session-token")


def test_cleanup_removes_only_sessions_older_than_retention(
    auth_service,
    participant: UserAccount,
    db_session: Session,
    clock: MutableClock,
) -> None:
    active = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=False,
    )
    old_expired = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=False,
    )
    recent_revoked = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=False,
    )
    old_revoked = auth_service.login(
        participant.display_username,
        VALID_PASSWORD,
        remember=False,
    )
    old_expired.auth_session.expires_at = clock.now - timedelta(days=8)
    old_expired.auth_session.absolute_expires_at = clock.now - timedelta(days=8)
    recent_revoked.auth_session.revoked_at = clock.now - timedelta(days=1)
    old_revoked.auth_session.revoked_at = clock.now - timedelta(days=8)
    db_session.commit()

    deleted = auth_service.cleanup_sessions(retention=timedelta(days=7))

    remaining_ids = set(db_session.scalars(select(AuthSession.id)).all())
    assert deleted == 2
    assert remaining_ids == {active.auth_session.id, recent_revoked.auth_session.id}
