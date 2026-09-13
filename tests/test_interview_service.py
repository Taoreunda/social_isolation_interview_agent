"""PostgreSQL interview transaction and administration tests."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
import interview.service as interview_service_module
from auth.models import AuditEvent, UserAccount
from auth.policy import AccountStatus, Role
from interview.engine import EngineTurnResult, InterviewGenerationError
from interview.models import ExpertReview, Interview, InterviewMessage, ScorecardItem
from interview.scorecard import Scorecard
from interview.service import (
    InterviewBusy,
    InterviewNotFound,
    InterviewService,
    InvalidReview,
)
from sqlalchemy import event, func, select, update
from sqlalchemy.orm import Session

NOW = datetime(2026, 9, 5, 2, 0, tzinfo=UTC)


def create_account(
    session: Session,
    *,
    role: str = Role.PARTICIPANT.value,
    participant_code: str | None = "P-001",
) -> UserAccount:
    suffix = uuid4().hex[:8]
    account = UserAccount(
        normalized_username=f"user-{suffix}",
        display_username=f"user-{suffix}",
        password_hash="unused-in-service-tests",
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


def engine_result(
    message: str,
    *,
    scorecard: dict[str, Any] | None = None,
    complete: bool = False,
) -> EngineTurnResult:
    state = deepcopy(scorecard or Scorecard().to_dict())
    diagnosis = state.get("diagnosis")
    return EngineTurnResult(
        participant_message=message,
        scorecard=state,
        interview_complete=complete,
        final_diagnosis=diagnosis,
        report=message if complete else None,
    )


class ScriptedEngine:
    def __init__(self, *results: EngineTurnResult | Exception) -> None:
        self.results = list(results)
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
                "scorecard": deepcopy(scorecard),
                "user_input": user_input,
            }
        )
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def test_start_persists_initial_state_and_a_new_service_can_resume(
    db_session: Session,
) -> None:
    participant = create_account(db_session)
    engine = ScriptedEngine(engine_result("첫 질문입니다."))
    service = InterviewService(db_session, engine=engine, clock=lambda: NOW)

    started = asyncio.run(service.start(participant.id))

    assert started.participant_id == participant.id
    assert started.status == "active"
    assert [(item.sequence, item.role, item.content) for item in started.messages] == [
        (0, "assistant", "첫 질문입니다.")
    ]
    assert len(started.scorecard_items) == len(Scorecard().question_order)
    assert engine.calls[0]["messages"] == []
    assert engine.calls[0]["user_input"] == ""

    participant_id = participant.id
    db_session.expire_all()
    resumed = InterviewService(db_session, clock=lambda: NOW).get_current(
        participant_id
    )

    assert resumed is not None
    assert resumed.id == started.id
    assert [message.content for message in resumed.messages] == ["첫 질문입니다."]


def test_current_interview_is_one_consistent_database_snapshot(
    db_session: Session,
) -> None:
    participant = create_account(db_session, participant_code="P-SNAPSHOT")
    participant_id = participant.id
    engine = ScriptedEngine(engine_result("첫 질문입니다."))
    interview = asyncio.run(
        InterviewService(db_session, engine=engine, clock=lambda: NOW).start(
            participant_id
        )
    )
    interview_id = interview.id
    bind = db_session.get_bind()
    committed_between_queries = False

    def commit_completed_turn(_conn, _cursor, statement, _params, _context, _many):
        nonlocal committed_between_queries
        normalized = " ".join(statement.lower().split())
        if committed_between_queries or " from interviews" not in normalized:
            return
        committed_between_queries = True
        with Session(bind=bind, expire_on_commit=False) as concurrent:
            concurrent.execute(
                update(Interview)
                .where(Interview.id == interview_id)
                .values(status="completed", progress=100, updated_at=NOW)
            )
            concurrent.add(
                InterviewMessage(
                    interview_id=interview_id,
                    sequence=1,
                    role="assistant",
                    content="동시에 커밋된 완료 메시지",
                    created_at=NOW,
                )
            )
            concurrent.commit()

    event.listen(bind, "after_cursor_execute", commit_completed_turn)
    try:
        db_session.expire_all()
        loaded = InterviewService(db_session).get_current(participant_id)
    finally:
        event.remove(bind, "after_cursor_execute", commit_completed_turn)

    assert committed_between_queries is True
    assert loaded is not None
    has_concurrent_message = any(
        message.content == "동시에 커밋된 완료 메시지"
        for message in loaded.messages
    )
    assert (loaded.status == "completed") is has_concurrent_message


def test_turn_is_atomic_restart_safe_and_idempotent(
    db_session: Session,
) -> None:
    participant = create_account(db_session)
    updated = Scorecard()
    updated.record("A1", "positive", "=external()", "답변에서 확인")
    engine = ScriptedEngine(
        engine_result("첫 질문입니다."),
        engine_result("두 번째 질문입니다.", scorecard=updated.to_dict()),
    )
    service = InterviewService(db_session, engine=engine, clock=lambda: NOW)
    interview = asyncio.run(service.start(participant.id))
    turn_id = uuid4()

    committed = asyncio.run(
        service.submit_turn(
            participant_id=participant.id,
            interview_id=interview.id,
            client_turn_id=turn_id,
            content="첫 답변입니다.",
        )
    )
    duplicate = asyncio.run(
        service.submit_turn(
            participant_id=participant.id,
            interview_id=interview.id,
            client_turn_id=turn_id,
            content="무시되어야 할 재시도 본문",
        )
    )

    assert len(engine.calls) == 2
    assert [message.role for message in committed.messages] == [
        "assistant",
        "user",
        "assistant",
    ]
    assert [message.content for message in duplicate.messages] == [
        "첫 질문입니다.",
        "첫 답변입니다.",
        "두 번째 질문입니다.",
    ]
    assert engine.calls[1]["messages"] == [
        {"role": "assistant", "content": "첫 질문입니다."}
    ]
    assert committed.scorecard_items[0].ai_status == "positive"

    participant_id = participant.id
    db_session.expire_all()
    reloaded = InterviewService(db_session, clock=lambda: NOW).get_current(
        participant_id
    )
    assert reloaded is not None
    assert [message.content for message in reloaded.messages] == [
        "첫 질문입니다.",
        "첫 답변입니다.",
        "두 번째 질문입니다.",
    ]


def test_failed_generation_commits_nothing_and_ownership_is_opaque(
    db_session: Session,
) -> None:
    owner = create_account(db_session, participant_code="P-OWNER")
    other = create_account(db_session, participant_code="P-OTHER")
    engine = ScriptedEngine(
        engine_result("첫 질문입니다."),
        InterviewGenerationError("safe failure"),
    )
    service = InterviewService(db_session, engine=engine, clock=lambda: NOW)
    interview = asyncio.run(service.start(owner.id))

    with pytest.raises(InterviewGenerationError):
        asyncio.run(
            service.submit_turn(
                participant_id=owner.id,
                interview_id=interview.id,
                client_turn_id=uuid4(),
                content="저장되면 안 되는 답변",
            )
        )

    assert db_session.scalar(select(func.count(InterviewMessage.id))) == 1
    db_session.commit()
    with pytest.raises(InterviewNotFound):
        asyncio.run(
            service.submit_turn(
                participant_id=other.id,
                interview_id=interview.id,
                client_turn_id=uuid4(),
                content="다른 사용자의 답변",
            )
        )


def test_unknown_interview_ids_do_not_accumulate_process_locks(
    db_session: Session,
) -> None:
    participant = create_account(db_session, participant_code="P-LOCK-BOUND")
    participant_id = participant.id
    service = InterviewService(db_session)
    existing_keys = set(interview_service_module._TURN_LOCKS)

    for _ in range(50):
        with pytest.raises(InterviewNotFound):
            asyncio.run(
                service.submit_turn(
                    participant_id=participant_id,
                    interview_id=uuid4(),
                    client_turn_id=uuid4(),
                    content="존재하지 않는 인터뷰",
                )
            )

    assert set(interview_service_module._TURN_LOCKS) == existing_keys


def test_overlapping_turn_is_rejected_before_a_second_generation(
    db_session: Session,
) -> None:
    participant = create_account(db_session)
    starter = ScriptedEngine(engine_result("첫 질문입니다."))
    interview = asyncio.run(
        InterviewService(db_session, engine=starter, clock=lambda: NOW).start(
            participant.id
        )
    )

    class BlockingEngine:
        def __init__(self) -> None:
            self.started = asyncio.Event()
            self.release = asyncio.Event()
            self.calls = 0

        async def run_persisted_turn(self, **_: Any) -> EngineTurnResult:
            self.calls += 1
            self.started.set()
            await self.release.wait()
            return engine_result("다음 질문입니다.")

    engine = BlockingEngine()
    service = InterviewService(db_session, engine=engine, clock=lambda: NOW)

    async def scenario() -> None:
        first = asyncio.create_task(
            service.submit_turn(
                participant_id=participant.id,
                interview_id=interview.id,
                client_turn_id=uuid4(),
                content="첫 요청",
            )
        )
        await engine.started.wait()
        with pytest.raises(InterviewBusy):
            await service.submit_turn(
                participant_id=participant.id,
                interview_id=interview.id,
                client_turn_id=uuid4(),
                content="겹친 요청",
            )
        engine.release.set()
        await first

    asyncio.run(scenario())
    assert engine.calls == 1


def test_overlapping_starts_are_serialized_to_one_interview(
    db_session: Session,
) -> None:
    participant = create_account(db_session)

    class BlockingStartEngine:
        def __init__(self) -> None:
            self.started = asyncio.Event()
            self.release = asyncio.Event()
            self.calls = 0

        async def run_persisted_turn(self, **_: Any) -> EngineTurnResult:
            self.calls += 1
            self.started.set()
            await self.release.wait()
            return engine_result("첫 질문입니다.")

    engine = BlockingStartEngine()
    service = InterviewService(db_session, engine=engine, clock=lambda: NOW)

    async def scenario() -> tuple[Interview, Interview]:
        first = asyncio.create_task(service.start(participant.id))
        await engine.started.wait()
        second = asyncio.create_task(service.start(participant.id))
        await asyncio.sleep(0)
        engine.release.set()
        return await asyncio.gather(first, second)

    first, second = asyncio.run(scenario())
    assert first.id == second.id
    assert engine.calls == 1


def test_admin_review_rules_status_audit_and_formula_safe_csv(
    db_session: Session,
) -> None:
    participant = create_account(db_session, participant_code="P-CSV")
    admin = create_account(
        db_session,
        role=Role.ADMIN.value,
        participant_code=None,
    )
    updated = Scorecard()
    updated.record("A1", "positive", " =HYPERLINK(\"bad\")", "근거")
    updated.record("E1", "recorded", "추가 정보", "자유 응답")
    engine = ScriptedEngine(
        engine_result("첫 질문입니다."),
        engine_result("다음 질문입니다.", scorecard=updated.to_dict()),
    )
    service = InterviewService(db_session, engine=engine, clock=lambda: NOW)
    interview = asyncio.run(service.start(participant.id))
    asyncio.run(
        service.submit_turn(
            participant_id=participant.id,
            interview_id=interview.id,
            client_turn_id=uuid4(),
            content="답변",
        )
    )
    admin_id = admin.id
    interview_id = interview.id

    with pytest.raises(InvalidReview):
        service.review_scorecard(
            reviewer_user_id=admin_id,
            interview_id=interview_id,
            question_id="A2",
            action="approve",
        )
    blank_rationale = service.review_scorecard(
        reviewer_user_id=admin_id,
        interview_id=interview_id,
        question_id="A1",
        action="override",
        expert_status="negative",
        rationale="   ",
    )
    a1_review = next(
        item.expert_review
        for item in blank_rationale.scorecard_items
        if item.question_id == "A1"
    )
    assert a1_review is not None
    assert a1_review.rationale is None, "a blank rationale is stored as none at all"
    with pytest.raises(InvalidReview):
        service.review_scorecard(
            reviewer_user_id=admin_id,
            interview_id=interview_id,
            question_id="A1",
            action="override",
            expert_status="positive",
            rationale="AI 판정과 같은 값",
        )
    with pytest.raises(InvalidReview):
        service.review_scorecard(
            reviewer_user_id=admin_id,
            interview_id=interview_id,
            question_id="E1",
            action="override",
            expert_status="negative",
            rationale="기록 문항을 변경하려는 근거",
        )

    reviewed = service.review_scorecard(
        reviewer_user_id=admin_id,
        interview_id=interview_id,
        question_id="A1",
        action="approve",
    )
    assert service.review_status(reviewed) == "in_review"
    reviewed = service.review_scorecard(
        reviewer_user_id=admin_id,
        interview_id=interview_id,
        question_id="E1",
        action="approve",
    )
    assert service.review_status(reviewed) == "in_review", (
        "a running interview still has unasked questions, so review is not done"
    )
    db_session.execute(
        update(Interview)
        .where(Interview.id == interview_id)
        .values(status="completed", progress=100, completed_at=NOW)
    )
    db_session.commit()
    db_session.expire_all()
    finished = service.get_for_admin(interview_id)
    assert service.review_status(finished) == "reviewed"
    assert len(reviewed.scorecard_items[0].expert_review.original_status) > 0

    csv_text = service.export_csv(
        reviewer_user_id=admin_id,
        interview_id=interview_id,
    )
    assert "P-CSV" in csv_text
    assert "' =HYPERLINK" in csv_text
    assert db_session.scalar(select(func.count(ExpertReview.id))) == 2
    actions = list(db_session.scalars(select(AuditEvent.action).order_by(AuditEvent.id)))
    assert "interview.scorecard_reviewed" in actions
    assert "interview.csv_exported" in actions


def test_a_later_ai_change_invalidates_the_previous_expert_review(
    db_session: Session,
) -> None:
    participant = create_account(db_session, participant_code="P-CHANGE")
    admin = create_account(
        db_session,
        role=Role.ADMIN.value,
        participant_code=None,
    )
    first_state = Scorecard()
    first_state.record("A1", "positive", "예", "첫 판단")
    changed_state = Scorecard.from_dict(first_state.to_dict())
    changed_state.update("A1", "negative", "아니오", "정정된 판단")
    engine = ScriptedEngine(
        engine_result("첫 질문입니다."),
        engine_result("다음 질문입니다.", scorecard=first_state.to_dict()),
        engine_result("정정했습니다.", scorecard=changed_state.to_dict()),
    )
    service = InterviewService(db_session, engine=engine, clock=lambda: NOW)
    interview = asyncio.run(service.start(participant.id))
    asyncio.run(
        service.submit_turn(
            participant_id=participant.id,
            interview_id=interview.id,
            client_turn_id=uuid4(),
            content="첫 답변",
        )
    )
    service.review_scorecard(
        reviewer_user_id=admin.id,
        interview_id=interview.id,
        question_id="A1",
        action="approve",
    )

    changed = asyncio.run(
        service.submit_turn(
            participant_id=participant.id,
            interview_id=interview.id,
            client_turn_id=uuid4(),
            content="앞의 답변을 정정할게요",
        )
    )

    assert changed.scorecard_items[0].ai_status == "negative"
    assert changed.scorecard_items[0].expert_review is None
    assert service.review_status(changed) == "unreviewed"


def test_participant_account_status_reports_an_archived_interview(
    db_session: Session,
) -> None:
    participant = create_account(db_session, participant_code="P-ARCHIVE")
    engine = ScriptedEngine(engine_result("첫 질문입니다."))
    service = InterviewService(db_session, engine=engine, clock=lambda: NOW)
    interview = asyncio.run(service.start(participant.id))
    participant_id = participant.id
    interview.status = "archived"
    interview.archived_at = NOW
    db_session.commit()

    statuses = service.statuses_for_participants([participant_id])

    assert statuses[participant_id] == "archived"


def test_a_recorded_question_keeps_the_answer_that_produced_it(
    db_session: Session,
) -> None:
    participant = create_account(db_session, participant_code="P-ANS")
    first = Scorecard()
    first.record("A1", "negative", "아니요", "명확히 아니라고 답함")
    engine = ScriptedEngine(
        engine_result("첫 질문입니다."),
        engine_result("다음 질문입니다.", scorecard=first.to_dict()),
    )
    service = InterviewService(db_session, engine=engine, clock=lambda: NOW)
    interview = asyncio.run(service.start(participant.id))
    asyncio.run(
        service.submit_turn(
            participant_id=participant.id,
            interview_id=interview.id,
            client_turn_id=uuid4(),
            content="아니요, 그렇지 않습니다",
        )
    )

    reloaded = service.get_for_admin(interview.id)
    a1 = next(item for item in reloaded.scorecard_items if item.question_id == "A1")
    untouched = next(item for item in reloaded.scorecard_items if item.question_id == "A2")

    assert a1.answer_message is not None
    assert a1.answer_message.content == "아니요, 그렇지 않습니다"
    assert a1.answer_message.role == "user"
    assert untouched.answer_message is None


def test_marking_a_decision_wrong_needs_no_rationale(db_session: Session) -> None:
    participant = create_account(db_session, participant_code="P-FAST")
    admin = create_account(db_session, role=Role.ADMIN.value, participant_code=None)
    updated = Scorecard()
    updated.record("A1", "positive", "예", "그렇다고 답함")
    engine = ScriptedEngine(
        engine_result("첫 질문입니다."),
        engine_result("다음 질문입니다.", scorecard=updated.to_dict()),
    )
    service = InterviewService(db_session, engine=engine, clock=lambda: NOW)
    interview = asyncio.run(service.start(participant.id))
    asyncio.run(
        service.submit_turn(
            participant_id=participant.id,
            interview_id=interview.id,
            client_turn_id=uuid4(),
            content="답변",
        )
    )
    admin_id = admin.id
    interview_id = interview.id

    reviewed = service.review_scorecard(
        reviewer_user_id=admin_id,
        interview_id=interview_id,
        question_id="A1",
        action="override",
        expert_status="negative",
    )

    a1 = next(item for item in reviewed.scorecard_items if item.question_id == "A1")
    assert a1.expert_review is not None
    assert a1.expert_review.expert_status == "negative"
    assert a1.expert_review.rationale is None

    # the rule that protects the instrument still holds
    with pytest.raises(InvalidReview):
        service.review_scorecard(
            reviewer_user_id=admin_id,
            interview_id=interview_id,
            question_id="A1",
            action="override",
            expert_status="positive",
        )


def test_a_finished_interview_does_not_block_the_next_one(
    db_session: Session,
) -> None:
    participant = create_account(db_session, participant_code="P-AGAIN")
    engine = ScriptedEngine(
        engine_result("첫 인터뷰의 첫 질문입니다.", complete=True),
        engine_result("새 인터뷰의 첫 질문입니다."),
    )
    service = InterviewService(db_session, engine=engine, clock=lambda: NOW)
    finished = asyncio.run(service.start(participant.id))
    assert finished.status == "completed"

    again = asyncio.run(service.start(participant.id))

    assert again.id != finished.id
    assert again.status == "active"
    assert service.get_current(participant.id).id == again.id


def test_a_running_interview_is_resumed_rather_than_duplicated(
    db_session: Session,
) -> None:
    participant = create_account(db_session, participant_code="P-RESUME")
    engine = ScriptedEngine(engine_result("첫 질문입니다."))
    service = InterviewService(db_session, engine=engine, clock=lambda: NOW)
    started = asyncio.run(service.start(participant.id))

    resumed = asyncio.run(service.start(participant.id))

    assert resumed.id == started.id


def test_an_abandoned_interview_can_be_archived_out_of_the_queue(
    db_session: Session,
) -> None:
    participant = create_account(db_session, participant_code="P-ABANDON")
    admin = create_account(db_session, role=Role.ADMIN.value, participant_code=None)
    engine = ScriptedEngine(
        engine_result("첫 질문입니다."),
        engine_result("새 인터뷰의 첫 질문입니다."),
    )
    service = InterviewService(db_session, engine=engine, clock=lambda: NOW)
    abandoned = asyncio.run(service.start(participant.id))
    admin_id = admin.id
    participant_id = participant.id

    archived = service.archive_interview(
        reviewer_user_id=admin_id,
        interview_id=abandoned.id,
    )

    assert archived.status == "archived"
    assert service.get_current(participant_id) is None
    restarted = asyncio.run(service.start(participant_id))
    assert restarted.id != archived.id
