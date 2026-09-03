# Repository Guidelines

## Active Stack and Source Layout

The supported application is one FastAPI backend and one React/Vite SPA. Python code lives under `backend/`; `backend/api.py` exposes the current REST and SSE endpoints. The active frontend lives under `frontend/src/`: `App.tsx` owns providers and browser routing, `app/` owns contracts, injected API/session state, route guards, and route tests, `mocks/` owns the development-only `AppApi`, and `layouts/`, `pages/`, and `features/` implement the role-separated UI. Do not add another UI runtime or alternate entry point.

Core interview orchestration is under `backend/interview/`. `engine.py` builds the two-node LangGraph ReAct loop, `scorecard.py` owns scorecard state and deterministic diagnosis, `tools.py` exposes the tool schema, and `prompts.py` owns evaluation criteria. Use constants from `backend/app_core/paths.py` instead of reconstructing repository paths.

## Frontend Contracts

The supported routes are `/login`, participant routes `/interview` and `/account/password`, and administrator routes `/admin`, `/admin/participants`, and `/admin/interviews/:interviewId`. Server-shaped session roles select the shell; there is no role switch or hash navigation. Route guards are a UI boundary, not backend authorization.

The current frontend is a fixture-backed functional mock for UI validation. `frontend/src/mocks/` is the only mock state boundary, production composition creates one stable `MockAppApi`, and tests inject a fresh API per case. Tracked development fixture credentials are allowed only inside that mock fixture boundary and frontend test code; never place them in documentation, rendered UI, logs, or non-mock production code. The mock must not call the current unauthenticated backend. Keep `frontend/src/api.ts` and `frontend/src/types.ts` unchanged as references for the existing backend client, but do not import them into the mock application. PostgreSQL-backed authentication and API integration are the next slice in [docs/architecture.md](docs/architecture.md).

Use exactly the three base colors defined in `frontend/src/styles.css`: ink `#17233C`, surface `#F6F4EE`, and accent `#2F6F68`. Derive muted, border, hover, and state colors from those tokens. Do not add gradients, promotional copy, decorative UI, emoji, or color-only status. Preserve normal page scrolling, visible focus, keyboard order, dialog Escape/focus behavior, Korean multiline readability, and 360 px layouts. Follow [PRODUCT.md](PRODUCT.md) and the frontend section of [docs/architecture.md](docs/architecture.md).

## Backend Change Contracts

A question change must keep `interview_flow.json`, `Scorecard._build_items()` ordering in `backend/interview/scorecard.py`, and `SECTIONS` in `backend/api.py` aligned. Graph routing belongs in `backend/interview/engine.py`; `interview_flow.json` contains question metadata only.

Diagnosis changes must update both `Scorecard.calculate()` and `calculate_with_overrides()` and add AI and expert-result regression coverage. The decorated `scorecard_tool` body is schema-only; runtime behavior belongs in `execute_scorecard_action()` and the custom `tool_node` in `engine.py`. Prefer dependency injection over new module-level singletons.

## Build and Verification

Install with `uv sync` and `cd frontend && npm install`. Start both services with `./run_web_app.sh`; it selects available ports starting at FastAPI 8001 and Vite 5173 and prints the authoritative URLs. Logs go to `logs/api.log` and `logs/frontend.log`.

Run deterministic checks from the repository root:

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

Python and shell tests are executable scripts, not a pytest suite, and must not require an API key or external network. Frontend behavior changes require test-first Vitest coverage of observable states, including loading, empty, error, role routing, active interview, completion, and review where relevant. Use a fresh injected API so tests do not leak session or fixture state. `npm run build` remains the TypeScript and bundle gate.

## Persistence, Documentation, and Security

Current LangGraph checkpoints use in-process `MemorySaver`. Disk snapshots under `data/web_sessions/` restore reviewer/display state after a restart and completed results live under `data/results/`; neither rehydrates the graph checkpoint. Do not claim an interrupted interview can continue after a backend restart. Runtime data and `logs/interview_*.json` may contain sensitive transcripts and must never be committed or attached unsanitized.

Keep `README.md` as user onboarding, this file as the contributor guide, `PRODUCT.md` as product guidance, and `docs/architecture.md` as the target architecture. Do not retain completed plans, dated design drafts, or agent scratch reports in tracked files. Development fixture credentials follow the mock/test boundary above.

Use present-tense, area-prefixed commit subjects. PRs list user-visible effects, exact verification commands, configuration changes, and migrations. The current backend has no authentication and allows all CORS origins; use real data only on a trusted local network or behind an authenticated reverse proxy. Secrets belong in the root `.env`; treat LangSmith traces as external disclosure.
