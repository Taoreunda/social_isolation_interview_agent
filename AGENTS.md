# Repository Guidelines

## Current System

This repository is one authenticated research application: a React/Vite SPA, a FastAPI service, the existing two-node LangGraph interview engine, and PostgreSQL. The live frontend uses only the protected PostgreSQL API. Do not restore the removed unauthenticated interview endpoints, process-memory checkpoints, JSON persistence, or raw transcript logging.

The product has two roles only: `participant` and `admin`. Do not add public signup, social login, a role switch, Streamlit, Gradio, another frontend runtime, or SQLite fallback. `presentation/` is user-owned and out of application scope unless the user explicitly includes it.

## Source Map

- `backend/api.py`: FastAPI composition, CORS, liveness, and readiness
- `backend/auth/`: accounts, login lockout, server sessions, CSRF/role dependencies, participant administration, and CLI
- `backend/interview/engine.py`: two-node LangGraph ReAct engine and persisted-turn adapter
- `backend/interview/scorecard.py`, `tools.py`, `prompts.py`: deterministic scorecard and model protocol
- `backend/interview/models.py`, `repository.py`, `service.py`, `router.py`, `schemas.py`: PostgreSQL interview boundary
- `backend/migrations/`: Alembic schema; PostgreSQL is the only database target
- `frontend/src/app/`: API contracts, live HTTP adapter, auth state, and routing
- `frontend/src/mocks/`: explicit `VITE_APP_MODE=mock` fixtures only
- `frontend/src/pages/`, `features/`, `components/ui/`: role-separated React/shadcn UI
- `interview_flow.json`: ordered question metadata
- `dev.sh`: supported local stack, migration, port selection, and logs

## Invariants

- A participant holds one current interview. An administrator archives a finished one to let the next begin; the archived record stays in the queue and in exports.
- Participants may read and mutate only their own current interview. Participant DTOs contain visible messages, status, progress, and update time—never participant code, scorecard, diagnosis, AI rationale, review, or export data.
- Administrators may manage pseudonymous participant accounts and read/review/export interviews, including the diagnosis, criteria, summary and algorithm version. Do not expose extra identity fields beside `participant_code`, and never place any of this in a participant response.
- Every state-changing route requires an allowed origin, authenticated cookie session, and matching CSRF cookie/header. Route guards are not authorization.
- Persist visible user/assistant messages and scorecard state only after a successful model turn. Keep `clientTurnId` idempotency and atomic user+assistant+scorecard commits.
- Do not persist system prompts, tool messages, provider objects, passwords, raw tokens, or transcript-bearing logs.
- A later AI change invalidates the previous expert review for that item. Null AI states cannot be reviewed; `recorded` items can only be approved; an override must resolve to a different decision than the AI's.
- CSV cells derived from external content must remain protected against spreadsheet formula injection.
- Model and database failures return safe messages without upstream or SQL details.

Keep the fixed authentication policy in `docs/architecture.md`: normal sessions last 24 hours; remembered sessions roll for 30 days at the seven-day threshold with a 90-day absolute limit. Five failures in 15 minutes cause a 15-minute lock; five more after expiry cause an administrator-released lock. Password changes, reset, disable, and administrator lock/unlock revoke the affected account's sessions.

## Code and Tests

Use Python type hints and PEP 8 naming. Keep transaction ownership in services and SQL in repositories. Model calls must occur outside open database transactions. Inject the engine, clock, storage boundary, or password/token services in tests rather than calling external systems.

React components use PascalCase and functions use camelCase. Keep the three base colors in `frontend/src/styles.css`: `#17233C`, `#F6F4EE`, `#2F6F68`. Two signal colors, `#2E8B57` (true) and `#C2413A` (false), exist only for the true/false lamps of the administrator debug panel; do not use them elsewhere. Derived colors may use opacity or `color-mix()`. Do not add gradients, decorative cards, emoji, promotional copy, or explanatory clutter. Preserve keyboard access, visible focus, Korean multiline layout, reduced motion, 360 px layouts, and non-color status labels.

Run from the repository root:

```bash
docker compose --profile test up -d db-test
uv run pytest -q
uv run python tests/test_flow_scenarios.py
(cd frontend && npm test && npm run check:palette && npm run build)
bash tests/test_run_web_app.sh
bash tests/test_vite_proxy.sh
bash tests/test_dev_script.sh
```

Tests must not require an API key or public network. Add migration tests for schema changes, real PostgreSQL service/API tests for persistence and authorization, and observable-state frontend tests for UI changes.

## Operations and Documentation

`./dev.sh start` is the normal entry point. It starts PostgreSQL, applies migrations, selects available ports from `8001`/`5173`, and follows `logs/api.log` plus `logs/frontend.log`. `Ctrl-C` closes only the log view; `./dev.sh stop` preserves the DB volume. `./dev.sh admin [username]` creates the first administrator. Never hard-code credentials.

`DATABASE_URL` must be PostgreSQL with psycopg 3. Production requires a private RDS endpoint with verified TLS, `AUTH_COOKIE_SECURE=true`, exact deployed origins, and managed secrets. `/api/health` is liveness; `/api/ready` probes PostgreSQL. Local logs are a unified developer view, not centralized production logging; use structured stdout/stderr collection in AWS and keep research content out of it.

Maintain only `README.md`, this file, `PRODUCT.md`, and `docs/architecture.md` as project documentation. Temporary plans and review notes are allowed while work is active, but move durable decisions into maintained docs and delete the temporary files when the work completes.

Use present-tense, area-prefixed commits. PRs list user-visible effects, exact verification commands, migrations/configuration changes, and UI screenshots when applicable.
