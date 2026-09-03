# 사회적 고립 인터뷰 에이전트

사회적 고립과 히키코모리 상태를 자동 분류하는 구조화된 인터뷰 웹앱입니다. **FastAPI 백엔드 + React 프론트엔드** 구조이며, 평가 로직은 LangGraph 2노드 ReAct 에이전트 + scorecard tool로 동작합니다. 대화형 인터뷰로 A/B/C/D 네 가지 준거를 수집해 응답자를 `일반` / `사회적 고립` / `히키코모리`로 판정합니다.

지원하는 웹 실행 경로는 `backend/api.py`와 `frontend/` 하나입니다.

## 빠른 시작

1. 의존성 설치
   ```bash
   uv sync                       # Python (백엔드)
   cd frontend && npm install    # Node (프론트엔드)
   ```
2. 환경설정: 프로젝트 루트에 `.env` 생성
   ```bash
   OPENAI_API_KEY=sk-...
   INTERVIEW_MODEL=openai:gpt-4.1-mini   # 선택, 기본값
   INTERVIEW_BASE_URL=...                # 선택, OpenAI 호환 엔드포인트
   INTERVIEW_API_KEY=...                 # 선택, 대체 제공자 API 키
   LANGSMITH_API_KEY=...                 # 선택 (트레이싱)
   LANGSMITH_TRACING=true                # 선택
   ```
3. 실행
   ```bash
   ./run_web_app.sh
   #   백엔드 기본값:  http://127.0.0.1:8001  (FastAPI, SSE 스트리밍)
   #   프론트 기본값:  http://127.0.0.1:5173  (Vite 개발 서버)
   ```

기본 포트가 사용 중이면 다음 빈 포트를 자동으로 선택합니다. 터미널에 출력된 실제 프론트엔드 주소 뒤에 `#user` 또는 `#reviewer`를 붙여 사용자·검사자 화면을 여세요.

## 구조

- `backend/` — 모든 Python 코드
  - `api.py` — FastAPI REST + SSE 엔드포인트
  - `interview/` — `engine.py`(2노드 ReAct agent), `scorecard.py`(평가표·진단 로직), `tools.py`, `prompts.py`
  - `app_core/config.py` — `.env` 기반 설정
  - `storage/json_storage.py` — 결과를 `data/`에 저장
  - `logs/interview_logger.py` — 구조화 로깅
- `frontend/` — React + Vite + TypeScript SPA (`UserView`=인터뷰, `ReviewerView`=검토 대시보드)
- `interview_flow.json` — 질문 정의 (루트, `scorecard.py`가 읽음)
- `data/`, `logs/` — 런타임 출력 (gitignored)

## 테스트

```bash
uv run python tests/test_scorecard.py        # 진단 로직 단위 테스트 (25개)
uv run python tests/test_flow_scenarios.py   # 시나리오 E2E
uv run python tests/test_api_persistence.py  # API 영속화
bash tests/test_run_web_app.sh               # 실행 스크립트 포트 선택
bash tests/test_vite_proxy.sh                # 동적 API 프록시
cd frontend && npm run build                 # TypeScript 검사 + 프로덕션 번들
```

기여 규칙과 변경 시 지켜야 할 계약은 [AGENTS.md](AGENTS.md)를 참고하세요.

> 현재 API에는 인증이 없고 CORS가 전체 허용입니다. 실제 면담 데이터는 신뢰된 로컬 네트워크 또는 인증된 역방향 프록시 뒤에서만 다루고, `data/`, `logs/`, LangSmith 추적 결과를 외부에 공유하지 마세요.
