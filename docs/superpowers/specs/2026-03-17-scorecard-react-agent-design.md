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

- **llm_call**: Agent 추론 + tool call 결정. state에서 평가표를 읽어 system prompt에 동적 주입.
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

## System Prompt

`llm_call` 노드에서 매 턴 state["scorecard"]를 읽어 동적으로 생성:

```
당신은 사회적 고립 평가 면접관입니다.

## 역할
- 평가표의 미평가 항목을 순서대로 질문합니다.
- 사용자 답변을 평가 기준에 따라 판단하고, scorecard tool로 기입합니다.
- 모호한 답변에는 공감 표현과 함께 재질문합니다 (같은 항목 최대 3회).
- 3회 초과 시 status="negative"로 기입합니다.

## 프로토콜
1. 질문은 반드시 1개씩만 합니다.
2. 답변 평가 후 scorecard(action="record", ...) 호출합니다.
3. A3, B2, C2 기입 후 scorecard(action="calculate") 호출합니다.
4. calculate 결과 early_stop=true이면 종료 안내 후 대화를 마칩니다.
5. D1이 negative면 D1_duration을 건너뛰고 D2로 진행합니다.
6. 모든 항목 기입 완료 후 교차 검토를 수행합니다.
7. E1/E2는 status 없이 value만 기록합니다 (action="record", status="recorded").

## 교차 검토 프로토콜
- 전체 답변의 일관성을 확인합니다 (E1/E2 포함).
- 모순 예시: A1="하루종일 집에 있음" vs A2="주 5회 외출" → 불일치
- 모순 발견 시: scorecard(action="clear") → 재질문 1개 → scorecard(action="record")
- 항목당 재질문은 최대 1개입니다.
- 검토 완료 후 최종 calculate → 보고서 1문단 작성 후 종료합니다.

## 어조
- 존댓말 사용, 공감적이고 따뜻한 어조
- 재질문 시 짧은 공감 표현으로 시작 (예: "말씀해 주셔서 감사해요.")

## 현재 평가표
{scorecard_state}

## 현재 질문 평가 기준
{current_criteria}
```

`{scorecard_state}`와 `{current_criteria}`는 `llm_call` 노드에서 state["scorecard"]로부터 동적으로 조립.
기존 `prompts.py`의 평가 기준 텍스트는 `{current_criteria}` 영역에 해당 질문 것만 삽입.

---

## Tool: scorecard

**1개 tool, 4개 action.** 작은 모델도 tool 하나만 기억하면 됨.

### State 접근 패턴

Tool은 LangGraph의 `InjectedState`를 사용하여 graph state에 접근:

```python
from langgraph.prebuilt import InjectedState
from langchain_core.tools import tool
from typing import Annotated

@tool
def scorecard(action: str, question_id: str = None,
              status: str = None, value: str = None,
              rationale: str = None,
              state: Annotated[dict, InjectedState] = None):
    """평가표 관리.
    action: record / update / clear / calculate
    """
    sc = state["scorecard"]
    # ... sc 조작 후 반환
```

`InjectedState`는 LLM에게 노출되지 않고, graph가 자동으로 주입.

### Actions

| action | 역할 | 언제 사용 |
|--------|------|----------|
| `record` | 질문 결과 기입 | 답변 평가 후 |
| `update` | 기존 결과 수정 | 교차 검토에서 모순 발견 시 |
| `clear` | 해당 항목 초기화 | 재질문 후 다시 받을 때 |
| `calculate` | 기준 판정 + 조기종료 + 최종 진단 | A3/B2/C2/D구간 기입 후 |

### record / update 파라미터

- `question_id`: A1, A2, ..., E2
- `status`: "positive" / "negative" / "recorded" (E1/E2 자유 응답용)
- `value`: 추출된 값 (숫자, 기간, 텍스트 등)
- `rationale`: 판단 근거

### calculate 로직 (결정론적 코드)

```
A = (A1 or A2) and A3
B = B1 and B2
C = C1 and C2

# D: 스킵된 항목(None)은 False로 취급
D_path1 = D1 and D1_duration  (둘 다 not None이고 둘 다 positive)
D_path2 = D2 and D2_duration  (둘 다 not None이고 둘 다 positive)
D = D_path1 or D_path2
# D1이 negative → D1_duration은 None (스킵됨) → D_path1 = False

조기종료: A, B, C 모두 False → early_stop=true, 진단 = "일반"

최종 진단:
  A and B and C and D → "히키코모리"
  B and C and D       → "사회적 고립"
  else                → "일반"
```

`calculate` 반환 시 `interview_complete` 플래그도 설정:
- `early_stop=true` → `interview_complete=true`
- 최종 진단 확정 → `interview_complete=true`

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
            "status": None,       # positive / negative / recorded / None
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
    "question_order": []  # interview_flow.json에서 로드
}
```

- `items`는 `interview_flow.json`에서 질문 텍스트 + 평가 기준 로드
- `question_order`는 `interview_flow.json`에서 로드 (하드코딩 아님)
- `criteria`는 `calculate` action에서만 업데이트
- `E1`, `E2`는 `status="recorded"`, 자유 텍스트만 value에 기록

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
8. A3/B2/C2/D구간 기입 후 scorecard(action="calculate") 호출
9. calculate 결과에 early_stop=true 또는 diagnosis 확정 시 interview_complete=true
10. 전부 완료 시 교차 검토 → 보고서 작성 → 종료
```

### D 섹션 분기

```
D1 평가:
  positive → D1_duration 질문
  negative → D1_duration 스킵 → D2 질문

D2 평가:
  positive → D2_duration 질문
  negative → D2_duration 스킵 → calculate 호출
```

스킵된 항목은 status=None으로 남음. calculate에서 None은 False로 취급.

### 교차 검토 (마지막 1회)

모든 항목 기입 완료 후 agent가 수행:

1. 전체 평가표를 읽고 답변 간 일관성 확인
   - 예시: A1="하루종일 집" vs A2="주 5회 외출" → 모순
   - E1/E2 내용이 A-D 답변과 상충하는지 확인
   - 예시: E1="우울증 치료 중" 인데 D1="정서적 고통 없음" → 모순
2. 모순 발견 시:
   - `scorecard(action="clear", question_id="A1")` 호출
   - 사용자에게 재질문 1개 출력 → 응답 대기 (END)
   - 응답 수신 후 → `scorecard(action="record", ...)` 기입
   - 항목당 재질문은 최대 1개
3. 최종 `scorecard(action="calculate")` 호출
4. 보고서 1문단 작성 (scorecard["report"]에 저장)
5. 인터뷰 종료

### 조기종료

- A, B, C 기준 모두 negative → D, E 스킵 → 진단 "일반"
- `calculate` 반환값에 `early_stop=true` 포함
- Agent가 종료 안내 메시지 출력 후 대화 종료

---

## Error Handling

### LLM 실패

- Tool call 파라미터 오류 → tool 내부에서 검증, 에러 메시지를 ToolMessage로 반환. Agent가 재시도.
- LLM이 tool 호출 없이 텍스트만 출력 → 정상 동작 (사용자에게 질문/재질문). 다음 턴에서 tool 호출.
- 네트워크/타임아웃 → LangGraph 기본 에러 처리. Streamlit에서 사용자에게 안내.

### 무한 루프 방지

- Agent 최대 반복 횟수: 50턴 (질문 13개 × 재질문 3회 + 교차검토 여유)
- `llm_call` 노드에서 `state["messages"]` 길이 체크, 초과 시 강제 종료

### 재질문 초과

- clarification_count >= max_clarifications → record에서 거부, "재질문 한도 초과" 메시지 반환
- Agent가 status="negative"로 강제 기입

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
- `.env` 또는 `secrets.toml[env]`에서 `INTERVIEW_MODEL` 키로 교체 가능
- `init_chat_model()`이 provider 자동 감지
- **의존성 추가 필요**: `langchain-openai` (pyproject.toml)
- **API 키 추가 필요**: `OPENAI_API_KEY` (config에 추가)

---

## File Structure

```
interview/
├── engine.py              # StateGraph 2노드 (llm_call + tool_node)
├── scorecard.py           # Scorecard 데이터 + CRUD + calculate 로직
├── tools.py               # scorecard tool (1개, 4 actions)
├── prompts.py             # 평가 기준 텍스트 (기존 재활용, tool 반환값에 포함)
├── controller.py          # 삭제
├── state_manager.py       # 삭제 (scorecard.py로 통합)
├── flow_engine.py         # 삭제 (engine.py로 대체)
├── rule_engine.py         # 삭제 (이미 데드코드)
interview_flow.json        # 질문 텍스트 + 평가 기준 소스 (유지, rules 섹션은 무시)
```

**Note**: `interview_flow.json`의 `rules` 섹션은 새 아키텍처에서 무시됨. 권위 있는 기준 계산 로직은 `scorecard.py`의 `calculate` 함수에 있음.

### 삭제 파일 (4개)

- `controller.py` — 라우팅/기준평가 → scorecard.py의 calculate로 대체
- `state_manager.py` — 상태관리 → InterviewState 4필드 + scorecard dict
- `flow_engine.py` — 5노드 엔진 → engine.py 2노드
- `rule_engine.py` — 이미 데드코드

### 유지 파일

- `interview_flow.json` — 질문 텍스트 소스 (nodes 섹션만 사용)
- `prompts.py` — 평가 기준 텍스트 (tool 반환값의 criteria 영역에 포함)

### 신규 파일 (3개)

- `engine.py` — 2노드 StateGraph + system prompt 동적 생성
- `scorecard.py` — 평가표 데이터 + CRUD + calculate + 초기화 (JSON 로드)
- `tools.py` — scorecard tool 정의 (InjectedState로 state 접근)

---

## Storage Contract

### 저장 포맷 (JSON)

`interview_complete` 시 저장되는 페이로드:

```python
{
    "session_id": str,
    "final_diagnosis": str,           # "히키코모리" / "사회적 고립" / "일반"
    "criteria_results": {             # result.py 호환
        "A": bool, "B": bool, "C": bool, "D": bool
    },
    "question_results": {             # result.py 호환 (scorecard.items에서 변환)
        "A1": {"status": str, "extracted_value": str, "rationale": str, ...},
        ...
    },
    "conversation_history": [         # messages에서 변환
        {"role": str, "content": str, "timestamp": str},
        ...
    ],
    "report": str,                    # 교차 검토 후 작성된 1문단 보고서
    "total_clarifications": int,
    "conversation_length": int,
    "completed_at": str               # ISO timestamp
}
```

기존 `result.py`와 호환되는 포맷으로 변환하여 저장. `scorecard.items` → `question_results`, `state["messages"]` → `conversation_history`.

---

## Logging

기존 `InterviewLogger` 유지. 로깅 대상 변경:

- 기존: per-node state snapshots, LLM call/response pairs
- 신규: tool call events (action, params, result), agent turn summaries
- `logs/interview_<session_id>.json` 위치 유지

---

## Pages (UI) 변경

### pages/chat.py

- `InterviewFlowEngineV2` → 신규 engine import
- `run_interview_step` 내부만 변경, UI 동작은 동일
- 채점표 우측 시각화는 추후 별도 작업

### pages/result.py

- Storage Contract의 호환 포맷 덕분에 최소 변경
- `question_results` 구조가 동일하므로 차트/통계 로직 유지

---

## Dependencies

`pyproject.toml`에 추가:

```
langchain-openai >= 0.3.0
```

`config.py` 또는 `.env`에 추가:

```
OPENAI_API_KEY=sk-...
INTERVIEW_MODEL=openai:gpt-4.1-mini  # 선택, 기본값 있음
```

---

## Testing Strategy

- 기존 `tests/test_flow_scenarios.py`의 시나리오를 새 엔진에 맞게 수정
- 히키코모리 / 사회적 고립 / 일반 / 조기종료 4가지 경로 검증
- D 섹션 분기 테스트 (D1 negative → D1_duration 스킵)
- 교차 검토 시 모순 발견 → clear → re-record 흐름 테스트
- calculate 로직 단위 테스트 (결정론적이므로 100% 커버 가능)
- E1/E2 자유 응답 기록 테스트
- 에러 케이스: 무한 루프 방지, 재질문 초과, 잘못된 tool 파라미터

---

## Migration Plan

1. 의존성 추가 (`langchain-openai`, config 업데이트)
2. 신규 파일 작성 (scorecard.py → tools.py → engine.py 순)
3. pages/chat.py에서 신규 engine import
4. 테스트 실행 및 수정
5. 기존 4파일 삭제
6. (추후) 채점표 UI 시각화
