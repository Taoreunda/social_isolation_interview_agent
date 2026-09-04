# Dabom 사회적 고립 인터뷰

Dabom은 폐쇄형 연구 참여자를 대상으로 구조화된 인터뷰를 진행하고, 연구자가 결과를 검토하는 애플리케이션입니다.

## 현재 상태

| 영역 | 상태 |
| --- | --- |
| 프론트엔드 | React/Vite + shadcn/ui 참여자·관리자 목 UI |
| 계정·인증 | FastAPI + PostgreSQL 서버 세션 구현, 프론트엔드는 아직 미연결 |
| 인터뷰 백엔드 | FastAPI + LangGraph 무인증 프로토타입 |
| 영속성 | 계정·세션·audit는 PostgreSQL, 인터뷰는 프로세스 메모리와 gitignored JSON |

인증 API에는 2단계 로그인 잠금, 24시간 일반 세션, 30일 rolling·90일 상한 자동 로그인, CSRF·origin 검사, 참여자 계정 관리가 구현되어 있습니다. 화면의 로그인과 관리 기능은 여전히 `frontend/src/mocks/` fixture를 사용합니다.

## 로컬 준비

Python과 프론트엔드 의존성을 설치합니다.

```bash
uv sync
(cd frontend && npm install)
```

PostgreSQL 16을 실행하고 migration을 적용합니다.

```bash
docker compose up -d db
DATABASE_URL=postgresql+psycopg://dabom:dabom-local@127.0.0.1:54329/dabom uv run alembic upgrade head
```

루트 `.env`에 `.env.example`의 `DATABASE_URL`과 인증 설정을 추가합니다. 기존 `.env`와 API key를 덮어쓰지 마세요. 최초 관리자는 비밀번호를 터미널에서 두 번 입력해 생성합니다.

```bash
uv run python backend/manage.py bootstrap-admin --username <관리자_사용자명>
```

안전한 임시 비밀번호를 생성해 한 번만 출력하려면 `--generate-password`를 추가합니다. 이미 관리자가 있으면 bootstrap 명령은 거부됩니다.

## 실행

전체 개발 프로세스를 실행합니다.

```bash
./run_web_app.sh
```

기본 포트는 FastAPI `8001`, Vite `5173`입니다. 사용 중인 포트가 있으면 다음 빈 포트를 자동 선택하므로 터미널에 출력된 주소를 사용하세요. 이 스크립트는 PostgreSQL을 시작하거나 migration을 자동 적용하지 않습니다.

프론트엔드 목 UI만 실행할 수도 있습니다.

```bash
(cd frontend && npm run dev)
```

백엔드만 실행하려면 다음 명령을 사용합니다.

```bash
uv run python -m uvicorn api:app --app-dir backend --reload --host 127.0.0.1 --port 8001
```

- `GET /api/health`: 프로세스 liveness
- `GET /api/ready`: PostgreSQL 연결 readiness, 실패 시 `503`
- `/api/auth/*`: login, 현재 사용자, logout, 비밀번호 변경
- `/api/admin/participants*`: 관리자 전용 참여자 목록·생성·재설정·비활성화·잠금 해제

## 환경변수

- `DATABASE_URL`: 필수 PostgreSQL/psycopg 3 URL. SQLite는 거부함
- `AUTH_ALLOWED_ORIGINS`: 쉼표로 구분한 브라우저 애플리케이션 origin
- `AUTH_SESSION_COOKIE`, `AUTH_CSRF_COOKIE`: 인증 cookie 이름
- `AUTH_COOKIE_SECURE`: HTTPS 배포에서는 반드시 `true`
- `OPENAI_API_KEY`: 인터뷰 모델 인증
- `INTERVIEW_MODEL`: 기본값 `openai:gpt-4.1-mini`
- `INTERVIEW_BASE_URL`, `INTERVIEW_API_KEY`: 선택한 OpenAI 호환 제공자
- `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`: 선택적 추적

AWS에서는 private RDS endpoint와 검증된 TLS를 사용하는 `DATABASE_URL`을 주입합니다. 데이터베이스 자격 증명은 저장소나 AMI에 넣지 않습니다.

## 운영 명령

만료 또는 폐기 후 7일이 지난 인증 세션을 정리합니다.

```bash
uv run python backend/manage.py cleanup-sessions --retention-days 7
```

## 화면 경로

- `/login`
- `/interview`
- `/account/password`
- `/admin`
- `/admin/participants`
- `/admin/interviews/:interviewId`

## 검증

인증 테스트는 실제 PostgreSQL 16을 사용합니다.

```bash
docker compose --profile test up -d db-test
uv run pytest tests/test_database.py tests/test_auth_security.py tests/test_auth_service.py tests/test_auth_api.py tests/test_auth_cli.py -q
```

전체 기존 검증은 다음과 같습니다.

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

- `backend/auth/`: 인증·관리자 service, repository, FastAPI dependency/router, 보안 정책, 운영 명령
- `backend/app_core/database.py`: PostgreSQL 전용 engine/session과 readiness
- `backend/migrations/`: Alembic migration
- `backend/api.py`: 새 인증 router와 기존 인터뷰 REST/SSE 프로토타입
- `backend/interview/`: LangGraph 인터뷰 엔진, 점수표, 도구, 프롬프트
- `frontend/src/app/`: API 계약, 세션 상태, 역할 guard와 routing
- `frontend/src/mocks/`: 현재 UI fixture와 목 `AppApi`
- `frontend/src/layouts/`, `pages/`, `features/`: 역할별 화면과 기능
- `interview_flow.json`: 질문 metadata

## 연구 데이터 주의

인증 API가 추가됐지만 기존 `/api/start`, `/api/message`, `/api/stream`, `/api/review`, `/api/sessions`, `/api/csv` 경로에는 아직 서버 권한·소유권 검사와 PostgreSQL 연구 데이터 저장이 없습니다. React도 인증 API에 연결되지 않았습니다. 이 두 단계가 완료되기 전에는 실제 연구 데이터를 입력하지 마세요.

목표 구조와 남은 전환 기준은 [docs/architecture.md](docs/architecture.md), 제품·UI 원칙은 [PRODUCT.md](PRODUCT.md), 개발 규칙은 [AGENTS.md](AGENTS.md)를 참조하세요.
