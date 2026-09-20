"""평가표(Scorecard) 데이터 + CRUD + calculate 로직."""

from __future__ import annotations

import json
from datetime import datetime
from functools import lru_cache
from typing import Any, Dict, List, Optional

from app_core.paths import FLOW_CONFIG_PATH

from .criteria import FREE_RESPONSE_CRITERIA, QUESTION_CRITERIA


@lru_cache(maxsize=1)
def _load_flow_config() -> Dict[str, Any]:
    """Parse interview_flow.json once; it is static for the process lifetime."""
    with FLOW_CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)

_E_QUESTIONS = ("E1", "E2")


def _is_positive(status: Optional[str]) -> Optional[bool]:
    """Convert status string to boolean. None if not evaluated."""
    if status == "positive":
        return True
    if status == "negative":
        return False
    return None


def calculate_with_overrides(scorecard_dict: dict, expert_reviews: dict) -> dict:
    """전문가 오버라이드를 반영하여 기준 재계산.

    원본 scorecard_dict를 변경하지 않고 expert_reviews의 expert_status를
    적용한 뒤 A/B/C/D 기준을 다시 산출합니다.

    Args:
        scorecard_dict: Scorecard.to_dict() 결과
        expert_reviews: {question_id: {"expert_status": "positive"|"negative", ...}}

    Returns:
        {"criteria": {"A": bool|None, ...}, "diagnosis": str|None, "early_stop": bool}
    """
    items = {}
    for qid, item_data in scorecard_dict.get("items", {}).items():
        status = item_data.get("status")
        # 전문가 오버라이드가 있으면 expert_status로 교체
        review = expert_reviews.get(qid)
        if review and review.get("expert_status") is not None:
            status = review["expert_status"]
        items[qid] = status

    def pos(qid: str) -> Optional[bool]:
        return _is_positive(items.get(qid))

    criteria: Dict[str, Optional[bool]] = {"A": None, "B": None, "C": None, "D": None}

    # A = (A1 or A2) and A3
    a1, a2, a3 = pos("A1"), pos("A2"), pos("A3")
    if a3 is not None and (a1 is not None or a2 is not None):
        criteria["A"] = bool(a3 and ((a1 is True) or (a2 is True)))

    # B = B1 and B2
    b1, b2 = pos("B1"), pos("B2")
    if b1 is not None and b2 is not None:
        criteria["B"] = bool(b1 and b2)

    # C = C1 and C2
    c1, c2 = pos("C1"), pos("C2")
    if c1 is not None and c2 is not None:
        criteria["C"] = bool(c1 and c2)

    # D = (D1 and D1_duration) or (D2 and D2_duration)
    d1, d1d = pos("D1"), pos("D1_duration")
    d2, d2d = pos("D2"), pos("D2_duration")
    d_path1 = bool(d1 is True and d1d is True)
    d_path2 = bool(d2 is True and d2d is True)
    d_path1_ready = (d1 is not None and d1d is not None) or (d1 is False)
    d_path2_ready = (d2 is not None and d2d is not None) or (d2 is False)
    if d_path1_ready or d_path2_ready:
        criteria["D"] = d_path1 or d_path2

    # Early stop
    early_stop = False
    diagnosis: Optional[str] = None
    a_val, b_val, c_val = criteria["A"], criteria["B"], criteria["C"]
    if a_val is not None and b_val is not None and c_val is not None:
        if not a_val and not b_val and not c_val:
            early_stop = True
            diagnosis = "일반"

    # Final diagnosis
    if not early_stop and all(v is not None for v in criteria.values()):
        if criteria["A"] and criteria["B"] and criteria["C"] and criteria["D"]:
            diagnosis = "히키코모리"
        elif criteria["B"] and criteria["C"] and criteria["D"]:
            diagnosis = "사회적 고립"
        else:
            diagnosis = "일반"

    return {"criteria": criteria, "diagnosis": diagnosis, "early_stop": early_stop}


class Scorecard:
    """평가표 데이터 관리 + 결정론적 calculate 로직."""

    def __init__(self) -> None:
        flow_config = _load_flow_config()
        self.items: Dict[str, Dict[str, Any]] = {}
        self.question_order: List[str] = []
        self.criteria: Dict[str, Optional[bool]] = {
            "A": None, "B": None, "C": None, "D": None,
        }
        self.early_stop: bool = False
        self.diagnosis: Optional[str] = None
        self.report: Optional[str] = None

        self._build_items(flow_config)

    # ------------------------------------------------------------------
    # CRUD operations
    # ------------------------------------------------------------------

    def record(
        self,
        question_id: str,
        status: str,
        value: Optional[str] = None,
        rationale: Optional[str] = None,
    ) -> str:
        """기입. 반환: ToolMessage 문자열."""
        item = self.items.get(question_id)
        if not item:
            return f"오류: 알 수 없는 질문 ID '{question_id}'."

        if item["status"] is not None:
            return (
                f"오류: '{question_id}'은 이미 기입됨 (status={item['status']}). "
                "수정하려면 action='update'를 사용하세요."
            )

        # Clarification count check (E questions exempt)
        if question_id not in _E_QUESTIONS and status not in ("recorded",):
            if item["clarification_count"] >= item["max_clarifications"]:
                return (
                    f"오류: '{question_id}' 재질문 한도({item['max_clarifications']}회) 초과. "
                    "status='negative'로 기입해 주세요."
                )

        item["status"] = status
        item["value"] = value
        item["rationale"] = rationale
        item["timestamp"] = datetime.utcnow().isoformat(timespec="seconds")

        return self._build_tool_response(f"{question_id} 기입 완료.")

    def update(
        self,
        question_id: str,
        status: str,
        value: Optional[str] = None,
        rationale: Optional[str] = None,
    ) -> str:
        """수정. 반환: ToolMessage 문자열."""
        item = self.items.get(question_id)
        if not item:
            return f"오류: 알 수 없는 질문 ID '{question_id}'."

        item["status"] = status
        item["value"] = value
        item["rationale"] = rationale
        item["timestamp"] = datetime.utcnow().isoformat(timespec="seconds")

        return self._build_tool_response(f"{question_id} 수정 완료.")

    def clear(self, question_id: str) -> str:
        """초기화. 반환: ToolMessage 문자열."""
        item = self.items.get(question_id)
        if not item:
            return f"오류: 알 수 없는 질문 ID '{question_id}'."

        item["status"] = None
        item["value"] = None
        item["rationale"] = None
        item["timestamp"] = None
        # Do NOT reset clarification_count — it persists across clears.

        return self._build_tool_response(f"{question_id} 초기화 완료.")

    def increment_clarification(self, question_id: str) -> int:
        """재질문 횟수 증가. 반환: 현재 횟수."""
        item = self.items.get(question_id)
        if not item:
            return 0
        item["clarification_count"] += 1
        return item["clarification_count"]

    def calculate(self) -> str:
        """기준 판정 + 조기종료 + 최종 진단. 반환: ToolMessage 문자열."""

        # A = (A1 or A2) and A3
        a1 = _is_positive(self.items["A1"]["status"])
        a2 = _is_positive(self.items["A2"]["status"])
        a3 = _is_positive(self.items["A3"]["status"])
        if a3 is not None and (a1 is not None or a2 is not None):
            a1_or_a2 = (a1 is True) or (a2 is True)
            self.criteria["A"] = bool(a3 and a1_or_a2)

        # B = B1 and B2
        b1 = _is_positive(self.items["B1"]["status"])
        b2 = _is_positive(self.items["B2"]["status"])
        if b1 is not None and b2 is not None:
            self.criteria["B"] = bool(b1 and b2)

        # C = C1 and C2
        c1 = _is_positive(self.items["C1"]["status"])
        c2 = _is_positive(self.items["C2"]["status"])
        if c1 is not None and c2 is not None:
            self.criteria["C"] = bool(c1 and c2)

        # D = (D1 and D1_duration) or (D2 and D2_duration)
        d1 = _is_positive(self.items["D1"]["status"])
        d1_dur = _is_positive(self.items["D1_duration"]["status"])
        d2 = _is_positive(self.items["D2"]["status"])
        d2_dur = _is_positive(self.items["D2_duration"]["status"])

        d_path1 = bool(d1 is True and d1_dur is True)
        d_path2 = bool(d2 is True and d2_dur is True)

        # Only set D if at least one path is decidable
        d_path1_ready = (d1 is not None and d1_dur is not None) or (d1 is False)
        d_path2_ready = (d2 is not None and d2_dur is not None) or (d2 is False)
        if d_path1_ready or d_path2_ready:
            self.criteria["D"] = d_path1 or d_path2

        # Early stop: A, B, C all False
        a_val = self.criteria["A"]
        b_val = self.criteria["B"]
        c_val = self.criteria["C"]
        if a_val is not None and b_val is not None and c_val is not None:
            if not a_val and not b_val and not c_val:
                self.early_stop = True
                self.diagnosis = "일반"

        # Final diagnosis (when all criteria computed)
        if not self.early_stop and all(v is not None for v in self.criteria.values()):
            a_met = self.criteria["A"]
            b_met = self.criteria["B"]
            c_met = self.criteria["C"]
            d_met = self.criteria["D"]

            if a_met and b_met and c_met and d_met:
                self.diagnosis = "히키코모리"
            elif b_met and c_met and d_met:
                self.diagnosis = "사회적 고립"
            else:
                self.diagnosis = "일반"

        # Build response
        parts = ["calculate 완료."]
        parts.append(f"A={self.criteria['A']}, B={self.criteria['B']}, "
                     f"C={self.criteria['C']}, D={self.criteria['D']}")
        if self.early_stop:
            parts.append("early_stop=true. 진단: 일반. 인터뷰를 종료하세요.")
        elif self.diagnosis:
            parts.append(f"최종 진단: {self.diagnosis}. 인터뷰를 종료하세요.")

        result = "\n".join(parts)
        result += "\n─────────\n" + self.to_prompt()
        return result

    # ------------------------------------------------------------------
    # Serialization / prompt helpers
    # ------------------------------------------------------------------

    def to_prompt(self) -> str:
        """현재 평가표 상태를 텍스트로 직렬화 (system prompt 삽입용)."""
        lines = []
        for qid in self.question_order:
            item = self.items[qid]
            status = item["status"] or "미평가"
            value_part = f" ({item['value']})" if item["value"] else ""
            next_marker = ""
            if status == "미평가" and not next_marker:
                # Check if this is the next unanswered
                nxt = self.next_unanswered()
                if nxt == qid:
                    next_marker = " ← 다음 질문"
            lines.append(f"{qid}: {status}{value_part}{next_marker}")

        # Criteria summary
        lines.append("")
        for key in ("A", "B", "C", "D"):
            val = self.criteria[key]
            if val is None:
                lines.append(f"{key} 판정: 미산출")
            elif val:
                lines.append(f"{key} 판정: 충족")
            else:
                lines.append(f"{key} 판정: 비충족")

        if self.early_stop:
            lines.append("조기종료: 예 (A, B, C 모두 비충족)")
        if self.diagnosis:
            lines.append(f"진단: {self.diagnosis}")

        return "\n".join(lines)

    def next_unanswered(self) -> Optional[str]:
        """다음 미평가 항목 ID 반환. D 스킵 로직 포함."""
        for qid in self.question_order:
            item = self.items[qid]
            if item["status"] is not None:
                continue

            # D1_duration skip: if D1 is negative, skip D1_duration
            if qid == "D1_duration":
                d1_status = _is_positive(self.items["D1"]["status"])
                if d1_status is False:
                    continue

            # D2_duration skip: if D2 is negative, skip D2_duration
            if qid == "D2_duration":
                d2_status = _is_positive(self.items["D2"]["status"])
                if d2_status is False:
                    continue

            # Skip D/E questions if early stop
            if self.early_stop and qid[0] in ("D", "E"):
                continue

            return qid
        return None

    def get_criteria_text(self, question_id: str) -> str:
        """해당 질문의 평가 기준 텍스트 반환 (criteria.py)."""
        item = self.items.get(question_id)
        if not item:
            return ""
        return item.get("criteria", "")

    def to_dict(self) -> Dict[str, Any]:
        """State 직렬화."""
        return {
            "items": {
                qid: {
                    "question": item["question"],
                    "criteria": item["criteria"],
                    "status": item["status"],
                    "value": item["value"],
                    "rationale": item["rationale"],
                    "clarification_count": item["clarification_count"],
                    "max_clarifications": item["max_clarifications"],
                    "timestamp": item.get("timestamp"),
                }
                for qid, item in self.items.items()
            },
            "criteria": dict(self.criteria),
            "early_stop": self.early_stop,
            "diagnosis": self.diagnosis,
            "report": self.report,
            "question_order": list(self.question_order),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Scorecard":
        """State 역직렬화."""
        sc = cls.__new__(cls)
        sc.items = {}
        sc.question_order = data.get("question_order", [])
        sc.criteria = data.get("criteria", {"A": None, "B": None, "C": None, "D": None})
        sc.early_stop = data.get("early_stop", False)
        sc.diagnosis = data.get("diagnosis")
        sc.report = data.get("report")

        for qid, item_data in data.get("items", {}).items():
            sc.items[qid] = {
                "question": item_data.get("question", ""),
                "criteria": item_data.get("criteria", ""),
                "status": item_data.get("status"),
                "value": item_data.get("value"),
                "rationale": item_data.get("rationale"),
                "clarification_count": item_data.get("clarification_count", 0),
                "max_clarifications": item_data.get("max_clarifications", 3),
                "timestamp": item_data.get("timestamp"),
            }

        return sc

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_items(self, config: Dict[str, Any]) -> None:
        """interview_flow.json에서 질문 텍스트를, criteria.py에서 평가 기준을 로드."""
        nodes = config.get("nodes", {})

        preferred_order = [
            "A1", "A2", "A3",
            "B1", "B2",
            "C1", "C2",
            "D1", "D1_duration",
            "D2", "D2_duration",
            "E1", "E2",
        ]

        for qid in preferred_order:
            node = nodes.get(qid)
            if not node or node.get("type") != "question":
                continue

            question_text = node.get("question_text", "")
            max_clarifications = int(node.get("max_clarifications", 3))
            criteria_text = QUESTION_CRITERIA.get(qid, "")

            # E1/E2 have no LLM evaluation
            if qid in _E_QUESTIONS:
                max_clarifications = 0
                criteria_text = FREE_RESPONSE_CRITERIA

            self.items[qid] = {
                "question": question_text,
                "criteria": criteria_text,
                "status": None,
                "value": None,
                "rationale": None,
                "clarification_count": 0,
                "max_clarifications": max_clarifications,
                "timestamp": None,
            }

        self.question_order = [qid for qid in preferred_order if qid in self.items]

    def _build_tool_response(self, header: str) -> str:
        """ToolMessage 반환 포맷 구성."""
        parts = [header, "─────────", "현재 평가표:"]
        parts.append(self.to_prompt())

        nxt = self.next_unanswered()
        if nxt:
            criteria_text = self.get_criteria_text(nxt)
            if criteria_text:
                parts.append("─────────")
                parts.append(f"[{nxt} 평가 기준]")
                parts.append(criteria_text)

        return "\n".join(parts)
