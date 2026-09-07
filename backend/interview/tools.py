"""Scorecard tool for LangGraph ReAct agent."""

from __future__ import annotations

from typing import Optional

from langchain_core.tools import tool

from .scorecard import Scorecard


def execute_scorecard_action(
    sc: Scorecard,
    action: str,
    question_id: Optional[str] = None,
    status: Optional[str] = None,
    value: Optional[str] = None,
    rationale: Optional[str] = None,
) -> str:
    """Execute scorecard action on a Scorecard instance. Returns result text."""
    if action == "record":
        if not question_id or not status:
            return "오류: record에는 question_id와 status가 필요합니다."
        open_question = sc.next_unanswered()
        if open_question is not None and question_id != open_question:
            return (
                f"오류: '{question_id}'은 아직 참여자에게 묻지 않은 문항입니다. "
                f"현재 열린 문항은 '{open_question}'입니다. "
                "묻지 않은 문항은 기입할 수 없습니다."
            )
        return sc.record(question_id, status, value, rationale)

    elif action == "update":
        if not question_id or not status:
            return "오류: update에는 question_id와 status가 필요합니다."
        item = sc.items.get(question_id)
        if item is None:
            return f"오류: 알 수 없는 질문 ID '{question_id}'."
        if item["status"] is None:
            return (
                f"오류: '{question_id}'은 기입된 적이 없어 수정할 수 없습니다. "
                "질문 순서에 따라 record를 사용하세요."
            )
        return sc.update(question_id, status, value, rationale)

    elif action == "clear":
        if not question_id:
            return "오류: clear에는 question_id가 필요합니다."
        return sc.clear(question_id)

    elif action == "calculate":
        return sc.calculate()

    else:
        return f"오류: 알 수 없는 action '{action}'. record/update/clear/calculate 중 하나를 사용하세요."


@tool
def scorecard_tool(
    action: str,
    question_id: Optional[str] = None,
    status: Optional[str] = None,
    value: Optional[str] = None,
    rationale: Optional[str] = None,
) -> str:
    """평가표 관리 도구.

    action: record / update / clear / calculate
    - record: 질문 결과 기입 (question_id, status, value, rationale 필요)
    - update: 기존 결과 수정 (교차 검토에서 사용)
    - clear: 해당 항목 초기화 (재질문 후 다시 받을 때)
    - calculate: 기준 판정 + 조기종료 + 최종 진단
    """
    # This function body is never actually called — the custom tool_node
    # in engine.py intercepts tool calls and uses execute_scorecard_action.
    # This @tool definition exists only for LLM schema binding (bind_tools).
    return "오류: tool은 engine의 커스텀 tool_node를 통해 실행되어야 합니다."
