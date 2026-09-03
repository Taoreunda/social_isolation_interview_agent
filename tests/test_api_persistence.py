"""Persistence checks for the FastAPI web frontend."""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient

import api
from interview.scorecard import Scorecard


def _configure_temp_storage(tmp_dir: Path) -> None:
    api._sessions.clear()
    api.WEB_SESSIONS_DIR = tmp_dir / "web_sessions"
    api.RESULTS_DIR = tmp_dir / "results"
    api.WEB_SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    api.RESULTS_DIR.mkdir(parents=True, exist_ok=True)


def _write_result_payload(results_dir: Path) -> None:
    payload = {
        "session_id": "saved_result_001",
        "completed_at": "2026-05-19T10:00:00",
        "final_diagnosis": "일반",
        "criteria_results": {"A": False, "B": False, "C": False, "D": False},
        "question_results": {
            "A1": {
                "status": "negative",
                "extracted_value": "매일 출근함",
                "rationale": "집에만 머무르지 않는다고 답변함",
                "timestamp": "2026-05-19T09:50:00",
            }
        },
        "conversation_history": [
            {"role": "user", "content": "[시스템] 인터뷰를 시작하세요."},
            {"role": "assistant", "content": "지난 한 달 동안 주로 집에 계셨나요?"},
            {"role": "user", "content": "아니요, 매일 출근합니다."},
        ],
    }
    (results_dir / "result_saved_result_001_20260519_100000.json").write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def test_saved_result_files_load_into_session_endpoints() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        _configure_temp_storage(tmp_dir)
        _write_result_payload(api.RESULTS_DIR)

        client = TestClient(api.app)

        sessions = client.get("/api/sessions")
        assert sessions.status_code == 200
        session_ids = [item["session_id"] for item in sessions.json()["sessions"]]
        assert "saved_result_001" in session_ids

        detail = client.get("/api/sessions/saved_result_001")
        assert detail.status_code == 200
        body = detail.json()
        assert body["session_id"] == "saved_result_001"
        assert body["interview_complete"] is True
        assert body["conversation"] == [
            {"role": "assistant", "content": "지난 한 달 동안 주로 집에 계셨나요?"},
            {"role": "user", "content": "아니요, 매일 출근합니다."},
        ]
        assert body["scorecard"]["answered"] == 1


def test_web_sessions_persist_and_reload_from_disk() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        _configure_temp_storage(tmp_dir)

        sc = Scorecard()
        sc.record("A1", "negative", "매일 출근함", "집에만 있지 않음")
        api._sessions["web_session_001"] = {
            "created_at": "2026-05-19T11:00:00",
            "updated_at": "2026-05-19T11:01:00",
            "last_state": {
                "session_id": "web_session_001",
                "messages": [
                    {"type": "human", "content": "[시스템] 인터뷰를 시작하세요."},
                    {"type": "ai", "content": "지난 한 달 동안 주로 집에 계셨나요?"},
                    {"type": "human", "content": "아니요, 매일 출근합니다."},
                ],
                "scorecard": sc.to_dict(),
                "interview_complete": False,
            },
            "expert_reviews": {
                "A1": {
                    "original_status": "negative",
                    "expert_status": "negative",
                    "expert_rationale": None,
                    "action": "approve",
                    "reviewed_at": "2026-05-19T11:02:00",
                }
            },
        }

        assert api._persist_session("web_session_001") is True

        api._sessions.clear()
        api._load_sessions_from_disk()

        assert "web_session_001" in api._sessions
        restored = api._sessions["web_session_001"]
        assert restored["expert_reviews"]["A1"]["action"] == "approve"
        assert restored["last_state"]["scorecard"]["items"]["A1"]["status"] == "negative"


if __name__ == "__main__":
    test_saved_result_files_load_into_session_endpoints()
    test_web_sessions_persist_and_reload_from_disk()
