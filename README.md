# Dabom 사회적 고립 인터뷰

Dabom은 폐쇄형 연구 참여자가 AI 인터뷰를 진행하고 연구 관리자가 결과를 검토하는 웹 애플리케이션입니다. React/Vite UI, FastAPI, 기존 2-node LangGraph 인터뷰 엔진, PostgreSQL로 구성됩니다.

## 구현 상태

- 참여자: 로그인, 24시간/자동 로그인 세션, 비밀번호 변경, 본인 인터뷰 시작·재개
- 관리자: 참여자 계정 생성·비활성화·비밀번호 재설정·잠금 해제, 인터뷰 목록·점수표 검토·CSV
- 인터뷰: 메시지·점수표·검토 결과를 PostgreSQL에 turn 단위로 저장
- 보안: 역할·소유권 검사, 허용 origin, CSRF, opaque cookie 세션, 2단계 로그인 잠금
- UI: React + shadcn/ui, 참여자/관리자 route 분리, 세 가지 기본 색상

옛 무인증 `/api/start`, `/api/message`, `/api/stream`, `/api/sessions`, `/api/review`, `/api/csv` API와 메모리/JSON 저장 경로는 제거되었습니다.

## 로컬 실행

필수 도구는 Python 3.11+, `uv`, Node.js/npm, Docker입니다.

```bash
uv sync
(cd frontend && npm install)
./dev.sh admin admin
./dev.sh start
```

`./dev.sh admin admin`은 PostgreSQL을 준비하고 migration을 적용한 뒤 관리자 비밀번호를 터미널에서 두 번 입력받습니다. 최초 관리자만 생성할 수 있으며 비밀번호를 출력하거나 저장하지 않습니다.

터미널에 들어가기 어려운 서버에서는 `.env`에 `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`를 넣고 서버를 시작해도 됩니다. 관리자가 한 명도 없을 때만 읽어 계정을 만들고, 그 뒤에는 값을 무시하므로 화면에서 바꾼 비밀번호를 되돌리지 않습니다. 로그인해 비밀번호를 바꾼 다음 두 줄을 지우세요. 나머지 관리자·검토자·참가자는 첫 관리자가 「계정 관리」에서 만듭니다.

`./dev.sh start`는 PostgreSQL 16, FastAPI, Vite를 시작하고 migration을 적용합니다. 기본 포트 `8001`과 `5173`이 사용 중이면 다음 빈 포트를 선택하며, 실제 주소를 터미널에 표시합니다. `Ctrl-C`는 로그 보기만 닫습니다.

```bash
./dev.sh status
./dev.sh debug
./dev.sh logs all
./dev.sh restart --detach
./dev.sh stop
```

로컬 실행은 `dev.sh` 하나로 합니다. DB 준비, migration, 포트 선택, API와 Vite 실행, 중지까지 모두 이 스크립트가 맡습니다.

## 환경변수

루트 `.env`를 사용하며 비밀값은 커밋하지 않습니다.

- `DATABASE_URL`: 필수 PostgreSQL/psycopg 3 URL
- `OPENAI_API_KEY`: 기본 인터뷰 모델 인증값
- `INTERVIEW_MODEL`: 기본값 `openai:gpt-4.1-mini`
- `INTERVIEW_BASE_URL`, `INTERVIEW_API_KEY`: 선택적 OpenAI 호환 제공자
- `AUTH_ALLOWED_ORIGINS`: 브라우저 애플리케이션 origin 목록
- `AUTH_SESSION_COOKIE`, `AUTH_CSRF_COOKIE`: 인증 cookie 이름
- `AUTH_COOKIE_SECURE`: HTTPS 배포에서 `true`
- `VITE_APP_MODE`: 기본 `live`; 격리된 UI 작업에서만 `mock`
- `VITE_AUTH_CSRF_COOKIE`: 백엔드 CSRF cookie 이름과 동일하게 설정
- `LANGSMITH_*`: 선택적 추적 설정; 실제 연구 데이터에는 승인 후 사용

## 주요 API

모든 인터뷰 API는 서버 세션과 역할 검사를 거칩니다. POST 요청은 허용 origin과 CSRF도 요구합니다.

- `POST /api/auth/login`, `GET /api/auth/me`
- `POST /api/auth/logout`, `POST /api/auth/password`
- `GET|POST /api/admin/participants`
- `POST /api/admin/participants/{id}/password|disable|unlock`
- `GET /api/interviews/current`, `POST /api/interviews`
- `POST /api/interviews/{id}/messages`
- `GET /api/admin/interviews`, `GET /api/admin/interviews/{id}`
- `POST /api/admin/interviews/{id}/scorecard/{questionId}`
- `POST /api/admin/interviews/{id}/archive`
- `POST /api/admin/interviews/csv`, `POST /api/admin/interviews/{id}/csv`
- `GET /api/health`, `GET /api/ready`

참여자 응답에는 공개 대화와 진행 상태만 포함됩니다. 관리자 상세 응답에는 참여자 코드, 대화, 점수표, AI 근거와 전문가 검토에 더해 진단, 기준 충족 여부, 요약, 알고리즘 버전과 완료 시각이 포함됩니다. 참여자는 이 중 어느 것도 볼 수 없습니다.

## 검증

PostgreSQL test service를 켠 뒤 전체 검증을 실행합니다.

```bash
docker compose --profile test up -d db-test
uv run pytest -q
uv run python tests/test_flow_scenarios.py
(cd frontend && npm test && npm run check:palette && npm run build)
bash tests/test_vite_proxy.sh
bash tests/test_dev_script.sh
bash tests/test_deploy_script.sh
docker compose --profile test stop db-test
```

모델 호출은 자동 테스트에서 fake 경계로 대체되므로 API key나 외부 네트워크가 필요하지 않습니다.

## 배포 기준

초기 연구 규모는 약 200–300명이며 작은 단일 EC2 애플리케이션과 private Single-AZ RDS for PostgreSQL 구성을 전제로 합니다. RDS 암호화·backup·삭제 방지, private subnet, 최소 권한 security group, Secrets Manager/Parameter Store, HTTPS와 `Secure` cookie를 사용합니다.

테스트 단계의 서버 구성은 `deploy/`에 있습니다. EC2 한 대에서 Caddy·FastAPI·PostgreSQL을 Docker Compose로 띄우고, 로컬에서 `./deploy/deploy.sh` 한 줄로 GitHub `main`을 배포합니다. 처음 세팅부터 HTTPS·RDS 전환까지의 순서는 [deploy/README.md](deploy/README.md)를 따르세요.

현재 겹치는 interview turn은 단일 FastAPI 프로세스의 application lock으로 거부합니다. 여러 API worker로 확장하기 전에는 PostgreSQL 또는 분산 turn lock으로 교체해야 합니다. 응답은 turn 완료 후 JSON으로 반환하며 token streaming은 현재 범위가 아닙니다.

구조와 보안 경계는 [docs/architecture.md](docs/architecture.md), 제품/UI 원칙은 [PRODUCT.md](PRODUCT.md), 개발 규칙은 [AGENTS.md](AGENTS.md)를 참조하세요.
