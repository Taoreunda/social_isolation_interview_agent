# 사회적 고립 인터뷰 에이전트

간단한 Streamlit 앱으로 사회적 고립 여부를 평가하는 인터뷰를 진행합니다. LangGraph가 질문 흐름을 제어하고 Gemini 2.5 Flash가 답변을 분석합니다.

## 빠른 시작
1. 의존성 설치: `uv sync`
2. 비밀 설정: `.streamlit/secrets.toml`을 만들고 `[admin]`(username/password)과 `[env]`(GOOGLE_API_KEY, LANGSMITH_* 등)를 채웁니다.
3. 앱 실행: `uv run streamlit run main.py`

## 주요 파일
- `main.py`: 안내 페이지와 그래프 구조 표시
- `pages/chat.py`: 인터뷰 진행 채팅 화면
- `pages/result.py`: 저장된 결과 분석 화면
- `interview/`: 질문 흐름, 상태 관리, LLM 호출 로직
- `storage/json_storage.py`: 결과를 `data/results/`에 저장

## 테스트
고려 중인 시나리오나 리팩터링 검증은 `tests/` 아래 스크립트로 실행합니다.
- 예: `uv run python tests/test_flow_scenarios.py`
