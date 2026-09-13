"""Transactional service for persisted interviews and researcher review."""

from __future__ import annotations

import asyncio
import csv
import io
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from threading import Lock
from typing import Protocol
from uuid import UUID, uuid4

from interview.engine import EngineTurnResult
from interview.models import ExpertReview, Interview, InterviewMessage, ScorecardItem
from interview.repository import InterviewRepository
from interview.scorecard import Scorecard
from sqlalchemy.orm import Session


class InterviewNotFound(Exception):
    """Raised when an interview is absent or outside participant ownership."""


class InterviewStateConflict(Exception):
    """Raised when an interview cannot accept the requested transition."""


class InterviewBusy(Exception):
    """Raised when another model turn is already running for an interview."""


class InvalidReview(Exception):
    """Raised when a review is invalid for the current scorecard state."""


class PersistedTurnEngine(Protocol):
    async def run_persisted_turn(
        self,
        session_id: str,
        messages: list[dict[str, str]],
        scorecard: dict,
        user_input: str,
    ) -> EngineTurnResult: ...


_LOCKS_GUARD = Lock()
_TURN_LOCKS: dict[str, Lock] = {}
_TURN_LOCK_REFERENCES: dict[str, int] = {}


def _retain_lock(key: str) -> Lock:
    with _LOCKS_GUARD:
        lock = _TURN_LOCKS.setdefault(key, Lock())
        _TURN_LOCK_REFERENCES[key] = _TURN_LOCK_REFERENCES.get(key, 0) + 1
        return lock


def _release_lock_reference(key: str, lock: Lock) -> None:
    with _LOCKS_GUARD:
        if _TURN_LOCKS.get(key) is not lock:
            return
        references = _TURN_LOCK_REFERENCES[key] - 1
        if references == 0:
            del _TURN_LOCK_REFERENCES[key]
            del _TURN_LOCKS[key]
        else:
            _TURN_LOCK_REFERENCES[key] = references


def _utc_now() -> datetime:
    return datetime.now(UTC)


class InterviewService:
    """Coordinate model turns, PostgreSQL commits, review, and export."""

    def __init__(
        self,
        session: Session,
        *,
        engine: PersistedTurnEngine | None = None,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        self.session = session
        self.repository = InterviewRepository(session)
        self.engine = engine
        self.clock = clock

    def get_current(self, participant_id: UUID) -> Interview | None:
        with self.session.begin():
            return self.repository.get_current(participant_id)

    @staticmethod
    def _running(interview: Interview | None) -> Interview | None:
        """A finished interview is history; only a running one is resumed."""
        if interview is not None and interview.status == "active":
            return interview
        return None

    async def start(self, participant_id: UUID) -> Interview:
        lock_key = f"participant:{participant_id}"
        lock = _retain_lock(lock_key)
        acquired = False
        try:
            while not lock.acquire(blocking=False):
                await asyncio.sleep(0.01)
            acquired = True
            with self.session.begin():
                running = self._running(self.repository.get_current(participant_id))
                if running is not None:
                    return running

            engine = self._require_engine()
            initial_scorecard = Scorecard().to_dict()
            interview_id = uuid4()
            result = await engine.run_persisted_turn(
                session_id=str(interview_id),
                messages=[],
                scorecard=initial_scorecard,
                user_input="",
            )

            now = self.clock()
            with self.session.begin():
                self.repository.lock_interview_start(participant_id)
                running = self._running(
                    self.repository.get_current(participant_id, for_update=True)
                )
                if running is not None:
                    return running

                interview = Interview(
                    id=interview_id,
                    participant_id=participant_id,
                    status="completed" if result.interview_complete else "active",
                    progress=100 if result.interview_complete else 0,
                    criteria=result.scorecard.get("criteria", {}),
                    final_diagnosis=result.final_diagnosis,
                    report=result.report,
                    created_at=now,
                    updated_at=now,
                    completed_at=now if result.interview_complete else None,
                )
                interview.messages.append(
                    InterviewMessage(
                        sequence=0,
                        role="assistant",
                        content=result.participant_message,
                        client_turn_id=None,
                        created_at=now,
                    )
                )
                self._apply_scorecard(interview, result.scorecard, now)
                self.repository.add_interview(interview)
                return interview
        finally:
            if acquired:
                lock.release()
            _release_lock_reference(lock_key, lock)

    async def submit_turn(
        self,
        *,
        participant_id: UUID,
        interview_id: UUID,
        client_turn_id: UUID,
        content: str,
    ) -> Interview:
        lock_key = f"interview:{interview_id}"
        lock = _retain_lock(lock_key)
        if not lock.acquire(blocking=False):
            _release_lock_reference(lock_key, lock)
            raise InterviewBusy
        try:
            with self.session.begin():
                interview = self.repository.get_owned(
                    interview_id,
                    participant_id,
                )
                if interview is None:
                    raise InterviewNotFound
                if self.repository.has_committed_turn(interview_id, client_turn_id):
                    return interview
                if interview.status != "active":
                    raise InterviewStateConflict
                persisted_messages = [
                    {"role": message.role, "content": message.content}
                    for message in interview.messages
                ]
                scorecard = self._scorecard_dict(interview)

            result = await self._require_engine().run_persisted_turn(
                session_id=str(interview_id),
                messages=persisted_messages,
                scorecard=scorecard,
                user_input=content,
            )

            now = self.clock()
            with self.session.begin():
                interview = self.repository.get_owned(
                    interview_id,
                    participant_id,
                    for_update=True,
                )
                if interview is None:
                    raise InterviewNotFound
                if self.repository.has_committed_turn(interview_id, client_turn_id):
                    return interview
                if interview.status != "active":
                    raise InterviewStateConflict

                next_sequence = (
                    max((message.sequence for message in interview.messages), default=-1)
                    + 1
                )
                answer = InterviewMessage(
                    sequence=next_sequence,
                    role="user",
                    content=content,
                    client_turn_id=client_turn_id,
                    created_at=now,
                )
                interview.messages.extend(
                    (
                        answer,
                        InterviewMessage(
                            sequence=next_sequence + 1,
                            role="assistant",
                            content=result.participant_message,
                            client_turn_id=client_turn_id,
                            created_at=now,
                        ),
                    )
                )
                self._apply_scorecard(interview, result.scorecard, now, answer)
                interview.criteria = result.scorecard.get("criteria", {})
                interview.final_diagnosis = result.final_diagnosis
                interview.report = result.report
                interview.updated_at = now
                if result.interview_complete:
                    interview.status = "completed"
                    interview.progress = 100
                    interview.completed_at = now
                self.session.flush()
                return interview
        finally:
            lock.release()
            _release_lock_reference(lock_key, lock)

    def list_for_admin(self) -> list[Interview]:
        with self.session.begin():
            return self.repository.list_for_admin()

    def statuses_for_participants(
        self,
        participant_ids: list[UUID],
    ) -> dict[UUID, str]:
        with self.session.begin():
            return self.repository.statuses_for_participants(participant_ids)

    def get_for_admin(self, interview_id: UUID) -> Interview:
        with self.session.begin():
            interview = self.repository.get_for_admin(interview_id)
            if interview is None:
                raise InterviewNotFound
            return interview

    def review_scorecard(
        self,
        *,
        reviewer_user_id: UUID,
        interview_id: UUID,
        question_id: str,
        action: str,
        expert_status: str | None = None,
        rationale: str | None = None,
    ) -> Interview:
        now = self.clock()
        with self.session.begin():
            interview = self.repository.get_for_admin(interview_id, for_update=True)
            if interview is None:
                raise InterviewNotFound
            item = next(
                (
                    candidate
                    for candidate in interview.scorecard_items
                    if candidate.question_id == question_id
                ),
                None,
            )
            if item is None:
                raise InterviewNotFound
            if item.ai_status is None:
                raise InvalidReview("An AI decision is required")

            clean_rationale = (rationale or "").strip() or None
            if action == "approve":
                resolved_status = item.ai_status
            elif action == "override":
                if item.ai_status == "recorded":
                    raise InvalidReview("Recorded items can only be approved")
                if expert_status not in ("positive", "negative"):
                    raise InvalidReview("Override requires a binary expert status")
                if expert_status == item.ai_status:
                    raise InvalidReview("Override must change the AI decision")
                resolved_status = expert_status
            else:
                raise InvalidReview("Unknown review action")

            review = item.expert_review
            if review is None:
                review = ExpertReview(
                    scorecard_item=item,
                    reviewer_user_id=reviewer_user_id,
                    original_status=item.ai_status,
                    expert_status=resolved_status,
                    action=action,
                    rationale=clean_rationale,
                    reviewed_at=now,
                )
                self.repository.add_review(review)
                item.expert_review = review
            else:
                review.reviewer_user_id = reviewer_user_id
                review.original_status = item.ai_status
                review.expert_status = resolved_status
                review.action = action
                review.rationale = clean_rationale
                review.reviewed_at = now

            self.repository.add_audit_event(
                actor_user_id=reviewer_user_id,
                action="interview.scorecard_reviewed",
                target_id=interview.id,
                occurred_at=now,
                details={"question_id": question_id, "action": action},
            )
            self.session.flush()
            return interview

    CSV_HEADER = (
        "interviewId",
        "participantCode",
        "status",
        "progress",
        "reviewStatus",
        "finalDiagnosis",
        "criteriaA",
        "criteriaB",
        "criteriaC",
        "criteriaD",
        "completedAt",
        "algorithmVersion",
        "report",
        "questionId",
        "question",
        "answer",
        "value",
        "aiStatus",
        "expertStatus",
        "expertRationale",
    )

    def archive_interview(self, *, reviewer_user_id: UUID, interview_id: UUID) -> Interview:
        """Retire an interview so the participant can begin a new one.

        A finished interview is filed away; an abandoned one is closed out of
        the queue. Either way the record stays in the queue listing and in
        exports; it simply stops being the participant's current interview.
        """
        now = self.clock()
        with self.session.begin():
            interview = self.repository.get_for_admin(interview_id, for_update=True)
            if interview is None:
                raise InterviewNotFound
            if interview.status == "archived":
                raise InterviewStateConflict
            interview.status = "archived"
            interview.archived_at = now
            interview.updated_at = now
            self.repository.add_audit_event(
                actor_user_id=reviewer_user_id,
                action="interview.archived",
                target_id=interview.id,
                occurred_at=now,
            )
            self.session.flush()
            return interview

    def export_csv(self, *, reviewer_user_id: UUID, interview_id: UUID) -> str:
        now = self.clock()
        with self.session.begin():
            interview = self.repository.get_for_admin(interview_id)
            if interview is None:
                raise InterviewNotFound
            return self._write_csv([interview], reviewer_user_id, now)

    def export_many_csv(
        self,
        *,
        reviewer_user_id: UUID,
        interview_ids: Sequence[UUID] | None = None,
        participant_ids: Sequence[UUID] | None = None,
    ) -> str:
        """Export every interview, or the ones a reviewer picked by either key."""
        now = self.clock()
        with self.session.begin():
            interviews = self.repository.list_for_admin()
            if interview_ids:
                wanted = set(interview_ids)
                interviews = [row for row in interviews if row.id in wanted]
            if participant_ids:
                subjects = set(participant_ids)
                interviews = [
                    row for row in interviews if row.participant_id in subjects
                ]
            return self._write_csv(interviews, reviewer_user_id, now)

    def _write_csv(
        self,
        interviews: Sequence[Interview],
        reviewer_user_id: UUID,
        now: datetime,
    ) -> str:
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        writer.writerow(self.CSV_HEADER)
        for interview in interviews:
            review_status = self.review_status(interview)
            criteria = interview.criteria or {}
            for item in interview.scorecard_items:
                review = item.expert_review
                writer.writerow(
                    self._csv_safe(value)
                    for value in (
                        str(interview.id),
                        interview.subject_label,
                        interview.status,
                        interview.progress,
                        review_status,
                        interview.final_diagnosis,
                        criteria.get("A"),
                        criteria.get("B"),
                        criteria.get("C"),
                        criteria.get("D"),
                        interview.completed_at.isoformat()
                        if interview.completed_at
                        else None,
                        interview.algorithm_version,
                        interview.report,
                        item.question_id,
                        item.question,
                        item.answer_message.content if item.answer_message else None,
                        item.value,
                        item.ai_status,
                        review.expert_status if review else None,
                        review.rationale if review else None,
                    )
                )
            self.repository.add_audit_event(
                actor_user_id=reviewer_user_id,
                action="interview.csv_exported",
                target_id=interview.id,
                occurred_at=now,
            )
        return output.getvalue()

    @staticmethod
    def review_status(interview: Interview) -> str:
        """How far the expert has gotten with this interview.

        A running interview can never be fully reviewed: questions the
        participant has not reached yet will still arrive.
        """
        eligible = [
            item for item in interview.scorecard_items if item.ai_status is not None
        ]
        reviewed = [item for item in eligible if item.expert_review is not None]
        if not reviewed:
            return "unreviewed"
        if len(reviewed) == len(eligible) and interview.status != "active":
            return "reviewed"
        return "in_review"

    def _require_engine(self) -> PersistedTurnEngine:
        if self.engine is None:
            raise RuntimeError("An interview engine is required for model turns")
        return self.engine

    def _scorecard_dict(self, interview: Interview) -> dict:
        scorecard = Scorecard().to_dict()
        scorecard["criteria"] = dict(interview.criteria)
        scorecard["diagnosis"] = interview.final_diagnosis
        scorecard["report"] = interview.report
        for item in interview.scorecard_items:
            current = scorecard["items"].get(item.question_id)
            if current is None:
                continue
            current.update(
                {
                    "question": item.question,
                    "status": item.ai_status,
                    "value": item.value,
                    "rationale": item.rationale,
                    "clarification_count": item.clarification_count,
                    "timestamp": (
                        item.evaluated_at.isoformat()
                        if item.evaluated_at is not None
                        else None
                    ),
                }
            )
        return scorecard

    def _apply_scorecard(
        self,
        interview: Interview,
        scorecard: dict,
        now: datetime,
        answer: InterviewMessage | None = None,
    ) -> None:
        item_data = scorecard.get("items", {})
        order = scorecard.get("question_order", list(item_data))
        existing = {item.question_id: item for item in interview.scorecard_items}
        evaluated_count = 0
        for position, question_id in enumerate(order):
            data = item_data.get(question_id, {})
            item = existing.get(question_id)
            if item is None:
                item = ScorecardItem(
                    question_id=question_id,
                    position=position,
                    question=data.get("question", ""),
                )
                interview.scorecard_items.append(item)
            elif item.expert_review is not None and (
                item.ai_status,
                item.value,
                item.rationale,
            ) != (
                data.get("status"),
                data.get("value"),
                data.get("rationale"),
            ):
                item.expert_review = None
            was_open = item.ai_status is None
            item.position = position
            item.question = data.get("question", item.question)
            item.ai_status = data.get("status")
            item.value = data.get("value")
            item.rationale = data.get("rationale")
            item.clarification_count = int(data.get("clarification_count", 0))
            item.evaluated_at = self._parse_timestamp(data.get("timestamp"), now)
            if answer is not None and item.ai_status is not None and was_open:
                item.answer_message = answer
            if item.ai_status is not None:
                evaluated_count += 1
        interview.criteria = scorecard.get("criteria", {})
        if order and interview.status != "completed":
            interview.progress = int(evaluated_count * 100 / len(order))

    @staticmethod
    def _parse_timestamp(value: object, fallback: datetime) -> datetime | None:
        if not value:
            return None
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return fallback
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed

    @staticmethod
    def _csv_safe(value: object) -> object:
        if not isinstance(value, str) or not value:
            return "" if value is None else value
        candidate = value.lstrip()
        if candidate and candidate[0] in "=+-@\t\r":
            return "'" + value
        return value
