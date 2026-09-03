# Dabom 사회적 고립 인터뷰

Dabom은 폐쇄형 연구 참여자를 대상으로 구조화된 인터뷰를 진행하고, 연구자가 결과를 검토하는 애플리케이션입니다.

## 현재 상태

| 영역 | 상태 |
| --- | --- |
| 프론트엔드 | React/Vite + shadcn/ui 기반 참여자·관리자 목 UI |
| 백엔드 | FastAPI + LangGraph 인터뷰 엔진 프로토타입 |
| 연동 | 목 UI는 현재 FastAPI를 호출하지 않음 |
| 영속성·인증 | PostgreSQL/RDS 기반으로 다음 단계에서 구현 |

현재 로그인, 자동 로그인, 비밀번호 변경, 참여자 관리 및 검토 화면은 UI 검증용 fixture로 동작합니다. 실제 계정, 서버 세션 또는 연구 데이터 저장 기능이 아닙니다.

## 실행

프로젝트 루트에서 설치합니다.

```bash
uv sync
(cd frontend && npm install)
```

전체 개발 프로세스를 실행합니다.

```bash
./run_web_app.sh
```

기본 포트는 FastAPI `8001`, Vite `5173`입니다. 사용 중인 포트가 있으면 다음 빈 포트를 자동으로 선택하므로 터미널에 출력된 주소를 사용하세요. `Ctrl-C`로 두 프로세스를 함께 종료합니다.

프론트엔드 목 UI만 실행할 수도 있습니다. 이 경우 API 키가 필요하지 않습니다.

```bash
(cd frontend && npm run dev)
```

백엔드만 실행하려면 다음 명령을 사용합니다.

```bash
uv run python -m uvicorn api:app --app-dir backend --reload --host 127.0.0.1 --port 8001
```

로그는 `logs/api.log`와 `logs/frontend.log`에 기록됩니다.

## 환경변수

실제 인터뷰 엔진을 호출할 때 루트 `.env`에 필요한 값만 설정합니다.

- `OPENAI_API_KEY`: 기본 OpenAI 모델 인증
- `INTERVIEW_MODEL`: 모델 이름, 기본값 `openai:gpt-4.1-mini`
- `INTERVIEW_BASE_URL`, `INTERVIEW_API_KEY`: 선택한 OpenAI 호환 제공자 설정
- `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`: 선택적 추적 설정

목 UI의 개발용 자격 증명은 문서나 화면에 노출하지 않습니다.

## 화면 경로

- `/login`: 로그인
- `/interview`: 참여자 인터뷰
- `/account/password`: 참여자 비밀번호 변경
- `/admin`: 관리자 인터뷰 목록
- `/admin/participants`: 참여자 계정 관리
- `/admin/interviews/:interviewId`: 관리자 인터뷰 검토

## 검증

프로젝트 루트에서 실행합니다.

```bash
(cd frontend && npm test)
(cd frontend && npm run check:palette)
(cd frontend && npm run build)
uv run python tests/test_scorecard.py
uv run python tests/test_flow_scenarios.py
uv run python tests/test_api_persistence.py
bash tests/test_run_web_app.sh
bash tests/test_vite_proxy.sh
```

## 구조

- `backend/api.py`: 현재 인증 없는 REST/SSE 프로토타입 API
- `backend/interview/`: LangGraph 인터뷰 엔진, 점수표, 도구, 프롬프트
- `frontend/src/app/`: API 계약, 세션 상태, 역할 가드와 라우팅
- `frontend/src/mocks/`: UI fixture와 목 `AppApi`
- `frontend/src/layouts/`, `pages/`, `features/`: 역할별 화면과 기능
- `frontend/src/components/ui/`: shadcn/ui 기반 공용 컴포넌트
- `interview_flow.json`: 질문 메타데이터
- `data/`, `logs/`: gitignored 로컬 런타임 데이터

목표 데이터 모델과 PostgreSQL/RDS 전환 기준은 [docs/architecture.md](docs/architecture.md), 제품·UI 원칙은 [PRODUCT.md](PRODUCT.md), 개발 규칙은 [AGENTS.md](AGENTS.md)를 참조하세요.

## 주의

현재 FastAPI에는 인증이 없고 모든 CORS origin을 허용합니다. 실제 연구 데이터는 입력하지 말고, `data/`, `logs/`, LangSmith 추적 결과를 외부에 공유하지 마세요.
