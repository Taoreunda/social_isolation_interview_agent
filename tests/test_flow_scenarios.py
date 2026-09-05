"""Scenario-based checks for InterviewEngine (ReAct agent) without external deps."""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from interview.scorecard import Scorecard


async def scenario_scorecard_hikikomori():
    """Test scorecard calculate for hikikomori pathway."""
    sc = Scorecard()

    # Fill all items
    sc.record("A1", "positive", "예", "하루종일 집에 있음")
    sc.record("A2", "positive", "1", "주 1회 외출")
    sc.record("A3", "positive", "12", "12개월")
    sc.record("B1", "positive", "0", "유의미한 상호작용 0명")
    sc.record("B2", "positive", "6", "6개월")
    sc.record("C1", "positive", "0", "의지할 사람 0명")
    sc.record("C2", "positive", "6", "6개월")
    sc.record("D1", "positive", "7", "정서적 고통 7점")
    sc.record("D1_duration", "positive", "6", "6개월")
    sc.record("D2", "negative", "2", "기능 손상 2점")
    sc.record("E1", "recorded", "심리 상담 없음")
    sc.record("E2", "recorded", "신체 질환 없음")

    result = sc.calculate()

    assert sc.diagnosis == "히키코모리", f"Expected 히키코모리, got {sc.diagnosis}"
    assert sc.criteria["A"] is True
    assert sc.criteria["B"] is True
    assert sc.criteria["C"] is True
    assert sc.criteria["D"] is True
    assert "히키코모리" in result
    print("  ✅ scenario_scorecard_hikikomori")


async def scenario_scorecard_early_stop():
    """Test early stop when A, B, C all negative."""
    sc = Scorecard()

    sc.record("A1", "negative", "아니오")
    sc.record("A2", "negative", "7", "주 7회 외출")
    sc.record("A3", "negative", "2", "2개월")
    sc.record("B1", "negative", "3", "3명과 상호작용")
    sc.record("B2", "negative", "1", "1개월")
    sc.record("C1", "negative", "2", "2명 의지 가능")
    sc.record("C2", "negative", "1", "1개월")

    result = sc.calculate()

    assert sc.early_stop is True
    assert sc.diagnosis == "일반"
    assert "early_stop=true" in result

    # D/E should be skipped
    assert sc.next_unanswered() is None
    print("  ✅ scenario_scorecard_early_stop")


async def scenario_scorecard_social_isolation():
    """Test social isolation: B+C+D positive, A negative."""
    sc = Scorecard()

    sc.record("A1", "negative")
    sc.record("A2", "negative", "7")
    sc.record("A3", "negative", "2")
    sc.record("B1", "positive", "0")
    sc.record("B2", "positive", "4")
    sc.record("C1", "positive", "0")
    sc.record("C2", "positive", "4")
    sc.record("D1", "negative", "2")
    # D1_duration skipped (D1 is negative)
    sc.record("D2", "positive", "6")
    sc.record("D2_duration", "positive", "4")
    sc.record("E1", "recorded", "없음")
    sc.record("E2", "recorded", "없음")

    result = sc.calculate()

    assert sc.diagnosis == "사회적 고립", f"Expected 사회적 고립, got {sc.diagnosis}"
    assert sc.criteria["A"] is False
    assert sc.criteria["B"] is True
    assert sc.criteria["C"] is True
    assert sc.criteria["D"] is True
    print("  ✅ scenario_scorecard_social_isolation")


async def scenario_d_branching():
    """Test D section branching: D1 negative → skip D1_duration → D2."""
    sc = Scorecard()

    # Fill A/B/C
    for qid in ("A1", "A2", "A3", "B1", "B2", "C1", "C2"):
        sc.record(qid, "positive", "test")

    # D1 negative → D1_duration should be skipped
    sc.record("D1", "negative", "2")

    nxt = sc.next_unanswered()
    assert nxt == "D2", f"Expected D2 after D1=negative, got {nxt}"

    # D2 positive → D2_duration should be next
    sc.record("D2", "positive", "6")
    nxt = sc.next_unanswered()
    assert nxt == "D2_duration", f"Expected D2_duration after D2=positive, got {nxt}"

    print("  ✅ scenario_d_branching")


def run_scenarios():
    asyncio.run(scenario_scorecard_hikikomori())
    asyncio.run(scenario_scorecard_early_stop())
    asyncio.run(scenario_scorecard_social_isolation())
    asyncio.run(scenario_d_branching())
    print("\nAll scenarios passed!")


if __name__ == "__main__":
    run_scenarios()
