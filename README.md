# 사회적 고립 인터뷰 에이전트

Dabom은 구조화된 사회적 고립 인터뷰를 수행하고 연구자가 결과를 검토하는 FastAPI + React/Vite 애플리케이션입니다. 현재 지원하는 프론트엔드는 참여자와 관리자의 권한 및 경로를 분리한 기능성 목(mock)입니다.

## 설치와 실행

프로젝트 루트에서 의존성을 설치합니다.

```bash
uv sync
cd frontend && npm install
```

백엔드에서 실제 인터뷰 엔진을 사용할 때만 루트 `.env`에 `OPENAI_API_KEY`와 필요한 선택 설정을 추가합니다. 목 프론트엔드 자체에는 API 키가 필요하지 않습니다.

```bash
./run_web_app.sh
```

스크립트는 FastAPI 포트 8001과 Vite 포트 5173을 우선 사용하고, 사용 중이면 다음 빈 포트를 선택합니다. 터미널에 출력된 주소가 실제 접속 주소입니다. 로그는 `logs/api.log`와 `logs/frontend.log`에 기록됩니다.

서비스를 따로 실행할 수도 있습니다.

```bash
uv run python -m uvicorn api:app --app-dir backend --reload --host 127.0.0.1 --port 8001
cd frontend && npm run dev
```

## 프론트엔드 경로와 현재 경계

- `/login`: 로그인
- `/interview`: 참여자 인터뷰
- `/account/password`: 참여자 비밀번호 변경
- `/admin`: 관리자 인터뷰 목록
- `/admin/participants`: 참여자 계정 관리
- `/admin/interviews/:interviewId`: 관리자 인터뷰 검토

로그인과 브라우저 세션은 개발 중 UI 검증을 위한 fixture 기반 목 동작입니다. 실제 인증이 아니며, fixture 자격 증명은 문서나 화면에 표시하지 않습니다. 이 목 UI는 현재 인증 없는 FastAPI 백엔드를 의도적으로 호출하지 않습니다. PostgreSQL 기반 애플리케이션 인증과 API 연결은 [docs/architecture.md](docs/architecture.md)에 정의된 다음 구현 단계입니다.

## 검증

프론트엔드 검증은 `frontend/`에서 실행합니다.

```bash
npm test
npm run check:palette
npm run build
```

백엔드와 실행 스크립트 회귀 검증은 프로젝트 루트에서 실행합니다.

```bash
uv run python tests/test_scorecard.py
uv run python tests/test_flow_scenarios.py
uv run python tests/test_api_persistence.py
bash tests/test_run_web_app.sh
bash tests/test_vite_proxy.sh
```

## 구조

- `backend/api.py`: 현재 FastAPI REST/SSE 엔드포인트
- `backend/interview/`: LangGraph 인터뷰 엔진, scorecard, 도구, 프롬프트
- `backend/app_core/`: 설정과 저장소 경로
- `frontend/src/app/`: API 주입, 세션 상태, 역할 가드, 라우트 테스트
- `frontend/src/mocks/`: 격리된 UI fixture와 `AppApi` 목 구현
- `frontend/src/layouts/`: 참여자 및 관리자 셸
- `frontend/src/pages/`: 로그인, 인터뷰, 계정 관리, 검토 화면
- `frontend/src/features/`: 인터뷰와 관리자 기능 컴포넌트
- `frontend/src/components/ui/`: 공용 shadcn/ui 기반 컴포넌트
- `interview_flow.json`: 질문 메타데이터
- `data/`, `logs/`: gitignored 런타임 데이터

현재 FastAPI API에는 인증이 없고 모든 CORS origin을 허용합니다. 실제 인터뷰 데이터는 신뢰된 로컬 네트워크나 인증된 역방향 프록시 뒤에서만 다루고, `data/`, `logs/`, LangSmith 추적 결과를 외부에 공유하지 마세요.
