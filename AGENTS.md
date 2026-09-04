# Repository Guidelines

## Current State

This repository contains one React/Vite frontend and one FastAPI interview-engine prototype. The supported frontend is the role-separated fixture-backed mock. It does not call the current FastAPI API. The backend remains unauthenticated and persists prototype state through process memory and gitignored JSON files.

The target is a single React SPA and FastAPI service backed by PostgreSQL locally and Amazon RDS for PostgreSQL in AWS. Treat [docs/architecture.md](docs/architecture.md) as the target, not as implemented behavior. Do not use real research data until server authentication, authorization, durable storage, and restricted CORS are implemented.

Do not introduce Streamlit, Gradio, another frontend runtime, hash-based navigation, or a role switch. `presentation/` is user-owned material outside application work unless the user explicitly places it in scope.

## Source Ownership

- `backend/api.py`: current REST/SSE prototype and response models
- `backend/interview/`: two-node LangGraph ReAct engine, scorecard, tool execution, and prompts
- `backend/app_core/`: environment configuration and repository paths
- `backend/storage/`, `backend/logs/`: temporary JSON persistence and transcript logging to remove after PostgreSQL migration
- `frontend/src/App.tsx`: provider composition and route tree
- `frontend/src/app/`: `AppApi` contracts, session state, route guards, and navigation announcements
- `frontend/src/mocks/`: the only frontend fixture and mock-state boundary
- `frontend/src/layouts/`, `pages/`, `features/`: role-separated UI
- `frontend/src/components/ui/`: shared shadcn/ui primitives
- `interview_flow.json`: question metadata

`frontend/src/api.ts` and `frontend/src/types.ts` are reference-only clients for the old backend contract. Do not import them into the mock application. Replace or remove them when authenticated APIs are connected.

## Frontend Contracts

Supported routes are `/login`, `/interview`, `/account/password`, `/admin`, `/admin/participants`, and `/admin/interviews/:interviewId`. Server-provided roles select the shell. Route guards improve navigation but never replace backend authorization.

Keep participant responses free of participant codes, review state, scorecards, AI decisions, rationales, and other administrator-only data. Mock credentials may appear only in `frontend/src/mocks/` and frontend tests; never put them in documentation, rendered hints, logs, or non-mock code. Each test creates a fresh API instance.

Use only the three base colors from `frontend/src/styles.css`: ink `#17233C`, surface `#F6F4EE`, and accent `#2F6F68`. Derived colors may use opacity or `color-mix()`. Do not add gradients, emoji, promotional copy, decorative cards, or color-only status. Preserve keyboard access, visible focus, dialog focus/Escape behavior, reduced motion, Korean multiline readability, normal scrolling, and 360 px layouts. Follow [PRODUCT.md](PRODUCT.md).

Protected requests must clear the client session on `401`. A `403` keeps the authenticated identity and displays a permission-specific state. Serialize logout and interview submissions. Use `clientTurnId` for retry idempotency.

Before reusing the mock with scorecard rows whose `aiStatus` is `null`, reject both approval and override for those rows and derive interview review state only from rows with a non-null AI decision. The current closed fixture does not exercise that case.

## Backend Contracts

A question change must keep `interview_flow.json`, `Scorecard._build_items()` ordering in `backend/interview/scorecard.py`, and `SECTIONS` in `backend/api.py` aligned. Graph routing belongs in `backend/interview/engine.py`; question metadata belongs in `interview_flow.json`.

Diagnosis changes update both `Scorecard.calculate()` and `calculate_with_overrides()` and add AI and expert-result regressions. The decorated `scorecard_tool` body is schema-only; runtime behavior belongs in `execute_scorecard_action()` and the custom tool node. Prefer injected storage and LLM clients over new module-level singletons.

The PostgreSQL slice must use Alembic migrations and repositories without SQLite or JSON fallback. Real password changes, administrator resets, and account disable operations revoke all sessions for that account. The current mock intentionally keeps the user signed in after a password change for UI flow validation.

Implement authentication from the state machine in `docs/architecture.md`: a fixed 24-hour normal session; a 30-day rolling remembered session renewed only near expiry and capped at 90 days; five failures for a 15-minute temporary lock; then five more failures for an administrator-released lock. Attempts during temporary lock do not advance the second stage. Successful login resets the failure stage. Administrator lock and unlock revoke sessions and emit audit events.

## Commands and Tests

Install from the repository root:

```bash
uv sync
(cd frontend && npm install)
```

Run the application with `./run_web_app.sh`. It selects available ports starting at FastAPI `8001` and Vite `5173`, then prints the authoritative URLs.

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

Python and shell tests are executable scripts rather than one pytest suite. They must not require an API key or external network. Frontend behavior changes require observable-state tests covering the affected loading, empty, error, role, active, completed, or review states.

## Persistence, Security, and Documentation

Current LangGraph checkpoints use process-local `MemorySaver`. `data/web_sessions/` restores reviewer/display snapshots and `data/results/` stores completed results, but neither restores an interrupted graph checkpoint. Never claim restart-safe interview continuation until PostgreSQL repositories replace this path.

Runtime data, `logs/interview_*.json`, and LangSmith traces may contain sensitive content. Never commit or attach them unsanitized. Secrets belong in the root `.env`.

Keep `README.md` for setup and current behavior, this file for contributor rules, `PRODUCT.md` for durable product/UI constraints, and `docs/architecture.md` for the target system. Update these documents with the code that changes their claims.

Temporary PRDs, blueprints, design notes, implementation plans, checklists, and review reports are allowed while work is active. Give them a clear scope and status. At completion, move durable decisions into the maintained documents above, then delete completed plans and scratch material. Do not retain dated drafts, session transcripts, or agent reports as a second source of truth.

Use present-tense, area-prefixed commit subjects. PRs summarize user-visible effects, exact verification commands, configuration changes, and migrations.
