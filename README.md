# Dabom 사회적 고립 인터뷰

Dabom은 폐쇄형 연구 참여자를 대상으로 구조화된 인터뷰를 진행하고, 연구자가 결과를 검토하는 애플리케이션입니다.

## 현재 상태

| 영역 | 상태 |
| --- | --- |
| 프론트엔드 | React/Vite + shadcn/ui, 로그인·계정 관리 API 연결 |
| 계정·인증 | FastAPI + PostgreSQL 서버 세션, React 연결 완료 |
| 인터뷰 백엔드 | FastAPI + LangGraph 무인증 프로토타입, 라이브 UI 연결 차단 |
| 영속성 | 계정·세션·audit는 PostgreSQL, 인터뷰는 프로세스 메모리와 gitignored JSON |

React는 기본적으로 실제 `/api/auth/*`와 `/api/admin/participants*`를 사용합니다. 2단계 로그인 잠금, 24시간 일반 세션, 30일 rolling·90일 상한 자동 로그인, CSRF·origin 검사와 참여자 계정 관리가 PostgreSQL에 연결되어 있습니다. 이전 인터뷰 endpoint는 아직 보호되지 않았으므로 라이브 UI에서 호출하지 않습니다.

## 로컬 준비

Python과 프론트엔드 의존성을 설치합니다.

```bash
uv sync
(cd frontend && npm install)
```

루트 `.env`에는 필요한 모델 API key와 인증 설정을 추가합니다. 기존 `.env`를 덮어쓰지 마세요. 로컬 PostgreSQL URL은 `dev.sh`가 Compose 설정과 동일한 값으로 주입합니다.

최초 관리자는 비밀번호를 터미널에서 두 번 입력해 생성합니다. 이 명령은 로컬 PostgreSQL을 시작하고 migration을 먼저 적용하므로 별도의 `DATABASE_URL` 설정이 필요하지 않습니다.

```bash
./dev.sh admin admin
```

비밀번호는 저장하거나 출력하지 않고 대화형 입력으로만 받습니다. 이미 관리자가 있으면 bootstrap 명령은 거부됩니다.

## 실행

로컬 PostgreSQL, migration, FastAPI와 React 개발 서버를 한 번에 실행합니다.

```bash
./dev.sh start
```

기본 포트는 FastAPI `8001`, Vite `5173`입니다. 사용 중이면 다음 빈 포트를 자동 선택하므로 터미널에 출력된 주소를 사용하세요. 시작이 끝나면 API와 프론트엔드 로그가 함께 표시됩니다. `Ctrl-C`는 로그 보기만 닫으며 서버는 계속 실행됩니다.

```bash
./dev.sh status                 # 실제 포트와 readiness 확인
./dev.sh debug                  # API·프론트엔드 로그 다시 보기
./dev.sh logs all               # 최근 로그만 출력
./dev.sh restart                # 재시작 후 로그 보기
./dev.sh stop                   # 앱과 DB 중지, DB volume 보존
```

자동화에서 로그를 계속 보지 않으려면 `./dev.sh start --detach`를 사용합니다. `run_web_app.sh`는 DB 준비 없이 FastAPI와 Vite만 실행하는 하위 수준 foreground runner입니다.

프론트엔드 개발 서버만 실행할 수도 있습니다. 기본값은 라이브 API이며 FastAPI가 함께 실행 중이어야 합니다.

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
- `VITE_APP_MODE`: 기본값 `live`; 격리된 UI 개발·테스트에서만 `mock` 사용
- `VITE_AUTH_CSRF_COOKIE`: `AUTH_CSRF_COOKIE`와 같은 값이어야 하는 프론트엔드 build 설정
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
bash tests/test_dev_script.sh
```

## 구조

- `backend/auth/`: 인증·관리자 service, repository, FastAPI dependency/router, 보안 정책, 운영 명령
- `backend/app_core/database.py`: PostgreSQL 전용 engine/session과 readiness
- `backend/migrations/`: Alembic migration
- `backend/api.py`: 새 인증 router와 기존 인터뷰 REST/SSE 프로토타입
- `backend/interview/`: LangGraph 인터뷰 엔진, 점수표, 도구, 프롬프트
- `frontend/src/app/`: 라이브 HTTP adapter, API 계약, 세션 상태, 역할 guard와 routing
- `frontend/src/mocks/`: 명시적 mock 모드와 테스트 전용 fixture
- `frontend/src/layouts/`, `pages/`, `features/`: 역할별 화면과 기능
- `interview_flow.json`: 질문 metadata

## 로그

`dev.sh start`와 `dev.sh debug`는 안전한 개발 프로세스 로그를 한 화면에서 보여줍니다.

- `logs/api.log`: Uvicorn/FastAPI와 HTTP access log
- `logs/frontend.log`: Vite 개발 서버 log
- `logs/dev.log`: launcher 출력
- PostgreSQL `audit_events`: 계정 생성·변경·잠금·해제 기록

이는 로컬 개발용 통합 조회이며 외부 중앙 로그 서비스는 아닙니다. 기존 `logs/interview_*.json`은 메시지와 모델 처리 내용을 포함할 수 있는 임시 레거시 기록이라 자동 표시하지 않습니다. 실제 연구 배포에서는 애플리케이션 표준 출력·오류를 CloudWatch Logs로 수집하고, 인증 감사 기록은 PostgreSQL에 유지하는 구성을 사용합니다.

## 연구 데이터 주의

기존 `/api/start`, `/api/message`, `/api/stream`, `/api/review`, `/api/sessions`, `/api/csv` 경로에는 아직 서버 권한·소유권 검사와 PostgreSQL 연구 데이터 저장이 없습니다. 라이브 React adapter는 이 경로를 호출하지 않고 인터뷰 화면에 연결 전 상태를 표시합니다. 보호된 인터뷰 API와 PostgreSQL 저장이 완료되기 전에는 실제 연구 데이터를 입력하지 마세요.

목표 구조와 남은 전환 기준은 [docs/architecture.md](docs/architecture.md), 제품·UI 원칙은 [PRODUCT.md](PRODUCT.md), 개발 규칙은 [AGENTS.md](AGENTS.md)를 참조하세요.
