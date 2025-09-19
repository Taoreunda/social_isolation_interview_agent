"""
Rule Engine for Social Isolation Interview
사회적 고립 인터뷰의 규칙을 평가하는 엔진
"""

from typing import Dict, List, Any, Optional
import logging
from interview.state_manager import InterviewState

logger = logging.getLogger(__name__)


class RuleEngine:
    """인터뷰 규칙을 평가하고 실행하는 클래스"""

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    def evaluate_condition(self, condition: Dict[str, Any], state: InterviewState) -> bool:
        """조건을 평가합니다."""
        try:
            operator = condition.get("operator")
            clauses = condition.get("clauses", [])

            if operator == "AND":
                return all(self.evaluate_clause(clause, state) for clause in clauses)
            elif operator == "OR":
                return any(self.evaluate_clause(clause, state) for clause in clauses)
            else:
                # 단일 조건
                return self.evaluate_clause(condition, state)

        except Exception as e:
            logger.error(f"Error evaluating condition: {e}")
            return False

    def evaluate_clause(self, clause: Dict[str, Any], state: InterviewState) -> bool:
        """개별 조건절을 평가합니다."""
        if "node_result" in clause:
            # 노드 결과 기반 평가
            node_id = clause["node_result"]
            expected_value = clause["equals"]

            node_result = state["interview_results"].get(node_id, {})
            actual_value = node_result.get("result")

            result = actual_value == expected_value
            logger.debug(f"Node {node_id}: {actual_value} == {expected_value} -> {result}")
            return result

        elif "state_value" in clause:
            # 상태 값 기반 평가
            state_key = clause["state_value"]
            expected_value = clause["equals"]

            actual_value = state.get(state_key)
            result = actual_value == expected_value
            logger.debug(f"State {state_key}: {actual_value} == {expected_value} -> {result}")
            return result

        elif "operator" in clause:
            # 중첩된 조건
            return self.evaluate_condition(clause, state)

        else:
            logger.warning(f"Unknown clause type: {clause}")
            return False

    def execute_rule(self, rule: Dict[str, Any], state: InterviewState) -> tuple[InterviewState, Optional[str]]:
        """규칙을 실행하고 상태를 업데이트합니다."""
        rule_name = rule.get("rule_name", "unknown")
        logger.info(f"Executing rule: {rule_name}")

        try:
            condition = rule.get("condition")
            if not condition:
                logger.error(f"Rule {rule_name} has no condition")
                return state, None

            condition_met = self.evaluate_condition(condition, state)
            logger.info(f"Rule {rule_name} condition result: {condition_met}")

            # 조건에 따른 액션 실행
            if condition_met:
                on_true = rule.get("on_true", {})
                state = self.execute_action(on_true, state)
                next_node = on_true.get("next_node")
            else:
                on_false = rule.get("on_false", {})
                state = self.execute_action(on_false, state)
                next_node = on_false.get("next_node")

            return state, next_node

        except Exception as e:
            logger.error(f"Error executing rule {rule_name}: {e}")
            return state, None

    def execute_action(self, action: Dict[str, Any], state: InterviewState) -> InterviewState:
        """액션을 실행하여 상태를 업데이트합니다."""
        set_state = action.get("set_state", {})

        for key, value in set_state.items():
            if key in state:
                state[key] = value
                logger.debug(f"Set state {key}: {value}")
            else:
                logger.warning(f"Unknown state key: {key}")

        return state

    def evaluate_A_overall(self, state: InterviewState) -> InterviewState:
        """A 기준 전체 평가: (A1 OR A2) AND A3"""
        try:
            # A1 또는 A2가 positive이고, A3가 positive면 A_overall은 positive
            a1_result = state["interview_results"].get("A1", {}).get("result")
            a2_result = state["interview_results"].get("A2", {}).get("result")
            a3_result = state["interview_results"].get("A3", {}).get("result")

            a1_or_a2_positive = (a1_result == "positive") or (a2_result == "positive")
            a3_positive = (a3_result == "positive")

            if a1_or_a2_positive and a3_positive:
                state["A_overall"] = "positive"
                result = "positive"
            else:
                state["A_overall"] = "negative"
                result = "negative"

            logger.info(f"A_overall evaluation: A1={a1_result}, A2={a2_result}, A3={a3_result} -> {result}")
            return state

        except Exception as e:
            logger.error(f"Error in A_overall evaluation: {e}")
            state["A_overall"] = "negative"
            return state

    def evaluate_B_overall(self, state: InterviewState) -> InterviewState:
        """B 기준 전체 평가: B1 AND B2"""
        try:
            b1_result = state["interview_results"].get("B1", {}).get("result")
            b2_result = state["interview_results"].get("B2", {}).get("result")

            if (b1_result == "positive") and (b2_result == "positive"):
                state["B_overall"] = "positive"
                result = "positive"
            else:
                state["B_overall"] = "negative"
                result = "negative"

            logger.info(f"B_overall evaluation: B1={b1_result}, B2={b2_result} -> {result}")
            return state

        except Exception as e:
            logger.error(f"Error in B_overall evaluation: {e}")
            state["B_overall"] = "negative"
            return state

    def evaluate_C_overall(self, state: InterviewState) -> InterviewState:
        """C 기준 전체 평가: C1 AND C2"""
        try:
            c1_result = state["interview_results"].get("C1", {}).get("result")
            c2_result = state["interview_results"].get("C2", {}).get("result")

            if (c1_result == "positive") and (c2_result == "positive"):
                state["C_overall"] = "positive"
                result = "positive"
            else:
                state["C_overall"] = "negative"
                result = "negative"

            logger.info(f"C_overall evaluation: C1={c1_result}, C2={c2_result} -> {result}")
            return state

        except Exception as e:
            logger.error(f"Error in C_overall evaluation: {e}")
            state["C_overall"] = "negative"
            return state

    def evaluate_D_overall(self, state: InterviewState) -> InterviewState:
        """D 기준 전체 평가: D1_duration OR D2_duration"""
        try:
            d1_duration_result = state["interview_results"].get("D1_duration", {}).get("result")
            d2_duration_result = state["interview_results"].get("D2_duration", {}).get("result")

            if (d1_duration_result == "positive") or (d2_duration_result == "positive"):
                state["D_overall"] = "positive"
                result = "positive"
            else:
                state["D_overall"] = "negative"
                result = "negative"

            logger.info(f"D_overall evaluation: D1_duration={d1_duration_result}, D2_duration={d2_duration_result} -> {result}")
            return state

        except Exception as e:
            logger.error(f"Error in D_overall evaluation: {e}")
            state["D_overall"] = "negative"
            return state

    def check_stop_rule(self, state: InterviewState) -> str:
        """조기 종료 규칙 확인: A, B, C가 모두 negative면 종료"""
        try:
            a_overall = state.get("A_overall")
            b_overall = state.get("B_overall")
            c_overall = state.get("C_overall")

            if (a_overall == "negative" and
                b_overall == "negative" and
                c_overall == "negative"):
                logger.info("Stop rule triggered: A, B, C all negative")
                return "end_interview_early"
            else:
                logger.info("Stop rule not triggered, continuing to D questions")
                return "D1"

        except Exception as e:
            logger.error(f"Error in stop rule: {e}")
            return "D1"  # 에러 시 계속 진행

    def final_diagnosis(self, state: InterviewState) -> str:
        """최종 진단 규칙"""
        try:
            a_overall = state.get("A_overall")
            b_overall = state.get("B_overall")
            c_overall = state.get("C_overall")
            d_overall = state.get("D_overall")

            # 히키코모리: A, B, C, D 모두 positive
            if (a_overall == "positive" and
                b_overall == "positive" and
                c_overall == "positive" and
                d_overall == "positive"):
                logger.info("Final diagnosis: Hikikomori (A+B+C+D)")
                return "end_as_hikikomori"

            # 사회적 고립: B, C, D positive
            elif (b_overall == "positive" and
                  c_overall == "positive" and
                  d_overall == "positive"):
                logger.info("Final diagnosis: Social Isolation (B+C+D)")
                return "end_as_social_isolation"

            # 기본: 조건 미충족
            else:
                logger.info("Final diagnosis: Default (criteria not met)")
                return "end_interview_default"

        except Exception as e:
            logger.error(f"Error in final diagnosis: {e}")
            return "end_interview_default"