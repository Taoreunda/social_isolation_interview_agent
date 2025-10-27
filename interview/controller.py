"""인터뷰 질문과 규칙을 중앙에서 관리하는 컨트롤러."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from .prompts import PROMPT_TEMPLATES


FLOW_CONFIG_PATH = Path("interview_flow.json")


@dataclass
class QuestionConfig:
    """단일 질문에 대한 설정."""

    id: str
    text: str
    prompt_template: Optional[str]
    next_question_map: Dict[str, str] = field(default_factory=dict)
    criterion: Optional[str] = None
    use_llm: bool = True
    max_clarifications: int = 3
    metadata: Dict[str, Any] = field(default_factory=dict)


class InterviewController:
    """질문 관리, 기준 평가, 진단 계산을 담당."""

    def __init__(self) -> None:
        self.flow_config = self._load_flow_config()
        self.questions = self._build_question_configs(self.flow_config)
        self.question_order = self._build_question_order()

    # ------------------------------------------------------------------
    # 퍼블릭 API
    # ------------------------------------------------------------------

    def get_question(self, question_id: Optional[str]) -> Optional[QuestionConfig]:
        if not question_id:
            return None
        return self.questions.get(question_id)

    def first_question(self) -> QuestionConfig:
        return self.questions[self.question_order[0]]

    def next_question(self, current_question_id: str, status: str) -> Optional[QuestionConfig]:
        current = self.questions.get(current_question_id)
        if not current:
            return None

        next_id = current.next_question_map.get(status)
        if not next_id or next_id not in self.questions:
            try:
                idx = self.question_order.index(current_question_id)
            except ValueError:
                idx = -1
            if idx >= 0 and idx + 1 < len(self.question_order):
                next_id = self.question_order[idx + 1]
            else:
                next_id = None

        if not next_id:
            return None
        return self.questions.get(next_id)

    def evaluate_criteria(self, question_results: Dict[str, Dict[str, Any]]) -> Dict[str, bool]:
        """A, B, C, D 기준 충족 여부를 계산한다."""

        def is_positive(question_id: str) -> Optional[bool]:
            status = question_results.get(question_id, {}).get("status")
            if status == "positive":
                return True
            if status == "negative":
                return False
            return None

        criteria: Dict[str, bool] = {}

        # A 기준: (A1 OR A2) AND A3
        a3 = is_positive("A3")
        a1 = is_positive("A1")
        a2 = is_positive("A2")
        if a3 is not None and (a1 is not None or a2 is not None):
            criteria["A"] = bool(a3 and ((a1 is True) or (a2 is True)))

        # B 기준: B1 AND B2
        b1 = is_positive("B1")
        b2 = is_positive("B2")
        if b1 is not None and b2 is not None:
            criteria["B"] = bool(b1 and b2)

        # C 기준: C1 AND C2
        c1 = is_positive("C1")
        c2 = is_positive("C2")
        if c1 is not None and c2 is not None:
            criteria["C"] = bool(c1 and c2)

        # D 기준: (D1 AND D1_duration) OR (D2 AND D2_duration)
        d1 = is_positive("D1")
        d1_duration = is_positive("D1_duration")
        d2 = is_positive("D2")
        d2_duration = is_positive("D2_duration")

        d_path_1_ready = d1 is not None and d1_duration is not None
        d_path_2_ready = d2 is not None and d2_duration is not None

        if d_path_1_ready or d_path_2_ready:
            met = False
            if d_path_1_ready:
                met = met or bool(d1 and d1_duration)
            if d_path_2_ready:
                met = met or bool(d2 and d2_duration)
            criteria["D"] = met

        return criteria

    @staticmethod
    def should_stop_early(criteria_results: Dict[str, bool]) -> bool:
        """A, B, C 기준이 모두 비충족이면 조기 종료."""

        if not {"A", "B", "C"}.issubset(criteria_results.keys()):
            return False
        return not (criteria_results["A"] or criteria_results["B"] or criteria_results["C"])

    @staticmethod
    def get_final_diagnosis(criteria_results: Dict[str, bool]) -> Optional[str]:
        required_keys = {"B", "C"}
        if not required_keys.issubset(criteria_results.keys()):
            return None

        a_met = criteria_results.get("A", False)
        b_met = criteria_results.get("B", False)
        c_met = criteria_results.get("C", False)
        d_met = criteria_results.get("D", False)

        if a_met and b_met and c_met and d_met:
            return "히키코모리"
        if b_met and c_met and d_met:
            return "사회적 고립"
        if b_met is False and c_met is False and d_met is False:
            return "일반"
        return None

    @staticmethod
    def has_abc(criteria_results: Dict[str, bool]) -> bool:
        return {"A", "B", "C"}.issubset(criteria_results.keys())

    # ------------------------------------------------------------------
    # 내부 헬퍼
    # ------------------------------------------------------------------

    def _load_flow_config(self) -> Dict[str, Any]:
        with FLOW_CONFIG_PATH.open("r", encoding="utf-8") as file:
            return json.load(file)

    def _build_question_configs(self, config: Dict[str, Any]) -> Dict[str, QuestionConfig]:
        nodes = config.get("nodes", {})
        questions: Dict[str, QuestionConfig] = {}

        for node_id, node in nodes.items():
            if node.get("type") != "question":
                continue

            question_text = node.get("question_text") or ""
            llm_chain = node.get("llm_chain") or {}
            prompt_key = llm_chain.get("prompt_key") or node.get("prompt_key")
            prompt_template = llm_chain.get("prompt_template")

            if prompt_key:
                try:
                    template_source = PROMPT_TEMPLATES[prompt_key]
                except KeyError as exc:
                    raise KeyError(
                        f"Prompt template not found for key '{prompt_key}' (node {node_id})"
                    ) from exc

                if callable(template_source):
                    prompt_template = template_source(question_text)
                else:
                    prompt_template = template_source

            max_clarifications = int(node.get("max_clarifications", 3))

            next_map: Dict[str, str] = {}
            if "next_nodes" in node:
                for status, next_node in node["next_nodes"].items():
                    if next_node:
                        next_map[status] = next_node
            elif node.get("next_node"):
                next_map["recorded"] = node.get("next_node")

            use_llm = bool(prompt_template)
            if not use_llm:
                max_clarifications = 0
            criterion = self._infer_criterion(node_id)

            questions[node_id] = QuestionConfig(
                id=node_id,
                text=question_text,
                prompt_template=prompt_template,
                next_question_map=next_map,
                criterion=criterion,
                use_llm=use_llm,
                max_clarifications=max_clarifications,
                metadata={
                    "response_handler": node.get("response_handler"),
                    "prompt_key": prompt_key,
                },
            )

        for question in questions.values():
            if not question.next_question_map:
                question.next_question_map = {}

        return questions

    def _build_question_order(self) -> List[str]:
        preferred_order = [
            "A1", "A2", "A3",
            "B1", "B2",
            "C1", "C2",
            "D1", "D1_duration",
            "D2", "D2_duration",
            "E1", "E2",
        ]

        order = [qid for qid in preferred_order if qid in self.questions]

        for qid in self.questions.keys():
            if qid not in order:
                order.append(qid)

        return order

    @staticmethod
    def _infer_criterion(question_id: str) -> Optional[str]:
        if not question_id:
            return None
        prefix = question_id.split("_")[0]
        if not prefix:
            prefix = question_id

        letter = prefix[0]
        if letter in {"A", "B", "C", "D"}:
            return letter
        return None
