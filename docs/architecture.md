# Research Web Platform Architecture

This document is the current design baseline for turning the local interview
prototype into a closed research application. It replaces dated design drafts;
implementation code and migrations remain the final source of truth.

## Goals

- Support a closed cohort of roughly 200–300 participants and a small number of
  researchers.
- Separate participant and administrator access in both the UI and API.
- Persist accounts, login sessions, interviews, messages, scorecards, and expert
  reviews in PostgreSQL.
- Resume an interview from the last committed turn after a browser refresh or
  application restart.
- Run locally against PostgreSQL and move to Amazon RDS for PostgreSQL by
  changing deployment configuration, not application behavior or schema.
- Minimize personally identifying data and keep research exports auditable.

## Non-goals

- Public sign-up, social login, email verification, or password recovery email.
- Mandatory password change on first login.
- Multiple studies, organizations, or tenant isolation.
- Multi-AZ, read replicas, RDS Proxy, Redis, or horizontal application scaling.
- Importing gitignored prototype JSON files as production research data.
- AWS infrastructure-as-code in the first implementation slice.

## System boundary

The supported application remains one React SPA and one FastAPI service.

```text
Browser
  -> HTTPS reverse proxy
    -> React static assets
    -> FastAPI REST/SSE API
      -> PostgreSQL
      -> configured LLM provider
```

Local development uses a containerized PostgreSQL instance. Production uses a
small EC2 application host and a private, Single-AZ RDS for PostgreSQL instance.
The application uses only standard PostgreSQL features available in both
environments.

Configuration is environment-based:

- `DATABASE_URL` selects the PostgreSQL server and database.
- Local connections may disable TLS; AWS connections require certificate
  verification.
- Database credentials are local secrets during development and come from AWS
  Secrets Manager or Parameter Store in production.
- Alembic migrations run as an explicit deployment step, never implicitly on
  application startup.

There is no SQLite or JSON persistence fallback. Failure to connect to the
database makes the API unready instead of silently changing storage behavior.

## Roles and user flows

The application has exactly two roles in this phase:

- `participant`: signs in, starts or resumes the assigned interview, optionally
  changes their password, and views a neutral completion state. Participants do
  not see diagnoses, scorecards, other participants, or research exports.
- `admin`: creates and disables participant accounts, assigns or resets
  permanent passwords, reviews interviews, overrides scorecard items, and
  exports research data.

There is no role switch in the browser. After login, the server-provided role
selects the route and shell. The backend independently enforces ownership and
role checks; hiding a frontend route is not an authorization control.

Participant accounts use a pseudonymous `participant_code`. Real name, email,
phone number, and address are not collected unless a later approved research
protocol explicitly requires them. A participant can have historical interview
attempts but only one active attempt. Only an administrator can archive an
active attempt and create a replacement; a participant cannot delete or reset
collected research data.

## Authentication and session design

Authentication is application-managed and stored in PostgreSQL.

- Passwords are hashed with Argon2id using a maintained library. Plaintext
  passwords are never stored or logged.
- Login names are 3–64 lowercase ASCII characters (`a-z`, `0-9`, `.`, `_`,
  `-`) after trimming and normalization. Passwords are 10–128 characters; the
  administrator generator produces at least 16 random characters.
- An administrator can enter a password or generate a strong password when
  creating/resetting an account. The plaintext value is shown only in the
  creation/reset response and cannot be retrieved later.
- Assigned passwords are permanent. First login does not force a password
  change; participants can change their password from their account page.
- The initial administrator is created by an interactive management command run
  through local shell or AWS Systems Manager. No bootstrap password is committed
  or placed in a frontend bundle.

Successful login creates an opaque, cryptographically random session token. The
browser receives it only as a `HttpOnly`, `SameSite=Lax` cookie; production also
sets `Secure`. PostgreSQL stores only a hash of the token.

- Normal sessions have a 12-hour absolute lifetime.
- Selecting “자동 로그인” creates a 30-day session.
- Logout revokes the current session.
- Password change, administrator password reset, or account disable revokes all
  sessions for that account.
- Expired and revoked sessions are removed by a periodic cleanup command.
- Five failed logins within 15 minutes lock the account for 15 minutes. A
  successful login clears the failure window. Login errors do not reveal
  whether a username exists.

State-changing cookie-authenticated requests validate the request origin and a
CSRF token. CORS is restricted to the configured application origin in
development and production.

## PostgreSQL data model

Identifiers are UUIDs. Timestamps are timezone-aware UTC values. Enumerated
states use database constraints rather than free-form strings.

### `user_accounts`

- `id`, `username_normalized`, `username_display`, `password_hash`
- `role` (`participant` or `admin`), `status` (`active` or `disabled`)
- `participant_code` (nullable for admins, unique for participants)
- failed-login counters and `locked_until`
- `created_by`, `created_at`, `updated_at`, `password_changed_at`

### `auth_sessions`

- `id`, `user_id`, `token_hash`
- `created_at`, `last_seen_at`, `expires_at`, `revoked_at`

### `interviews`

- `id`, `participant_id`, `status` (`active`, `completed`, `archived`)
- `started_at`, `updated_at`, `completed_at`
- deterministic criteria results, diagnosis, report, and algorithm version
- a uniqueness rule allowing at most one active interview per participant

### `interview_messages`

- `id`, `interview_id`, monotonically increasing `sequence`
- `role` (`user` or `assistant`), `content`, `created_at`
- required `client_turn_id` shared by the messages produced by one request
- unique key on `(interview_id, client_turn_id, role)` for idempotent retries

Only visible user and assistant messages are canonical research records. System
prompts, tool-call payloads, and provider-specific message objects are not
stored as conversation records.

### `scorecard_items`

- `interview_id`, `question_id`
- AI status, extracted value, rationale, clarification count, and evaluated time
- unique key on `(interview_id, question_id)`

### `expert_reviews`

- `interview_id`, `question_id`, `reviewer_id`
- original status, expert status, rationale, action, and reviewed time
- unique key on `(interview_id, question_id)`

### `audit_events`

- actor, action, target type/ID, timestamp, and minimal structured metadata
- records account creation/disable/reset, interview archive, expert overrides,
  and exports
- does not duplicate transcripts, passwords, session tokens, or diagnoses

No `studies` table is introduced until the application actually serves more
than one research protocol.

## Interview state and turn processing

PostgreSQL application tables are the canonical state. The engine no longer
depends on process-local `_sessions`, `MemorySaver`, or runtime JSON files.
Before each turn, the backend reconstructs the LangGraph input from ordered
visible messages and scorecard rows. Tool messages exist only while that graph
run is executing; the system prompt already receives the current scorecard.

Each participant request includes a client-generated turn ID:

1. Authenticate and verify that the participant owns the interview.
2. Reject a second simultaneous request for the same interview.
3. Load the latest committed messages and scorecard.
4. Run the interview graph and stream provisional assistant tokens.
5. Atomically persist the user message, final assistant message, scorecard
   changes, and interview metadata.
6. Emit the SSE `done` event only after the transaction commits.

Because the initial target has one FastAPI process, a per-interview application
lock rejects overlapping turns with `409`. Replacing that lock with a
distributed mechanism is required before horizontal application scaling, which
is outside this phase.

If the LLM fails, the committed interview remains at the previous turn and the
client can retry. If the database commit fails after provisional tokens were
shown, the stream ends with an error and the UI reloads the last committed
state. Repeating a committed client turn ID returns the stored result rather
than adding duplicate messages.

This guarantees restart recovery at turn boundaries. Preserving partial token
output during an interrupted LLM response is intentionally out of scope.

## API boundaries

Public endpoints are limited to health/readiness and login. All other endpoints
require a valid session.

Participant API groups cover:

- current account and optional password change
- current interview creation/resumption
- message streaming and committed interview state

Administrator API groups cover:

- participant account list/create/disable/password reset
- interview list/detail/archive
- scorecard review and override
- CSV export

The API returns `401` for missing/expired authentication, `403` for valid users
without permission, `404` when a resource is not visible to the caller, `409`
for conflicting active interviews or turns, and `503` when PostgreSQL is
unavailable. SSE errors use a stable machine-readable code plus safe Korean UI
message; raw exceptions and database details are logged without being returned.

## Frontend structure

The React/Vite application adopts shadcn/ui components and route-based shells:

- `/login`
- `/interview`
- `/account/password`
- `/admin`
- `/admin/participants`
- `/admin/interviews/:interviewId`

The visual system uses exactly three base color codes:

- ink: `#17233C`
- surface: `#F6F4EE`
- accent: `#2F6F68`

Borders, hover states, and muted surfaces may use opacity derived from these
tokens, but no additional hex, RGB, or HSL color literals. Status is never
communicated by color alone. UI copy uses short titles, field labels, actions,
and state messages; explanatory cards, promotional copy, decorative gradients,
and redundant helper paragraphs are excluded.

The current `#user`/`#reviewer` tab switch is removed. The participant shell
contains only interview-related actions. The administrator shell contains
participant management, interview review, and export navigation. Both shells
handle loading, empty, expired-session, permission, network-error, active, and
completed states.

The first UI milestone is a functional mock using the final routes and API
types. It must not embed a second fake persistence system; fixture data is
isolated behind mock API handlers and removed when real endpoints are connected.

## Local and AWS deployment

Local development runs PostgreSQL 16 with Docker Compose while FastAPI and Vite
can continue to run on the host. RDS uses the same PostgreSQL major version.
Tests use a separate PostgreSQL database and apply migrations from an empty
schema.

The initial AWS target is:

- EC2 `t4g.small` for the reverse proxy, React static build, and FastAPI
- RDS for PostgreSQL `db.t4g.micro`, Single-AZ, private access, gp3 storage
- KMS encryption, TLS certificate verification, automated backups, deletion
  protection, and a security group accepting PostgreSQL only from the EC2
  application security group
- no production Vite development server and no publicly reachable PostgreSQL
  port

Application code does not depend on AWS SDKs for normal database access. Moving
from local PostgreSQL to RDS consists of provisioning infrastructure, applying
the same Alembic migrations, supplying secrets and TLS configuration, and
deploying the application build.

## Logging and research-data controls

- Application logs contain request IDs and operational metadata, not message
  text, score rationales, passwords, tokens, or diagnoses.
- LangSmith tracing remains off by default. Enabling it with real participant
  data requires an explicit research-data decision outside application code.
- CSV exports use participant codes rather than usernames and create an audit
  event.
- Raw database access and backups are restricted to the research administrators
  defined by the deployment environment.
- Backup retention and final deletion follow the approved research protocol;
  application defaults do not override that policy.

## Verification strategy

1. Unit tests cover username normalization, Argon2 verification, token hashing,
   expiry, revocation, role checks, and deterministic score calculation.
2. PostgreSQL integration tests apply every Alembic migration to an empty
   database and exercise account, session, interview, review, and export
   repositories.
3. API tests cover login/logout, auto-login expiry, CSRF, participant ownership,
   administrator permissions, account disable/reset, and generic login errors.
4. Interview tests use a fake LLM to prove that committed turns resume after
   application reconstruction and that duplicate client turn IDs are idempotent.
5. Frontend tests cover route guards and major login, participant, and admin
   states; the existing production build remains a required gate.
6. A local smoke test starts a clean PostgreSQL container, runs migrations,
   creates an admin through the management command, completes a mocked
   interview, restarts FastAPI, and resumes the stored result.
7. Before AWS data collection, a backup restoration drill and a modest
   concurrent-session test with a fake LLM are required.

## Delivery sequence

1. Replace the tabbed frontend with a shadcn/ui functional mock of the login,
   participant, and administrator routes; validate the workflows before backend
   integration.
2. Add PostgreSQL configuration, local Compose service, SQLAlchemy models,
   repositories, and Alembic migrations.
3. Add password/session services, bootstrap-admin command, authentication API,
   CSRF protection, and role dependencies.
4. Move interview, message, scorecard, review, and export behavior from
   in-memory/JSON storage to repositories, then connect the approved UI mock to
   the authenticated APIs.
5. Remove obsolete JSON storage and transcript logging, tighten CORS, and update
   `README.md` and `AGENTS.md` to describe only the supported workflow.
6. Add the EC2/RDS deployment configuration after local behavior and restore
   tests pass.

## Acceptance criteria

- A fresh clone can start PostgreSQL locally, apply migrations, create the first
  administrator, and run the application using documented commands.
- Administrators can centrally create, disable, and reset participant accounts;
  there is no public registration path.
- Participants and administrators cannot access each other's protected data or
  routes outside their role.
- Optional password changes work without a forced first-login change, and
  automatic login survives browser restarts until its configured expiry.
- An interview resumes from the last committed turn after FastAPI restarts.
- No active endpoint reads or writes `_sessions`, `MemorySaver`, or JSON result
  files.
- The same migrations and application code run against local PostgreSQL and RDS
  for PostgreSQL.
