# Repository Guidelines

## Active Stack and Source Layout
The supported application is a FastAPI backend plus a React/Vite SPA. All Python code lives under `backend/`; `backend/api.py` exposes REST and SSE endpoints around the interview engine. The active UI lives under `frontend/src/`: `UserView.tsx` runs interviews, `ReviewerView.tsx` reviews saved sessions, and `api.ts` is the backend client. Do not add a second UI runtime.

Core orchestration is under `backend/interview/`. `engine.py` builds the 2-node LangGraph ReAct loop, `scorecard.py` owns scorecard state and deterministic diagnosis, `tools.py` exposes the single tool schema, and `prompts.py` owns evaluation criteria. Use constants from `backend/app_core/paths.py` instead of reconstructing repository paths.

## Change Contracts and Sources of Truth
A question change must keep three locations aligned: the question definition in `interview_flow.json`, `Scorecard._build_items()` ordering in `backend/interview/scorecard.py`, and the `SECTIONS` UI grouping in `backend/api.py`. Graph routing belongs in `backend/interview/engine.py`; `interview_flow.json` contains question metadata only.

Diagnosis changes must update both `Scorecard.calculate()` and `calculate_with_overrides()` and add regression coverage for AI and expert results. The decorated `scorecard_tool` body is schema-only; runtime behavior is implemented by `execute_scorecard_action()` and the custom `tool_node` in `engine.py`.

## Build, Test, and Development Commands
Install dependencies with `uv sync` and `cd frontend && npm install`. Start both services with `./run_web_app.sh`. It prefers FastAPI port 8001 and Vite port 5173, advances to the next free ports when needed, and prints the authoritative URLs. Logs go to `logs/api.log` and `logs/frontend.log`. Run services separately with:

```bash
uv run python -m uvicorn api:app --app-dir backend --reload --host 127.0.0.1 --port 8001
cd frontend && npm run dev
```

Run all deterministic checks from the repository root:

```bash
uv run python tests/test_scorecard.py
uv run python tests/test_flow_scenarios.py
uv run python tests/test_api_persistence.py
bash tests/test_run_web_app.sh
bash tests/test_vite_proxy.sh
cd frontend && npm run build
```

The Python and shell tests are executable scripts, not a pytest suite. They must not require an API key or external network access. The frontend has no lint or test script, so `npm run build` is the type-check and bundle gate.

## Coding and Testing Conventions
Follow PEP 8, four-space indentation, and type hints on public Python interfaces. Use `snake_case.py`, `CamelCase` classes, and upper snake constants such as `MAX_TURNS`. Prefer dependency injection over new module-level singletons. Frontend components use PascalCase and functions use camelCase. Keep changes narrow and preserve existing Korean domain terminology.

Put Python coverage in `tests/test_*.py`, mock the LLM and filesystem, and test observable contracts rather than prompt wording. For UI changes, verify loading, empty, error, active-interview, completed, and reviewer states; include a screenshot in the PR when layout changes.

## Persistence and Runtime Constraints
LangGraph checkpoints use in-process `MemorySaver`. Disk snapshots under `data/web_sessions/` restore reviewer and display state after a restart, while completed results live under `data/results/`; neither rehydrates the graph checkpoint. Do not claim that an interrupted interview can continue after a backend restart. Runtime data and `logs/interview_*.json` may contain sensitive transcripts and must never be committed or attached unsanitized.

## Documentation, Commits, and Security
Keep `README.md` as user-facing onboarding and this file as the contributor guide. Code and tests are the source of truth. Update these two files when current commands or architectural contracts change; do not retain completed plans, dated design drafts, or agent-specific duplicate guides.

Use present-tense, area-prefixed commit subjects such as `feat(scorecard): handle early stop`. PRs must list user-visible effects, exact verification commands, environment-variable changes, and migrations. The API currently has no authentication and allows all CORS origins. Use real interview data only on a trusted local network or behind an authenticated reverse proxy. Secrets belong in the root `.env`; treat LangSmith traces as external disclosure and clear runs containing personal data.
