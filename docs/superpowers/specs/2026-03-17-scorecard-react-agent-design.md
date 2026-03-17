# Scorecard ReAct Agent - Design Spec

## Overview

사회적 고립 인터뷰 에이전트를 기존 5노드 StateGraph에서 **ReAct agent + 평가표(scorecard)** 기반 아키텍처로 재구축한다.

### Goals

- 기존 질문/프롬프트/순서/조기종료/기준 로직 100% 유지
- 5노드 StateGraph → 2노드 ReAct agent로 단순화
- 평가표 스킬 문서가 채점표 + 평가 기준 + 진행 가이드 역할 통합
- 마지막에 교차 검토 1회 + 보고서 1문단 생성
- E1/E2 자유응답도 교차 검토에 활용
- 작은 모델에서도 동작하도록 tool 설계 단순화

### Non-Goals

- UI 변경 (채점표 우측 시각화는 에이전트 완성 후 별도 진행)
- 질문 텍스트/평가 기준 내용 변경
- 다국어 지원

---

## Architecture

### StateGraph: 2노드

```
START → llm_call ⇄ tool_node → END
```

- **llm_call**: Agent 추론 + tool call 결정. state에서 평가표를 읽어 context 구성.
- **tool_node**: scorecard tool 실행. 결과를 ToolMessage로 반환.
- **조건 분기**: tool_calls 있으면 → tool_node, 없으면 → END (사용자 응답 대기)

### State Schema

```python
class InterviewState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    scorecard: dict          # 평가표 전체 상태
    interview_complete: bool
    session_id: str
```

기존 17개 필드 → 4개. 나머지는 scorecard dict 안에 포함.

---

## Tool: scorecard

**1개 tool, 4개 action.** 작은 모델도 tool 하나만 기억하면 됨.

```python
@tool
def scorecard(action: str, question_id: str = None,
              status: str = None, value: str = None,
              rationale: str = None):
    """평가표 관리.
    action: record / update / clear / calculate
    """
```

### Actions

| action | 역할 | 언제 사용 |
|--------|------|----------|
| `record` | 질문 결과 기입 | 답변 평가 후 |
| `update` | 기존 결과 수정 | 교차 검토에서 모순 발견 시 |
| `clear` | 해당 항목 초기화 | 재질문 후 다시 받을 때 |
| `calculate` | 기준 판정 + 조기종료 + 최종 진단 | agent가 필요할 때 호출 |

### record / update 파라미터

- `question_id`: A1, A2, ..., E2
- `status`: "positive" / "negative"
- `value`: 추출된 값 (숫자, 기간, 텍스트 등)
- `rationale`: 판단 근거

### calculate 로직 (결정론적 코드)

```
A = (A1 or A2) and A3
B = B1 and B2
C = C1 and C2
D = (D1 and D1_duration) or (D2 and D2_duration)

조기종료: A, B, C 모두 False → 진단 = "일반"

최종 진단:
  A and B and C and D → "히키코모리"
  B and C and D       → "사회적 고립"
  else                → "일반"
```

### 반환값 (ToolMessage)

모든 action은 업데이트된 평가표 상태 + 다음 질문 정보를 반환:

```
"A3 기입 완료.
 ─────────
 현재 평가표:
 A1: positive (하루종일 방에 있음)
 A2: positive (주 2회)
 A3: positive (6개월)
 A 판정: 미산출 (calculate 필요)
 B1: 미평가 ← 다음 질문
 ...
 ─────────
 [B1 평가 기준]
 유의미한 상호작용 0명 → positive
 1명 이상 → negative
 (동거인/가족/온라인 전용 제외)"
```

---

## Scorecard 데이터 구조

```python
scorecard = {
    "items": {
        "A1": {
            "question": "하루 대부분 집에서 시간을 보냈습니까?",
            "criteria": "예→positive / 아니오→negative",
            "status": None,       # positive / negative / None
            "value": None,
            "rationale": None,
            "clarification_count": 0,
            "max_clarifications": 3
        },
        # ... A2, A3, B1, B2, C1, C2, D1, D1_duration, D2, D2_duration, E1, E2
    },
    "criteria": {
        "A": None, "B": None, "C": None, "D": None
    },
    "early_stop": False,
    "diagnosis": None,
    "report": None,
    "question_order": ["A1","A2","A3","B1","B2","C1","C2",
                        "D1","D1_duration","D2","D2_duration","E1","E2"]
}
```

- `items`는 `interview_flow.json`에서 질문 텍스트 로드
- `criteria`는 `calculate` action에서만 업데이트
- `E1`, `E2`는 `use_llm=False`, 자유 텍스트 기록

---

## Agent 흐름

### 기본 흐름 (결정론적 순서)

```
1. Agent가 평가표에서 다음 미평가 항목 확인
2. 해당 질문을 사용자에게 출력
3. 사용자 답변 수신
4. 평가 기준 참고해서 직접 판단
5. 모호하면 직접 재질문 (max 3회, 초과 시 negative)
6. 확정되면 scorecard(action="record", ...) 호출
7. ToolMessage로 업데이트된 평가표 수신
8. A,B,C 구간 끝나면 scorecard(action="calculate") 호출
9. 조기종료 조건 충족 시 인터뷰 종료
10. 전부 완료 시 교차 검토 → finalize
```

### 교차 검토 (마지막 1회)

- 전체 답변 간 일관성 체크 (E1/E2 포함)
- 모순 발견 시: `clear` → 재질문 → `record` (항목당 1개 질문만)
- 보고서 1문단 작성

### 조기종료

- A, B, C 기준 모두 negative → D, E 스킵 → 진단 "일반"
- 기존 로직 그대로 유지

---

## LLM Configuration

```python
from langchain.chat_models import init_chat_model

model = init_chat_model(
    get_config_value("INTERVIEW_MODEL", "openai:gpt-4.1-mini"),
    temperature=0.1
)
```

- 기본: `gpt-4.1-mini`
- 환경변수 또는 secrets.toml로 교체 가능
- `init_chat_model()`이 provider 자동 감지

---

## File Structure

```
interview/
├── engine.py              # StateGraph 2노드 (llm_call + tool_node)
├── scorecard.py           # Scorecard 데이터 + calculate 로직
├── tools.py               # scorecard tool (1개, 4 actions)
├── prompts.py             # 기존 프롬프트 재활용 (평가 기준 텍스트)
├── controller.py          # 삭제
├── state_manager.py       # 삭제 (scorecard.py로 통합)
├── flow_engine.py         # 삭제 (engine.py로 대체)
├── rule_engine.py         # 삭제 (이미 데드코드)
interview_flow.json        # 질문 텍스트 소스 (유지)
```

### 삭제 파일 (4개)

- `controller.py` — 라우팅/기준평가 → scorecard.py의 calculate로 대체
- `state_manager.py` — 상태관리 → InterviewState 4필드 + scorecard dict
- `flow_engine.py` — 5노드 엔진 → engine.py 2노드
- `rule_engine.py` — 이미 데드코드

### 유지 파일

- `interview_flow.json` — 질문 텍스트 소스
- `prompts.py` — 평가 기준 텍스트 (tool 반환값에 포함)

### 신규 파일 (3개)

- `engine.py` — 2노드 StateGraph
- `scorecard.py` — 평가표 데이터 + CRUD + calculate
- `tools.py` — scorecard tool 정의

---

## Pages (UI) 변경

### pages/chat.py

- `InterviewFlowEngineV2` → 신규 engine import
- `run_interview_step` 내부만 변경, UI 동작은 동일
- 채점표 우측 시각화는 추후 별도 작업

### pages/result.py

- `scorecard` dict에서 결과 추출하도록 수정
- 차트/통계 로직은 유지

---

## Testing Strategy

- 기존 `tests/test_flow_scenarios.py`의 시나리오를 새 엔진에 맞게 수정
- 히키코모리 / 사회적 고립 / 일반 / 조기종료 4가지 경로 검증
- 교차 검토 시 모순 발견 → clear → re-record 흐름 테스트
- calculate 로직 단위 테스트 (결정론적이므로 100% 커버 가능)

---

## Migration Plan

1. 신규 파일 작성 (engine.py, scorecard.py, tools.py)
2. pages/chat.py에서 신규 engine import
3. 기존 4파일 삭제
4. 테스트 실행 및 수정
5. (추후) 채점표 UI 시각화
