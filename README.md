# 고립 챗봇

고립 챗봇은 폐쇄형 연구 참가자가 13문항 사회적 고립 진단 인터뷰를 AI와 진행하고, 검토자와 관리자가 결과를 검토하는 웹 애플리케이션입니다. React/Vite UI, FastAPI, 2-node LangGraph 인터뷰 엔진, PostgreSQL로 구성됩니다. 코드와 DB의 내부 식별자는 `dabom`을 그대로 씁니다.

## 역할

| 역할 | 할 수 있는 일 |
| --- | --- |
| 참가자 | 본인 인터뷰 시작·재개, 비밀번호 변경 |
| 검토자 | 인터뷰 목록·대화·점수표 검토, 전문가 판정 기록, CSV 내려받기 |
| 관리자 | 검토자가 하는 모든 일, 참가자·검토자·관리자 계정 생성과 역할 부여, 인터뷰 보관, 테스트용 인터뷰 진행과 디버깅 모드 |

계정은 관리자만 만듭니다. 공개 가입은 없습니다. 첫 관리자만 화면 밖에서 만들고(아래 「로컬 실행」), 그 뒤의 모든 계정은 관리자가 「계정 관리」 화면에서 만듭니다.

## 인터뷰

- 13문항(A1–A3, B1–B2, C1–C2, D1–D2와 기간, E1–E2)을 정해진 순서로 묻고, 문항마다 cut-off로 True/False를 판정해 히키코모리·사회적 고립·일반을 나눕니다. 문항·기준·흐름은 [docs/interview-flow.md](docs/interview-flow.md)에 있습니다.
- 참가자에게 보이는 질문 문장은 항상 정해진 문항 텍스트이며 모델의 자유 생성문이 아닙니다.
- 인사말 두 개 뒤에 첫 질문이 이어지고, 문항마다 탭해서 보낼 수 있는 추천 답변을 입력창 위에 보여 줍니다. 답변이 추천을 탭한 것인지 직접 입력한 것인지는 저장되고 CSV의 `answerSource`에 나옵니다.
- 관리자는 `/interview`에서 참가자와 똑같은 화면으로 인터뷰를 진행해 볼 수 있고, 「디버깅」을 켜면 문항·기준·진단이 True/False 불빛으로 보이는 판정 흐름이 옆에 나옵니다. 참가자에게는 보이지 않습니다.
- 메시지·점수표·검토 결과는 PostgreSQL에 turn 단위로 저장합니다. 시스템 프롬프트, 도구 메시지, 비밀번호, 토큰은 저장하지 않습니다.

## 보안

역할·소유권 검사, 허용 origin, CSRF, opaque cookie 세션, 2단계 로그인 잠금. 세션 정책과 경계는 [docs/architecture.md](docs/architecture.md)에 있습니다.

## 로컬 실행

필수 도구는 Python 3.11+, `uv`, Node.js/npm, Docker입니다.

```bash
uv sync
(cd frontend && npm install)
./dev.sh admin admin
./dev.sh start
```

`./dev.sh admin admin`은 PostgreSQL을 준비하고 migration을 적용한 뒤 관리자 비밀번호를 터미널에서 두 번 입력받습니다. 관리자가 한 명도 없을 때만 동작하며 비밀번호를 출력하거나 저장하지 않습니다.

터미널에 들어가기 어려운 서버에서는 `.env`에 `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`를 넣고 서버를 시작해도 됩니다. 관리자가 한 명도 없을 때만 읽어 계정을 만들고, 그 뒤에는 값을 무시하므로 화면에서 바꾼 비밀번호를 되돌리지 않습니다. 로그인해 비밀번호를 바꾼 다음 두 줄을 지우세요. 나머지 관리자·검토자·참가자는 첫 관리자가 「계정 관리」에서 만듭니다.

`./dev.sh start`는 PostgreSQL 16, FastAPI, Vite를 시작하고 migration을 적용합니다. 기본 포트 `8001`과 `5173`이 사용 중이면 다음 빈 포트를 선택하며, 실제 주소를 터미널에 표시합니다. `Ctrl-C`는 로그 보기만 닫습니다. 로컬 실행에 관한 것은 DB 준비부터 중지까지 모두 이 스크립트 하나가 맡습니다.

```bash
./dev.sh status
./dev.sh debug
./dev.sh logs all
./dev.sh restart --detach
./dev.sh stop
```

Docker Desktop이 꺼져 있으면 `Cannot connect to the Docker daemon`으로 멈춥니다. 먼저 Docker를 켜세요.

## 환경변수

루트 `.env`를 사용하며 비밀값은 커밋하지 않습니다.

- `DATABASE_URL`: 필수 PostgreSQL/psycopg 3 URL
- `OPENAI_API_KEY`: 기본 인터뷰 모델 인증값
- `INTERVIEW_MODEL`: 기본값 `openai:gpt-4.1-mini`
- `INTERVIEW_BASE_URL`, `INTERVIEW_API_KEY`: 선택적 OpenAI 호환 제공자
- `AUTH_ALLOWED_ORIGINS`: 브라우저 애플리케이션 origin 목록
- `AUTH_SESSION_COOKIE`, `AUTH_CSRF_COOKIE`: 인증 cookie 이름
- `AUTH_COOKIE_SECURE`: HTTPS 배포에서 `true`
- `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`: 첫 관리자를 서버 시작 시 만들 때만; 관리자가 생기면 무시
- `VITE_APP_MODE`: 기본 `live`; 격리된 UI 작업에서만 `mock`
- `VITE_AUTH_CSRF_COOKIE`: 백엔드 CSRF cookie 이름과 동일하게 설정
- `LANGSMITH_*`: 선택적 추적 설정; 실제 연구 데이터에는 승인 후 사용

## 주요 API

모든 API는 서버 세션과 역할 검사를 거칩니다. POST 요청은 허용 origin과 CSRF도 요구합니다.

인증(모든 역할):

- `POST /api/auth/login`, `GET /api/auth/me`
- `POST /api/auth/logout`, `POST /api/auth/password`

인터뷰(참가자, 관리자):

- `GET /api/interviews/current`, `POST /api/interviews`
- `POST /api/interviews/{id}/messages`

검토(검토자, 관리자):

- `GET /api/admin/interviews`, `GET /api/admin/interviews/{id}`
- `POST /api/admin/interviews/{id}/scorecard/{questionId}`
- `POST /api/admin/interviews/csv`, `POST /api/admin/interviews/{id}/csv`

관리자 전용:

- `POST /api/admin/interviews/{id}/archive`
- `GET|POST /api/admin/participants`, `POST /api/admin/participants/{id}/password|disable|enable|unlock`
- `GET|POST /api/admin/staff`, `POST /api/admin/staff/{id}/role|password|disable|enable|unlock`

상태: `GET /api/health`(프로세스), `GET /api/ready`(PostgreSQL 포함)

참가자 응답에는 공개 대화, 진행 상태, 추천 답변만 포함됩니다. 검토·관리자 상세 응답에는 참가자 코드, 대화, 점수표, AI 근거와 전문가 검토에 더해 진단, 기준 충족 여부, 요약, 알고리즘 버전과 완료 시각이 포함됩니다. 참가자는 이 중 어느 것도 볼 수 없습니다.

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

구조와 보안 경계는 [docs/architecture.md](docs/architecture.md), 문항과 판정 기준은 [docs/interview-flow.md](docs/interview-flow.md), 제품/UI 원칙은 [PRODUCT.md](PRODUCT.md), 개발 규칙은 [AGENTS.md](AGENTS.md)를 참조하세요.
