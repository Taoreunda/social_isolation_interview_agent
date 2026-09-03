"""Centralized prompt templates for interview questions."""

from string import Template


COMMON_PROMPT = (
    "당신은 사회적 고립 평가 전문가입니다. 사용자의 답변을 평가해주세요.\n"
    "추가 지침:\n"
    "- clarification_question은 항상 짧은 공감 표현(예: '말씀해 주셔서 감사해요.', '괜찮으시다면')으로 시작하세요.\n"
    "- 추가 정보를 요청할 때는 부드럽고 따뜻한 어조를 유지하세요."
)


def build_prompt(body: str) -> str:
    """Attach the common header to each question prompt."""
    return f"{COMMON_PROMPT}\n\n{body}".strip()


def prompt_factory(body_template: str) -> callable:
    template = Template(body_template.strip())

    def builder(question_text: str) -> str:
        body = template.substitute(
            question_text=question_text,
            user_input="{user_input}",
        )
        return build_prompt(body)

    return builder


A1_PROMPT = prompt_factory(
    """질문: $question_text
사용자 답변: $user_input

평가 기준:
- '예' 또는 이와 유사한 답변 → 'positive'
- '아니오' 또는 이와 유사한 답변 → 'negative'
- 모호하거나 불분명한 답변 → 'clarification_needed'

답변이 모호할 경우, 구체적인 재질문을 생성하세요.

응답 형식 (JSON):
{{
  "status": "positive|negative|clarification_needed",
  "result": "A1_positive|A1_negative",
  "clarification_question": "재질문 내용 (필요시)"
}}
"""
)

A2_PROMPT = prompt_factory(
    """질문: 지난 1달 동안, 일주일에 평균적으로 몇 번 외출하였습니까? (분리수거·생필품 구매 제외)
사용자 답변: $user_input

중요 지침:
1. 사용자가 숫자를 언급하면 (예: '10번', '10회', '10', '평균 10번') 그것은 주당 외출 횟수입니다
2. '평균 X번'은 주당 X회 외출을 의미합니다
3. 숫자가 있으면 반드시 추출하여 4와 비교하세요

평가 기준:
- 주 4회 미만 외출 → 'positive'
- 주 4회 이상 외출 → 'negative'
- 숫자가 정말 명확하지 않은 경우에만 → 'clarification_needed'

예시:
- '10번' → 10회, negative
- '3번' → 3회, positive
- '평균 7번' → 7회, negative
- '잘 모르겠어요' → clarification_needed

응답 형식 (JSON):
{{
  "status": "positive|negative|clarification_needed",
  "result": "A2_positive|A2_negative",
  "extracted_number": 추출된숫자,
  "clarification_question": "재질문 내용 (필요시만)"
}}
"""
)

A3_PROMPT = prompt_factory(
    """질문: $question_text
사용자 답변: $user_input

평가 기준:
- 6개월 이상 지속 → 'positive'
- 6개월 미만 지속 → 'negative'
- 기간이 명확하지 않은 경우 → 'clarification_needed'

답변에서 정확한 기간(개월 단위)을 추출하세요. 모호할 경우 구체적인 기간을 묻는 재질문을 생성하세요.

응답 형식 (JSON):
{{
  "status": "positive|negative|clarification_needed",
  "result": "A3_positive|A3_negative",
  "extracted_months": "추출된 개월 수",
  "clarification_question": "재질문 내용 (필요시)"
}}
"""
)

B1_PROMPT = prompt_factory(
    """질문: $question_text
사용자 답변: $user_input

평가 기준:
- 유의미한 상호작용 0명 → 'positive'
- 유의미한 상호작용 1명 이상 → 'negative'
- 숫자가 명확하지 않은 경우 → 'clarification_needed'

주의사항:
- 동거인, 가족 제외
- 온라인만의 관계 제외
- 점원, 의사 등 일방적 서비스 관계 제외
- 단순 인사나 수업만 참여하는 관계 제외

응답 형식 (JSON):
{{
  "status": "positive|negative|clarification_needed",
  "result": "B1_positive|B1_negative",
  "extracted_number": "추출된 숫자",
  "clarification_question": "재질문 내용 (필요시)"
}}
"""
)

B2_PROMPT = prompt_factory(
    """질문: $question_text
사용자 답변: $user_input

판단 기준:
- 3개월 이상 지속 → 'positive'
- 3개월 미만 지속 → 'negative'
- 기간이 모호하거나 추론에 의존하면 'clarification_needed'

지침:
- '1년'은 12개월, '90일'은 3개월 등으로 환산하여 extracted_months에 기록하세요.
- 재질문이 필요하면 명확한 기간을 요청하는 문장을 제공하세요.

응답 형식 (JSON):
{{
  "status": "positive|negative|clarification_needed",
  "result": "B2_positive|B2_negative",
  "extracted_months": 환산된개월수또는null,
  "extracted_value": 환산된개월수또는null,
  "clarification_question": "재질문 내용 (필요시)"
}}
"""
)

C1_PROMPT = prompt_factory(
    """질문: $question_text
사용자 답변: $user_input

판단 기준:
- 의지할 사람이 0명 → 'positive'
- 1명 이상 존재 → 'negative'
- 명확한 수를 알 수 없으면 'clarification_needed'

지침:
- 동거인, 가족, 온라인 전용 관계는 제외하고 계산하세요.
- 숫자가 아닌 표현을 사용했다면 0명 또는 1명 이상으로 해석하여 extracted_number에 기록하세요.
- 모호하면 어떤 사람을 의지할 수 있는지 구체적으로 묻는 재질문을 제공하세요.

응답 형식 (JSON):
{{
  "status": "positive|negative|clarification_needed",
  "result": "C1_positive|C1_negative",
  "extracted_number": 의지할수있는사람수또는null,
  "extracted_value": 의지할수있는사람수또는null,
  "clarification_question": "재질문 내용 (필요시)"
}}
"""
)

C2_PROMPT = prompt_factory(
    """질문: $question_text
사용자 답변: $user_input

판단 기준:
- 3개월 이상 지속 → 'positive'
- 3개월 미만 지속 → 'negative'
- 기간이 모호하면 'clarification_needed'

지침:
- 답변을 월 단위로 환산하여 extracted_months와 extracted_value에 기록하세요.
- 모호하면 정확한 기간을 묻는 재질문을 제시하세요.

응답 형식 (JSON):
{{
  "status": "positive|negative|clarification_needed",
  "result": "C2_positive|C2_negative",
  "extracted_months": 환산된개월수또는null,
  "extracted_value": 환산된개월수또는null,
  "clarification_question": "재질문 내용 (필요시)"
}}
"""
)

D1_PROMPT = prompt_factory(
    """공감적이고 전문적인 어조로 응답해야 합니다.

질문: $question_text
사용자 답변: $user_input

판단 기준:
- 정서적 고통을 경험했다고 명시하거나 점수가 5 이상이면 'positive'
- 고통이 없다고 하거나 점수가 4 이하이면 'negative'
- 고통 여부나 점수가 모호하면 'clarification_needed'

지침:
- 점수를 언급한 경우 extracted_score와 extracted_value에 1~10 사이 정수를 기록합니다.
- 점수 없이 고통을 언급하면 재질문에서 반드시 공감 표현과 함께 "1에서 10까지" 범위를 명시하며 점수를 요청하세요. (예: "많이 힘드셨겠어요. 1에서 10 사이로 어느 정도인지 말씀해 주실 수 있을까요?")
- 고통이 없다고 명확히 말하면 0으로 간주하세요.
- 재질문이 필요할 때는 공감적 표현으로 시작하고 보다 구체적인 답변을 유도하세요.

응답 형식 (JSON):
{{
  "status": "positive|negative|clarification_needed",
  "result": "D1_positive|D1_negative",
  "extracted_score": 고통점수또는null,
  "extracted_value": 고통점수또는null,
  "clarification_question": "재질문 내용 (필요시)"
}}
"""
)

D1_DURATION_PROMPT = prompt_factory(
    """질문: $question_text
사용자 답변: $user_input

판단 기준:
- 3개월 이상 지속 → 'positive'
- 3개월 미만 지속 → 'negative'
- 기간이 모호하면 'clarification_needed'

응답 형식 (JSON):
{{
  "status": "positive|negative|clarification_needed",
  "result": "D1_duration_positive|D1_duration_negative",
  "extracted_months": 환산된개월수또는null,
  "extracted_value": 환산된개월수또는null,
  "clarification_question": "재질문 내용 (필요시)"
}}
"""
)

D2_PROMPT = prompt_factory(
    """질문: $question_text
사용자 답변: $user_input

판단 기준:
- 기능 손상 또는 영향이 있었다고 명시하거나 점수가 5 이상이면 'positive'
- 영향이 없다고 말하거나 점수가 4 이하이면 'negative'
- 답변에 점수가 없거나 기능 영향이 모호하면 'clarification_needed'

지침:
- 점수를 언급했으면 extracted_score와 extracted_value에 1~10 사이 정수를 기록하세요.
- 기능 손상이 있다고만 말하고 점수를 주지 않으면 반드시 명확한 점수를 요청하세요.
- 기능 손상이 없다고 명확히 말하면 0으로 간주하세요.
- 모호하면 구체적인 영향을 묻는 재질문을 제공하세요.

응답 형식 (JSON):
{{
  "status": "positive|negative|clarification_needed",
  "result": "D2_positive|D2_negative",
  "extracted_score": 기능손상점수또는null,
  "extracted_value": 기능손상점수또는null,
  "clarification_question": "재질문 내용 (필요시)"
}}
"""
)

D2_DURATION_PROMPT = prompt_factory(
    """질문: $question_text
사용자 답변: $user_input

판단 기준:
- 3개월 이상 지속 → 'positive'
- 3개월 미만 지속 → 'negative'
- 모호하면 'clarification_needed'

응답 형식 (JSON):
{{
  "status": "positive|negative|clarification_needed",
  "result": "D2_duration_positive|D2_duration_negative",
  "extracted_months": 환산된개월수또는null,
  "extracted_value": 환산된개월수또는null,
  "clarification_question": "재질문 내용 (필요시)"
}}
"""
)

PROMPT_TEMPLATES = {
    "A1": A1_PROMPT,
    "A2": A2_PROMPT,
    "A3": A3_PROMPT,
    "B1": B1_PROMPT,
    "B2": B2_PROMPT,
    "C1": C1_PROMPT,
    "C2": C2_PROMPT,
    "D1": D1_PROMPT,
    "D1_duration": D1_DURATION_PROMPT,
    "D2": D2_PROMPT,
    "D2_duration": D2_DURATION_PROMPT,
}
