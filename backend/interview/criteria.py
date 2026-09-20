"""What makes each question positive or negative, as handed to the interviewer.

The text is part of the research instrument: change it deliberately, and keep
docs/interview-flow.md and the debug panel in step. tests/test_criteria_text.py
pins every word.
"""

from __future__ import annotations

QUESTION_CRITERIA: dict[str, str] = {
    'A1': (
        "평가 기준:\n"
        "- '예' 또는 이와 유사한 답변 → 'positive'\n"
        "- '아니오' 또는 이와 유사한 답변 → 'negative'\n"
        "- 모호하거나 불분명한 답변 → 'clarification_needed'\n"
        "답변이 모호할 경우, 구체적인 재질문을 생성하세요."
    ),
    'A2': (
        "평가 기준:\n"
        "- 주 4회 미만 외출 → 'positive'\n"
        "- 주 4회 이상 외출 → 'negative'\n"
        "- 숫자가 정말 명확하지 않은 경우에만 → 'clarification_needed'"
    ),
    'A3': (
        "평가 기준:\n"
        "- 6개월 이상 지속 → 'positive'\n"
        "- 6개월 미만 지속 → 'negative'\n"
        "- 기간이 명확하지 않은 경우 → 'clarification_needed'\n"
        "답변에서 정확한 기간(개월 단위)을 추출하세요. 모호할 경우 구체적인 기간을 묻는 재질문을 생성하세요."
    ),
    'B1': (
        "평가 기준:\n"
        "- 유의미한 상호작용 0명 → 'positive'\n"
        "- 유의미한 상호작용 1명 이상 → 'negative'\n"
        "- 숫자가 명확하지 않은 경우 → 'clarification_needed'\n"
        "주의사항:\n"
        "- 동거인, 가족 제외\n"
        "- 온라인만의 관계 제외\n"
        "- 점원, 의사 등 일방적 서비스 관계 제외\n"
        "- 단순 인사나 수업만 참여하는 관계 제외"
    ),
    'B2': (
        "판단 기준:\n"
        "- 3개월 이상 지속 → 'positive'\n"
        "- 3개월 미만 지속 → 'negative'\n"
        "- 기간이 모호하거나 추론에 의존하면 'clarification_needed'\n"
        "지침:\n"
        "- '1년'은 12개월, '90일'은 3개월 등으로 환산하여 extracted_months에 기록하세요.\n"
        "- 재질문이 필요하면 명확한 기간을 요청하는 문장을 제공하세요."
    ),
    'C1': (
        "판단 기준:\n"
        "- 의지할 사람이 0명 → 'positive'\n"
        "- 1명 이상 존재 → 'negative'\n"
        "- 명확한 수를 알 수 없으면 'clarification_needed'\n"
        "지침:\n"
        "- 동거인, 가족, 온라인 전용 관계는 제외하고 계산하세요.\n"
        "- 숫자가 아닌 표현을 사용했다면 0명 또는 1명 이상으로 해석하여 extracted_number에 기록하세요.\n"
        "- 모호하면 어떤 사람을 의지할 수 있는지 구체적으로 묻는 재질문을 제공하세요."
    ),
    'C2': (
        "판단 기준:\n"
        "- 3개월 이상 지속 → 'positive'\n"
        "- 3개월 미만 지속 → 'negative'\n"
        "- 기간이 모호하면 'clarification_needed'\n"
        "지침:\n"
        "- 답변을 월 단위로 환산하여 extracted_months와 extracted_value에 기록하세요.\n"
        "- 모호하면 정확한 기간을 묻는 재질문을 제시하세요."
    ),
    'D1': (
        "판단 기준:\n"
        "- 정서적 고통을 경험했다고 명시하거나 점수가 5 이상이면 'positive'\n"
        "- 고통이 없다고 하거나 점수가 4 이하이면 'negative'\n"
        "- 고통 여부나 점수가 모호하면 'clarification_needed'\n"
        "지침:\n"
        "- 점수를 언급한 경우 extracted_score와 extracted_value에 1~10 사이 정수를 기록합니다.\n"
        "- 점수 없이 고통을 언급하면 재질문에서 반드시 공감 표현과 함께 \"1에서 10까지\" 범위를 명시하며 점수를 요청하세요. (예: \"많이 힘드셨겠어요. 1에서 10 사이로 어느 정도인지 말씀해 주실 수 있을까요?\")\n"
        "- 고통이 없다고 명확히 말하면 0으로 간주하세요.\n"
        "- 재질문이 필요할 때는 공감적 표현으로 시작하고 보다 구체적인 답변을 유도하세요."
    ),
    'D1_duration': (
        "판단 기준:\n"
        "- 3개월 이상 지속 → 'positive'\n"
        "- 3개월 미만 지속 → 'negative'\n"
        "- 기간이 모호하면 'clarification_needed'"
    ),
    'D2': (
        "판단 기준:\n"
        "- 기능 손상 또는 영향이 있었다고 명시하거나 점수가 5 이상이면 'positive'\n"
        "- 영향이 없다고 말하거나 점수가 4 이하이면 'negative'\n"
        "- 답변에 점수가 없거나 기능 영향이 모호하면 'clarification_needed'\n"
        "지침:\n"
        "- 점수를 언급했으면 extracted_score와 extracted_value에 1~10 사이 정수를 기록하세요.\n"
        "- 기능 손상이 있다고만 말하고 점수를 주지 않으면 반드시 명확한 점수를 요청하세요.\n"
        "- 기능 손상이 없다고 명확히 말하면 0으로 간주하세요.\n"
        "- 모호하면 구체적인 영향을 묻는 재질문을 제공하세요."
    ),
    'D2_duration': (
        "판단 기준:\n"
        "- 3개월 이상 지속 → 'positive'\n"
        "- 3개월 미만 지속 → 'negative'\n"
        "- 모호하면 'clarification_needed'"
    ),
}

# E1 and E2 are written down as spoken; nothing about them is judged.
FREE_RESPONSE_CRITERIA = "자유 응답. status='recorded'로 기입."

__all__ = ["FREE_RESPONSE_CRITERIA", "QUESTION_CRITERIA"]
