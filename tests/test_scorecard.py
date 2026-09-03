"""Scorecard calculate 단위 테스트."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from interview.scorecard import Scorecard, calculate_with_overrides


def make_scorecard(**statuses) -> Scorecard:
    """Helper: create a Scorecard and fill in given statuses."""
    sc = Scorecard()
    for qid, status in statuses.items():
        if isinstance(status, tuple):
            sc.items[qid]["status"] = status[0]
            sc.items[qid]["value"] = status[1]
        else:
            sc.items[qid]["status"] = status
    return sc


# ------------------------------------------------------------------
# calculate 4 pathways
# ------------------------------------------------------------------


def test_hikikomori():
    """A+B+C+D all positive → 히키코모리."""
    sc = make_scorecard(
        A1="positive", A2="positive", A3="positive",
        B1="positive", B2="positive",
        C1="positive", C2="positive",
        D1="positive", D1_duration="positive",
        D2="negative",
        E1="recorded", E2="recorded",
    )
    result = sc.calculate()
    assert sc.diagnosis == "히키코모리", f"Expected 히키코모리, got {sc.diagnosis}"
    assert sc.criteria["A"] is True
    assert sc.criteria["B"] is True
    assert sc.criteria["C"] is True
    assert sc.criteria["D"] is True
    assert sc.early_stop is False
    assert "히키코모리" in result


def test_social_isolation():
    """B+C+D positive, A negative → 사회적 고립."""
    sc = make_scorecard(
        A1="negative", A2="negative", A3="negative",
        B1="positive", B2="positive",
        C1="positive", C2="positive",
        D1="negative",
        D2="positive", D2_duration="positive",
        E1="recorded", E2="recorded",
    )
    result = sc.calculate()
    assert sc.diagnosis == "사회적 고립", f"Expected 사회적 고립, got {sc.diagnosis}"
    assert sc.criteria["A"] is False
    assert sc.criteria["D"] is True
    assert "사회적 고립" in result


def test_general():
    """Not all criteria met → 일반."""
    sc = make_scorecard(
        A1="positive", A2="positive", A3="positive",
        B1="positive", B2="positive",
        C1="negative", C2="negative",
        D1="negative",
        D2="negative",
        E1="recorded", E2="recorded",
    )
    result = sc.calculate()
    assert sc.diagnosis == "일반", f"Expected 일반, got {sc.diagnosis}"
    assert sc.criteria["C"] is False


def test_early_stop():
    """A, B, C all negative → early_stop + 일반."""
    sc = make_scorecard(
        A1="negative", A2="negative", A3="negative",
        B1="negative", B2="negative",
        C1="negative", C2="negative",
    )
    result = sc.calculate()
    assert sc.early_stop is True
    assert sc.diagnosis == "일반"
    assert "early_stop=true" in result


# ------------------------------------------------------------------
# D skip logic
# ------------------------------------------------------------------


def test_d1_negative_skips_d1_duration():
    """D1 negative → D1_duration stays None → D_path1=False."""
    sc = make_scorecard(
        A1="positive", A2="positive", A3="positive",
        B1="positive", B2="positive",
        C1="positive", C2="positive",
        D1="negative",
        D2="positive", D2_duration="positive",
        E1="recorded", E2="recorded",
    )
    sc.calculate()
    assert sc.items["D1_duration"]["status"] is None
    # D_path1 = False (D1 negative), D_path2 = True → D = True
    assert sc.criteria["D"] is True


def test_d1_negative_d2_negative():
    """Both D paths fail → D=False."""
    sc = make_scorecard(
        A1="positive", A2="positive", A3="positive",
        B1="positive", B2="positive",
        C1="positive", C2="positive",
        D1="negative",
        D2="negative",
        E1="recorded", E2="recorded",
    )
    sc.calculate()
    assert sc.criteria["D"] is False
    assert sc.diagnosis == "일반"


# ------------------------------------------------------------------
# next_unanswered with D skip
# ------------------------------------------------------------------


def test_next_unanswered_skips_d1_duration():
    """When D1=negative, next_unanswered should skip D1_duration → D2."""
    sc = make_scorecard(
        A1="positive", A2="positive", A3="positive",
        B1="positive", B2="positive",
        C1="positive", C2="positive",
        D1="negative",
    )
    nxt = sc.next_unanswered()
    assert nxt == "D2", f"Expected D2, got {nxt}"


def test_next_unanswered_skips_d2_duration():
    """When D2=negative, next_unanswered should skip D2_duration → E1."""
    sc = make_scorecard(
        A1="positive", A2="positive", A3="positive",
        B1="positive", B2="positive",
        C1="positive", C2="positive",
        D1="negative",
        D2="negative",
    )
    nxt = sc.next_unanswered()
    assert nxt == "E1", f"Expected E1, got {nxt}"


def test_next_unanswered_early_stop_skips_d_e():
    """After early stop, D/E questions should be skipped."""
    sc = make_scorecard(
        A1="negative", A2="negative", A3="negative",
        B1="negative", B2="negative",
        C1="negative", C2="negative",
    )
    sc.calculate()
    assert sc.early_stop is True
    nxt = sc.next_unanswered()
    assert nxt is None, f"Expected None after early stop, got {nxt}"


# ------------------------------------------------------------------
# CRUD operations
# ------------------------------------------------------------------


def test_record_basic():
    sc = Scorecard()
    result = sc.record("A1", "positive", "예", "사용자가 예라고 답변")
    assert "기입 완료" in result
    assert sc.items["A1"]["status"] == "positive"
    assert sc.items["A1"]["value"] == "예"


def test_record_duplicate_rejected():
    sc = Scorecard()
    sc.record("A1", "positive")
    result = sc.record("A1", "negative")
    assert "이미 기입됨" in result
    assert sc.items["A1"]["status"] == "positive"  # unchanged


def test_record_invalid_question_id():
    sc = Scorecard()
    result = sc.record("Z99", "positive")
    assert "오류" in result


def test_update():
    sc = Scorecard()
    sc.record("A1", "positive", "예")
    result = sc.update("A1", "negative", "아니오", "교차검토 수정")
    assert "수정 완료" in result
    assert sc.items["A1"]["status"] == "negative"


def test_clear():
    sc = Scorecard()
    sc.record("A1", "positive", "예")
    result = sc.clear("A1")
    assert "초기화 완료" in result
    assert sc.items["A1"]["status"] is None
    assert sc.items["A1"]["value"] is None


# ------------------------------------------------------------------
# Clarification count
# ------------------------------------------------------------------


def test_clarification_limit():
    sc = Scorecard()
    for _ in range(3):
        sc.increment_clarification("A1")
    result = sc.record("A1", "clarification_needed")
    assert "재질문 한도" in result
    assert sc.items["A1"]["status"] is None  # not recorded


def test_e_questions_exempt_from_clarification():
    sc = Scorecard()
    result = sc.record("E1", "recorded", "심리 상담 받은 적 없음")
    assert "기입 완료" in result
    assert sc.items["E1"]["status"] == "recorded"


# ------------------------------------------------------------------
# Serialization
# ------------------------------------------------------------------


def test_to_dict_from_dict_roundtrip():
    sc = make_scorecard(
        A1="positive", A2="negative", A3="positive",
    )
    d = sc.to_dict()
    sc2 = Scorecard.from_dict(d)
    assert sc2.items["A1"]["status"] == "positive"
    assert sc2.items["A2"]["status"] == "negative"
    assert sc2.items["A3"]["status"] == "positive"
    assert sc2.question_order == sc.question_order


def test_to_prompt_contains_items():
    sc = make_scorecard(A1="positive")
    prompt = sc.to_prompt()
    assert "A1: positive" in prompt
    assert "A2: 미평가" in prompt


# ------------------------------------------------------------------
# A criteria: (A1 OR A2) AND A3
# ------------------------------------------------------------------


def test_a_criteria_a1_only():
    """A1=pos, A2=neg, A3=pos → A=True (A1 alone satisfies OR)."""
    sc = make_scorecard(A1="positive", A2="negative", A3="positive")
    sc.calculate()
    assert sc.criteria["A"] is True


def test_a_criteria_a2_only():
    """A1=neg, A2=pos, A3=pos → A=True (A2 alone satisfies OR)."""
    sc = make_scorecard(A1="negative", A2="positive", A3="positive")
    sc.calculate()
    assert sc.criteria["A"] is True


def test_a_criteria_a3_negative():
    """A3=neg → A=False regardless of A1/A2."""
    sc = make_scorecard(A1="positive", A2="positive", A3="negative")
    sc.calculate()
    assert sc.criteria["A"] is False


# ------------------------------------------------------------------
# calculate_with_overrides
# ------------------------------------------------------------------


def test_overrides_no_change():
    """전문가가 동의만 한 경우 → 원본과 동일한 결과."""
    sc = make_scorecard(
        A1="positive", A2="positive", A3="positive",
        B1="positive", B2="positive",
        C1="positive", C2="positive",
        D1="positive", D1_duration="positive",
        D2="negative",
        E1="recorded", E2="recorded",
    )
    sc.calculate()
    result = calculate_with_overrides(sc.to_dict(), {})
    assert result["diagnosis"] == "히키코모리"
    assert result["criteria"]["A"] is True


def test_overrides_flip_to_social_isolation():
    """전문가가 A3를 negative로 변경 → 히키코모리에서 사회적 고립으로."""
    sc = make_scorecard(
        A1="positive", A2="positive", A3="positive",
        B1="positive", B2="positive",
        C1="positive", C2="positive",
        D1="positive", D1_duration="positive",
        D2="negative",
        E1="recorded", E2="recorded",
    )
    sc.calculate()
    assert sc.diagnosis == "히키코모리"

    expert_reviews = {"A3": {"expert_status": "negative"}}
    result = calculate_with_overrides(sc.to_dict(), expert_reviews)
    assert result["criteria"]["A"] is False
    assert result["diagnosis"] == "사회적 고립"


def test_overrides_flip_to_general():
    """전문가가 B1을 negative로 변경 → 사회적 고립에서 일반으로."""
    sc = make_scorecard(
        A1="negative", A2="negative", A3="negative",
        B1="positive", B2="positive",
        C1="positive", C2="positive",
        D1="positive", D1_duration="positive",
        D2="negative",
        E1="recorded", E2="recorded",
    )
    sc.calculate()
    assert sc.diagnosis == "사회적 고립"

    expert_reviews = {"B1": {"expert_status": "negative"}}
    result = calculate_with_overrides(sc.to_dict(), expert_reviews)
    assert result["criteria"]["B"] is False
    assert result["diagnosis"] == "일반"


def test_overrides_early_stop():
    """전문가 변경으로 A/B/C 모두 비충족 → early_stop."""
    sc = make_scorecard(
        A1="positive", A2="negative", A3="positive",
        B1="negative", B2="negative",
        C1="negative", C2="negative",
    )
    sc.calculate()
    assert sc.criteria["A"] is True

    expert_reviews = {"A1": {"expert_status": "negative"}}
    result = calculate_with_overrides(sc.to_dict(), expert_reviews)
    assert result["criteria"]["A"] is False
    assert result["early_stop"] is True
    assert result["diagnosis"] == "일반"


def run_all():
    import inspect
    tests = [
        obj for name, obj in globals().items()
        if name.startswith("test_") and inspect.isfunction(obj)
    ]
    for test_fn in tests:
        test_fn()
        print(f"  ✅ {test_fn.__name__}")
    print(f"\nAll {len(tests)} scorecard tests passed!")


if __name__ == "__main__":
    run_all()
