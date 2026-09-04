# Repository Guidelines

## Current State

This repository contains one React/Vite frontend and one FastAPI service. The frontend uses the live HTTP adapter by default for PostgreSQL-backed account, authentication, session, lockout, CSRF, and participant administration. The legacy interview endpoints remain unauthenticated and keep interview state in process memory and gitignored JSON files, so the live adapter deliberately does not call them.

The target is a single React SPA and FastAPI service backed completely by PostgreSQL locally and Amazon RDS for PostgreSQL in AWS. Read the current/target split in [docs/architecture.md](docs/architecture.md); do not infer that implemented account auth protects the old interview routes. Do not use real research data until interview authorization, ownership, and PostgreSQL persistence are also implemented and connected.

Do not introduce Streamlit, Gradio, another frontend runtime, hash-based navigation, or a role switch. `presentation/` is user-owned material outside application work unless the user explicitly places it in scope.

## Source Ownership

- `backend/api.py`: application composition, auth routers, readiness, and legacy interview REST/SSE prototype
- `backend/auth/service.py`: login lockout, fixed/rolling sessions, logout, password changes, and cleanup
- `backend/auth/admin_service.py`: first-admin bootstrap and participant account lifecycle
- `backend/auth/repository.py`, `models.py`: SQLAlchemy queries and auth schema mappings
- `backend/auth/dependencies.py`, `router.py`, `admin_router.py`: cookie auth, origin/CSRF/role enforcement, and HTTP endpoints
- `backend/app_core/database.py`, `backend/migrations/`: PostgreSQL-only runtime and Alembic schema
- `backend/interview/`: two-node LangGraph ReAct engine, scorecard, tool execution, and prompts
- `backend/app_core/`: environment, paths, and database configuration
- `backend/storage/`, `backend/logs/`: temporary JSON persistence and transcript logging to remove after PostgreSQL migration
- `dev.sh`: primary local stack lifecycle, migration, port selection, and safe process-log view
- `frontend/src/App.tsx`: provider composition and route tree
- `frontend/src/app/`: live HTTP adapter, `AppApi` contracts, session state, route guards, and navigation announcements
- `frontend/src/mocks/`: explicit mock-mode and test-only fixture boundary
- `frontend/src/layouts/`, `pages/`, `features/`: role-separated UI
- `frontend/src/components/ui/`: shared shadcn/ui primitives
- `interview_flow.json`: question metadata

`HttpAppApi` is the default runtime implementation. Keep `MockAppApi` opt-in through `VITE_APP_MODE=mock`; never make fixture mode the production fallback. Until protected interview endpoints exist, live interview methods must fail locally without calling `/api/start`, `/api/message`, `/api/stream`, `/api/review`, `/api/sessions`, or `/api/csv`.

## Frontend Contracts

Supported routes are `/login`, `/interview`, `/account/password`, `/admin`, `/admin/participants`, and `/admin/interviews/:interviewId`. Server-provided roles select the shell. Route guards improve navigation but never replace backend authorization.

Keep participant responses free of participant codes, review state, scorecards, AI decisions, rationales, and other administrator-only data. Mock credentials may appear only in `frontend/src/mocks/` and frontend tests; never put them in documentation, rendered hints, logs, or non-mock code. Each test creates a fresh API instance.

Use only the three base colors from `frontend/src/styles.css`: ink `#17233C`, surface `#F6F4EE`, and accent `#2F6F68`. Derived colors may use opacity or `color-mix()`. Do not add gradients, emoji, promotional copy, decorative cards, or color-only status. Preserve keyboard access, visible focus, dialog focus/Escape behavior, reduced motion, Korean multiline readability, normal scrolling, and 360 px layouts. Follow [PRODUCT.md](PRODUCT.md).

Protected requests must clear the client session on `401`. A `403` keeps the authenticated identity and displays a permission-specific state. Serialize logout and interview submissions. Use `clientTurnId` for retry idempotency.

Before reusing the mock with scorecard rows whose `aiStatus` is `null`, reject both approval and override for those rows and derive interview review state only from rows with a non-null AI decision. The current closed fixture does not exercise that case.

## Backend Contracts

A question change must keep `interview_flow.json`, `Scorecard._build_items()` ordering in `backend/interview/scorecard.py`, and `SECTIONS` in `backend/api.py` aligned. Graph routing belongs in `backend/interview/engine.py`; question metadata belongs in `interview_flow.json`.

Diagnosis changes update both `Scorecard.calculate()` and `calculate_with_overrides()` and add AI and expert-result regressions. The decorated `scorecard_tool` body is schema-only; runtime behavior belongs in `execute_scorecard_action()` and the custom tool node. Prefer injected storage and LLM clients over new module-level singletons.

Auth persistence uses Alembic migrations and SQLAlchemy repositories against PostgreSQL only; never add SQLite or JSON fallback. Run migrations explicitly instead of at application startup. Password changes, administrator resets, account disable, automatic administrator lock, and administrator unlock revoke all sessions for that account. Keep the mock and live frontend behavior aligned: after a successful password change, clear the client identity and return to login.

Preserve the implemented state machine in `docs/architecture.md`: a fixed 24-hour normal session; a 30-day rolling remembered session renewed at seven days remaining and capped at 90 days; five failures for a 15-minute temporary lock; then five more failures for an administrator-released lock. Attempts during temporary lock do not advance the second stage. Successful login resets the failure stage. Keep row locks around login transitions, store only session/CSRF token hashes, and keep login failure responses generic.

## Commands and Tests

Install from the repository root:

```bash
uv sync
(cd frontend && npm install)
```

Run the complete local stack with `./dev.sh start`. It starts the Compose PostgreSQL service, applies Alembic migrations, selects available ports starting at FastAPI `8001` and Vite `5173`, and follows API and frontend logs. `Ctrl-C` exits only the log view; use `./dev.sh stop` to stop the app and database while preserving the database volume. Use `status`, `debug`, `logs`, `restart`, and `admin` for routine local work. `run_web_app.sh` is the lower-level foreground app runner and does not prepare PostgreSQL.

Start the real PostgreSQL test service before auth tests:

```bash
docker compose --profile test up -d db-test
uv run pytest tests/test_database.py tests/test_auth_security.py tests/test_auth_service.py tests/test_auth_api.py tests/test_auth_cli.py -q
```

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
bash tests/test_dev_script.sh
```

Legacy Python and shell tests are executable scripts; auth tests use pytest and the PostgreSQL 16 test service. None may require an API key or public network. Frontend behavior changes require observable-state tests covering the affected loading, empty, error, role, active, completed, or review states.

## Persistence, Security, and Documentation

Account/session/audit state is durable in PostgreSQL migration `20260904_0001`. Current LangGraph checkpoints still use process-local `MemorySaver`; `data/web_sessions/` restores reviewer/display snapshots and `data/results/` stores completed results, but neither restores an interrupted graph checkpoint. Never claim restart-safe interview continuation until PostgreSQL repositories replace this path.

`DATABASE_URL` must use PostgreSQL with psycopg 3. `dev.sh` injects the Compose URL only for local development; deployed processes receive their URL from the environment or secret store. `VITE_AUTH_CSRF_COOKIE` must equal `AUTH_CSRF_COOKIE`. Production cookies require `AUTH_COOKIE_SECURE=true`, and `AUTH_ALLOWED_ORIGINS` must contain only deployed application origins. `/api/health` is liveness; `/api/ready` must fail when PostgreSQL is unavailable. Use `./dev.sh admin` locally and `backend/manage.py bootstrap-admin` only from a trusted AWS shell/SSM session. Schedule `cleanup-sessions` operationally.

Local process output is split across `logs/dev.log`, `logs/api.log`, and `logs/frontend.log`; `dev.sh` provides the unified view. Authentication audit events remain in PostgreSQL. This is not a production centralized logging service. Runtime data, `logs/interview_*.json`, and LangSmith traces may contain sensitive content; never include the legacy interview logs in automatic tails or commit or attach them unsanitized. Secrets belong in the root `.env`.

Keep `README.md` for setup and current behavior, this file for contributor rules, `PRODUCT.md` for durable product/UI constraints, and `docs/architecture.md` for the target system. Update these documents with the code that changes their claims.

Temporary PRDs, blueprints, design notes, implementation plans, checklists, and review reports are allowed while work is active. Give them a clear scope and status. At completion, move durable decisions into the maintained documents above, then delete completed plans and scratch material. Do not retain dated drafts, session transcripts, or agent reports as a second source of truth.

Use present-tense, area-prefixed commit subjects. PRs summarize user-visible effects, exact verification commands, configuration changes, and migrations.
