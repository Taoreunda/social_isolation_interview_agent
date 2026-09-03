# Role-separated UI Mock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current user/reviewer tab UI with a concise shadcn/ui mock for login, participant interview, password change, participant management, and administrator review.

**Architecture:** Keep the React/Vite SPA and introduce route guards plus an injected `AppApi` interface. A browser-only mock implementation supplies fixture accounts and research data until the PostgreSQL/auth API plan replaces it; no backend or persistence code changes in this slice.

**Tech Stack:** React 18, TypeScript, Vite, React Router, Tailwind CSS 4, shadcn/ui, Lucide, Vitest, Testing Library.

**Spec:** `docs/architecture.md`

## Global Constraints

- This plan implements only delivery-sequence item 1 from the spec; PostgreSQL, real authentication, and interview persistence receive separate plans.
- Use exactly three base color literals: ink `#17233C`, surface `#F6F4EE`, and accent `#2F6F68`.
- Derived borders, muted surfaces, and hover states may use opacity or `color-mix()` from those tokens; add no other hex, RGB, HSL, OKLCH, LAB, or LCH literals.
- Use no gradients, emoji icons, promotional text, explanatory cards, redundant helper paragraphs, or role-switch tabs.
- UI copy consists of short titles, labels, actions, errors, and empty states.
- Use Lucide icons and text together for status; never rely on color alone.
- Keep the real interview API client in `frontend/src/api.ts` untouched in this mock slice.
- Mock credentials exist only under `frontend/src/mocks/` and must not be represented as production authentication.
- Preserve responsive keyboard-accessible behavior at 360 px width and desktop widths.

---

## File Map

### Design system and test foundation

- Modify `frontend/package.json`: UI, router, and test dependencies/scripts.
- Modify `frontend/tsconfig.json`: `@/*` import alias and Vitest types.
- Modify `frontend/vite.config.ts`: Tailwind plugin, alias, existing API proxy, and Vitest config.
- Create `frontend/components.json`: shadcn/ui registry configuration.
- Create `frontend/src/lib/utils.ts`: shadcn `cn()` helper.
- Replace `frontend/src/styles.css`: Tailwind entry point and the three-token theme.
- Create `frontend/src/components/ui/*.tsx`: CLI-owned shadcn primitives.
- Create `frontend/scripts/check-palette.mjs`: reject extra color literals and gradients.
- Create `frontend/src/test/setup.ts`: Testing Library matchers and browser cleanup.
- Modify `frontend/src/UserView.tsx`, `frontend/src/ReviewerView.tsx`, and
  `frontend/src/components.tsx`: mechanically use the three semantic tokens
  while these files remain the active UI.

### Mock application boundary

- Create `frontend/src/app/contracts.ts`: role, account, participant, interview, scorecard, and `AppApi` contracts.
- Create `frontend/src/mocks/fixtures.ts`: closed, deterministic research fixtures.
- Create `frontend/src/mocks/mock-api.ts`: in-browser `AppApi` implementation.
- Create `frontend/src/app/api-context.tsx`: injected API context.
- Create `frontend/src/app/session-context.tsx`: current-user lifecycle and mock remember-me state.

### Routing and screens

- Replace `frontend/src/App.tsx`: provider composition and route tree.
- Create `frontend/src/app/route-guards.tsx`: guest, participant, and admin guards.
- Create `frontend/src/layouts/ParticipantLayout.tsx`: compact participant header/outlet.
- Create `frontend/src/layouts/AdminLayout.tsx`: compact admin navigation/outlet.
- Create `frontend/src/pages/LoginPage.tsx`: login form.
- Create `frontend/src/pages/PasswordPage.tsx`: optional password-change form.
- Create `frontend/src/pages/InterviewPage.tsx`: participant interview mock.
- Create `frontend/src/pages/AdminDashboardPage.tsx`: counts and interview queue.
- Create `frontend/src/pages/ParticipantsPage.tsx`: participant table and account dialog.
- Create `frontend/src/pages/InterviewReviewPage.tsx`: transcript, scorecard, and review controls.
- Create `frontend/src/features/interview/Chat.tsx`: presentational chat/input.
- Create `frontend/src/features/admin/ParticipantDialog.tsx`: create/reset credential dialog.
- Create `frontend/src/features/admin/ScorecardReview.tsx`: concise review rows.

### Tests and cleanup

- Create `frontend/src/mocks/mock-api.test.ts`.
- Create `frontend/src/app/routing.test.tsx`.
- Create `frontend/src/pages/LoginPage.test.tsx`.
- Create `frontend/src/pages/InterviewPage.test.tsx`.
- Create `frontend/src/pages/ParticipantsPage.test.tsx`.
- Create `frontend/src/pages/InterviewReviewPage.test.tsx`.
- Delete `frontend/src/UserView.tsx`, `frontend/src/ReviewerView.tsx`, and `frontend/src/components.tsx` after equivalent mock routes pass.
- Modify `README.md` and `AGENTS.md`: document the temporary mock routes and verification commands without presenting mock login as production auth.

---

### Task 1: Install and enforce the three-color shadcn foundation

**Files:**

- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/tsconfig.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/components.json`
- Create: `frontend/src/lib/utils.ts`
- Replace: `frontend/src/styles.css`
- Create: `frontend/src/components/ui/button.tsx`
- Create: `frontend/src/components/ui/input.tsx`
- Create: `frontend/src/components/ui/label.tsx`
- Create: `frontend/src/components/ui/checkbox.tsx`
- Create: `frontend/src/components/ui/progress.tsx`
- Create: `frontend/src/components/ui/table.tsx`
- Create: `frontend/src/components/ui/badge.tsx`
- Create: `frontend/src/components/ui/dialog.tsx`
- Create: `frontend/src/components/ui/textarea.tsx`
- Create: `frontend/src/components/ui/separator.tsx`
- Create: `frontend/scripts/check-palette.mjs`
- Create: `frontend/src/test/setup.ts`
- Modify: `frontend/src/UserView.tsx`
- Modify: `frontend/src/ReviewerView.tsx`
- Modify: `frontend/src/components.tsx`

**Interfaces:**

- Produces: `cn(...inputs: ClassValue[]): string` from `@/lib/utils`.
- Produces: standard shadcn `Button`, `Input`, `Label`, `Checkbox`, `Progress`, `Table`, `Badge`, `Dialog`, `Textarea`, and `Separator` exports.
- Produces: `npm run check:palette`, `npm test`, and `npm run build` verification commands.

- [ ] **Step 1: Add the palette guard and its npm command**

Create `frontend/scripts/check-palette.mjs` with a recursive scan of `src/`. Normalize hex matches to uppercase and permit only the three values. Reject `rgb(`, `rgba(`, `hsl(`, `hsla(`, `oklch(`, `lab(`, `lch(`, and the word `gradient`.

```js
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const allowed = new Set(['#17233C', '#F6F4EE', '#2F6F68'])
const forbiddenFunction = /\b(?:rgb|rgba|hsl|hsla|oklch|lab|lch)\s*\(/gi
const gradient = /\bgradient\b/gi
const hex = /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b/gi
const namedUtility = /\b(?:bg|text|border|ring|fill|stroke)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d{1,3})?\b/gi
const namedLiteral = /(['"])(?:black|white|red|orange|yellow|green|blue|purple|pink|gray|grey)\1/gi
const cssNamedLiteral = /:\s*(?:black|white|red|orange|yellow|green|blue|purple|pink|gray|grey)\b/gi

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(target) : [target]
  }))).flat()
}

const failures = []
const srcDirectory = fileURLToPath(new URL('../src/', import.meta.url))
for (const file of await filesUnder(srcDirectory)) {
  if (!/\.(css|ts|tsx)$/.test(file)) continue
  const source = await readFile(file, 'utf8')
  for (const value of source.match(hex) ?? []) {
    if (!allowed.has(value.toUpperCase())) failures.push(`${file}: ${value}`)
  }
  if (forbiddenFunction.test(source)) failures.push(`${file}: color function`)
  forbiddenFunction.lastIndex = 0
  if (gradient.test(source)) failures.push(`${file}: gradient`)
  gradient.lastIndex = 0
  for (const value of source.match(namedUtility) ?? []) {
    failures.push(`${file}: ${value}`)
  }
  for (const value of source.match(namedLiteral) ?? []) {
    failures.push(`${file}: ${value}`)
  }
  for (const value of source.match(cssNamedLiteral) ?? []) {
    failures.push(`${file}: ${value}`)
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
```

- [ ] **Step 2: Run the guard and confirm the current theme fails**

Run: `cd frontend && node scripts/check-palette.mjs`

Expected: non-zero exit listing the current sage, amber, coral, surface, and other color literals.

- [ ] **Step 3: Install the existing-project shadcn toolchain**

Run:

```bash
cd frontend
npm install react-router-dom class-variance-authority clsx tailwind-merge lucide-react tw-animate-css @radix-ui/react-checkbox @radix-ui/react-dialog @radix-ui/react-label @radix-ui/react-progress @radix-ui/react-separator @radix-ui/react-slot
npm install --save-dev tailwindcss @tailwindcss/vite @types/node vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

Add scripts:

```json
{
  "test": "vitest run --passWithNoTests",
  "test:watch": "vitest",
  "check:palette": "node scripts/check-palette.mjs"
}
```

- [ ] **Step 4: Configure aliases, Tailwind, shadcn, and Vitest**

Set `@/*` to `./src/*` in TypeScript and Vite. Preserve the existing dynamic `/api` proxy. Add `tailwindcss()` to Vite plugins and set Vitest to `environment: 'jsdom'`, `setupFiles: './src/test/setup.ts'`, and `css: true`.

Create `components.json` with this registry configuration:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

Create the test setup exactly as:

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)
```

- [ ] **Step 5: Add shadcn primitives and replace the global theme**

Use the shadcn component source for the listed primitives. Replace overlay
utilities such as `bg-black/50` with semantic theme utilities such as
`bg-foreground/40`, then replace generated color variables with only:

```bash
cd frontend
npx shadcn@latest add button input label checkbox progress table badge dialog textarea separator
```

```css
@import "tailwindcss";
@import "tw-animate-css";

:root {
  --ink: #17233C;
  --surface: #F6F4EE;
  --accent: #2F6F68;
  --line: color-mix(in srgb, var(--ink) 16%, transparent);
  --muted: color-mix(in srgb, var(--ink) 7%, var(--surface));
  --hover: color-mix(in srgb, var(--accent) 12%, var(--surface));
}

@theme inline {
  --color-background: var(--surface);
  --color-foreground: var(--ink);
  --color-card: var(--surface);
  --color-card-foreground: var(--ink);
  --color-popover: var(--surface);
  --color-popover-foreground: var(--ink);
  --color-primary: var(--accent);
  --color-primary-foreground: var(--surface);
  --color-secondary: var(--muted);
  --color-secondary-foreground: var(--ink);
  --color-accent: var(--hover);
  --color-accent-foreground: var(--ink);
  --color-muted: var(--muted);
  --color-muted-foreground: color-mix(in srgb, var(--ink) 66%, transparent);
  --color-border: var(--line);
  --color-input: var(--line);
  --color-ring: var(--accent);
  --color-destructive: var(--ink);
}
```

Use system sans-serif typography, a flat surface, 8 px control radii, visible focus rings, and no shadows larger than a one-pixel derived outline. Mechanically replace colors in the three current UI files with `var(--ink)`, `var(--surface)`, `var(--accent)`, or derived CSS variables so the guard passes; do not otherwise redesign those files.

- [ ] **Step 6: Run foundation checks**

Run:

```bash
cd frontend
npm run check:palette
npm test
npm run build
```

Expected: palette guard passes; Vitest exits successfully with no test files or the configured pass-with-no-tests flag; Vite build succeeds.

- [ ] **Step 7: Commit the foundation paths only**

```bash
git add frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/vite.config.ts frontend/components.json frontend/scripts frontend/src/lib frontend/src/test frontend/src/styles.css frontend/src/components/ui frontend/src/UserView.tsx frontend/src/ReviewerView.tsx frontend/src/components.tsx
git commit -m "feat(ui): add three-color shadcn foundation"
```

---

### Task 2: Define the mock API boundary and fixtures

**Files:**

- Create: `frontend/src/app/contracts.ts`
- Create: `frontend/src/app/api-context.tsx`
- Create: `frontend/src/mocks/fixtures.ts`
- Create: `frontend/src/mocks/mock-api.ts`
- Test: `frontend/src/mocks/mock-api.test.ts`

**Interfaces:**

- Produces: `Role = 'participant' | 'admin'`.
- Produces: `CurrentUser`, `ParticipantRecord`, `InterviewListItem`, `InterviewDetail`, `ScorecardRow`, and input types.
- Produces: `AppApi` methods `login`, `logout`, `getCurrentUser`, `changePassword`, `getCurrentInterview`, `sendMessage`, `listParticipants`, `createParticipant`, `resetParticipantPassword`, `disableParticipant`, `listInterviews`, `getInterview`, `reviewScorecard`, and `exportInterviewCsv`.
- Produces: `ApiProvider` and `useApi()`.

- [ ] **Step 1: Write failing mock API contract tests**

Cover these observable cases:

```ts
it('logs in the participant and admin fixtures')
it('returns the same committed response for a repeated clientTurnId')
it('creates a participant with a unique participant code')
it('resets a password without marking it for forced change')
it('disables a participant account')
it('rejects participant access to administrator methods')
it('updates a scorecard review in the administrator fixture')
it('exports a deterministic interview CSV blob')
```

Use fixture credentials `participant01` / `research123!` and `admin` / `research123!` only in `frontend/src/mocks/` tests and fixture code.

- [ ] **Step 2: Run the mock tests and verify failure**

Run: `cd frontend && npm test -- src/mocks/mock-api.test.ts`

Expected: FAIL because `MockAppApi` and contracts do not exist.

- [ ] **Step 3: Define contracts matching the future authenticated API**

Use explicit Promise return types. `sendMessage(interviewId, clientTurnId, content)` returns the complete committed `InterviewDetail`. Admin-only calls inspect the mock current role and reject with an `ApiError` carrying status `403`.

```ts
export type Role = 'participant' | 'admin'
export type AccountStatus = 'active' | 'disabled'
export type InterviewStatus = 'active' | 'completed' | 'archived'

export interface CurrentUser {
  id: string
  username: string
  role: Role
  participantCode: string | null
}

export interface LoginInput {
  username: string
  password: string
  remember: boolean
}

export interface CreateParticipantInput {
  username: string
  participantCode: string
  password: string
}

export interface PasswordResult {
  assignedPassword: string
}

export interface ParticipantRecord {
  id: string
  username: string
  participantCode: string
  status: AccountStatus
  interviewStatus: InterviewStatus | 'not_started'
}

export interface InterviewMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export type ScoreDecision = 'positive' | 'negative' | 'recorded'

export interface ScorecardRow {
  questionId: string
  question: string
  value: string | null
  rationale: string | null
  aiStatus: ScoreDecision | null
  expertStatus: ScoreDecision | null
  expertRationale: string | null
}

export interface InterviewListItem {
  id: string
  participantCode: string
  status: InterviewStatus
  progress: number
  reviewStatus: 'unreviewed' | 'in_review' | 'reviewed'
  updatedAt: string
}

export interface InterviewDetail extends InterviewListItem {
  messages: InterviewMessage[]
  scorecard: ScorecardRow[]
}

export interface ReviewScorecardInput {
  interviewId: string
  questionId: string
  action: 'approve' | 'override'
  expertStatus?: Exclude<ScoreDecision, 'recorded'>
  rationale?: string
}

export interface AppApi {
  login(input: LoginInput): Promise<CurrentUser>
  logout(): Promise<void>
  getCurrentUser(): Promise<CurrentUser | null>
  changePassword(currentPassword: string, newPassword: string): Promise<void>
  getCurrentInterview(): Promise<InterviewDetail>
  sendMessage(interviewId: string, clientTurnId: string, content: string): Promise<InterviewDetail>
  listParticipants(): Promise<ParticipantRecord[]>
  createParticipant(input: CreateParticipantInput): Promise<ParticipantRecord>
  resetParticipantPassword(participantId: string): Promise<PasswordResult>
  disableParticipant(participantId: string): Promise<ParticipantRecord>
  listInterviews(): Promise<InterviewListItem[]>
  getInterview(interviewId: string): Promise<InterviewDetail>
  reviewScorecard(input: ReviewScorecardInput): Promise<InterviewDetail>
  exportInterviewCsv(interviewId: string): Promise<Blob>
}
```

Use camelCase in the frontend contract and convert to snake case only in the
future real HTTP client.

- [ ] **Step 4: Implement deterministic fixtures and `MockAppApi`**

Keep mutable fixture state per `MockAppApi` instance so tests do not leak. Store only the current mock user key in `sessionStorage` or `localStorage`; never store a token. Cache completed turn responses by `clientTurnId`.

- [ ] **Step 5: Run mock tests and all frontend checks**

Run:

```bash
cd frontend
npm test -- src/mocks/mock-api.test.ts
npm run check:palette
npm run build
```

Expected: all pass.

- [ ] **Step 6: Commit the API boundary**

```bash
git add frontend/src/app/contracts.ts frontend/src/app/api-context.tsx frontend/src/mocks
git commit -m "feat(ui): add isolated research portal fixtures"
```

---

### Task 3: Add session state and role-protected routes

**Files:**

- Create: `frontend/src/app/session-context.tsx`
- Create: `frontend/src/app/route-guards.tsx`
- Create: `frontend/src/layouts/ParticipantLayout.tsx`
- Create: `frontend/src/layouts/AdminLayout.tsx`
- Test: `frontend/src/app/routing.test.tsx`

**Interfaces:**

- Consumes: `AppApi`, `CurrentUser`, `Role`, `ApiProvider`, `useApi()` from Task 2.
- Produces: `SessionProvider`, `useSession()`, `RequireGuest`, `RequireRole`.
- `useSession()` returns `{ user, status, login, logout, refresh }` where status is `loading | guest | authenticated`.

- [ ] **Step 1: Write failing route-guard tests**

Use a memory router and assert:

```ts
it('redirects a guest from /interview to /login')
it('redirects a participant away from /admin')
it('redirects an admin away from /interview')
it('restores the remembered mock user after remount')
it('clears the route session on logout')
```

- [ ] **Step 2: Run and confirm route tests fail**

Run: `cd frontend && npm test -- src/app/routing.test.tsx`

Expected: FAIL because providers and guards do not exist.

- [ ] **Step 3: Implement session context and guards**

Call `api.getCurrentUser()` once on mount. While loading, render a centered shadcn spinner with accessible text `불러오는 중`. Route by server-shaped `user.role`, not by URL or a frontend toggle.

- [ ] **Step 4: Implement compact outlet layouts**

Layouts show `Dabom`, at most three navigation actions, the current username,
logout, and a React Router `Outlet`. Mobile admin navigation becomes a compact
top row; do not add the full shadcn sidebar component. Route tests compose the
guards and layouts with local dummy child elements, so this task does not import
page modules created by later tasks.

- [ ] **Step 5: Run routing and build checks**

Run:

```bash
cd frontend
npm test -- src/app/routing.test.tsx
npm run check:palette
npm run build
```

Expected: all pass.

- [ ] **Step 6: Commit protected routing**

```bash
git add frontend/src/app frontend/src/layouts
git commit -m "feat(ui): separate participant and admin routes"
```

---

### Task 4: Build the login and optional password-change screens

**Files:**

- Create: `frontend/src/pages/LoginPage.tsx`
- Create: `frontend/src/pages/PasswordPage.tsx`
- Test: `frontend/src/pages/LoginPage.test.tsx`

**Interfaces:**

- Consumes: `useSession().login`, `useApi().changePassword`.
- Produces: login form `{ username, password, remember }` and password form `{ currentPassword, newPassword, confirmation }`.

- [ ] **Step 1: Write failing form tests**

Cover:

```ts
it('requires username and password')
it('routes a participant to /interview after login')
it('routes an admin to /admin after login')
it('shows one generic error for invalid credentials')
it('passes the automatic-login checkbox value to the API')
it('changes a password without a first-login prompt')
```

- [ ] **Step 2: Run and confirm the tests fail**

Run: `cd frontend && npm test -- src/pages/LoginPage.test.tsx`

Expected: FAIL because both pages are missing.

- [ ] **Step 3: Implement the concise login screen**

Render only the wordmark, title `로그인`, two labeled inputs, `자동 로그인`, submit button, and a single error line. Do not render registration, social login, welcome copy, credential hints, illustrations, or a role selector.

- [ ] **Step 4: Implement optional password change**

Render title `비밀번호 변경`, three labeled password inputs, `변경`, and `취소`. Validate 10–128 characters and matching confirmation before calling the API. Success returns to the role home and renders the short live-region message `변경했습니다`.

- [ ] **Step 5: Run form and global checks**

Run:

```bash
cd frontend
npm test -- src/pages/LoginPage.test.tsx
npm run check:palette
npm run build
```

Expected: all pass.

- [ ] **Step 6: Commit authentication screens**

```bash
git add frontend/src/pages/LoginPage.tsx frontend/src/pages/PasswordPage.tsx frontend/src/pages/LoginPage.test.tsx
git commit -m "feat(ui): add concise account screens"
```

---

### Task 5: Build the participant interview screen

**Files:**

- Create: `frontend/src/features/interview/Chat.tsx`
- Create: `frontend/src/pages/InterviewPage.tsx`
- Test: `frontend/src/pages/InterviewPage.test.tsx`

**Interfaces:**

- Consumes: `AppApi.getCurrentInterview()` and `AppApi.sendMessage(interviewId, clientTurnId, content)`.
- Produces: a participant-only chat view with idle, active, sending, error, and complete states.

- [ ] **Step 1: Write failing participant-flow tests**

Cover:

```ts
it('loads the current interview and progress')
it('submits a non-empty answer with a UUID turn id')
it('disables duplicate submission while sending')
it('restores the latest committed mock turn after remount')
it('hides scorecard and diagnosis from participants')
it('renders a neutral completion state')
```

- [ ] **Step 2: Run and confirm participant tests fail**

Run: `cd frontend && npm test -- src/pages/InterviewPage.test.tsx`

Expected: FAIL because the page is missing.

- [ ] **Step 3: Implement the presentational chat**

Use flat message rows, one progress bar, one text input, and one send icon button. Show role through alignment and an accessible label, not additional bubble colors. Keep message width readable and preserve multiline Korean text.

- [ ] **Step 4: Implement participant state handling**

Load the assigned interview on mount, generate `crypto.randomUUID()` for each submission, and replace state only with the committed response. Use short state copy: `인터뷰 시작`, `답변 입력`, `다시 시도`, and `완료했습니다`. Do not expose a reset/new-interview action.

- [ ] **Step 5: Run participant and global checks**

Run:

```bash
cd frontend
npm test -- src/pages/InterviewPage.test.tsx
npm run check:palette
npm run build
```

Expected: all pass.

- [ ] **Step 6: Commit participant UI**

```bash
git add frontend/src/features/interview frontend/src/pages/InterviewPage.tsx frontend/src/pages/InterviewPage.test.tsx
git commit -m "feat(ui): add participant interview mock"
```

---

### Task 6: Build administrator participant management

**Files:**

- Create: `frontend/src/features/admin/ParticipantDialog.tsx`
- Create: `frontend/src/pages/ParticipantsPage.tsx`
- Test: `frontend/src/pages/ParticipantsPage.test.tsx`

**Interfaces:**

- Consumes: `listParticipants`, `createParticipant`, `resetParticipantPassword`, and `disableParticipant`.
- Produces: searchable participant table and create/reset dialog.

- [ ] **Step 1: Write failing administrator account tests**

Cover:

```ts
it('lists participant code, username, status, and interview status')
it('filters rows by code or username')
it('creates an account with username, code, and assigned password')
it('generates a password of at least 16 characters')
it('shows an assigned password once after create or reset')
it('does not offer public registration or forced-change controls')
```

- [ ] **Step 2: Run and confirm management tests fail**

Run: `cd frontend && npm test -- src/pages/ParticipantsPage.test.tsx`

Expected: FAIL because the page and dialog are missing.

- [ ] **Step 3: Implement the compact participant table**

Use one page title row with `참여자`, search input, and `계정 생성`. Use a shadcn table on desktop and labeled rows on small screens. Actions are `비밀번호 재설정` and `비활성화`; confirmation calls `disableParticipant` and updates the row state.

- [ ] **Step 4: Implement create/reset credential dialogs**

Use labeled fields only. Generated/assigned passwords appear in a bordered monospace row with `복사`; closing the success state clears plaintext from component state. Never add the password to the participant table or browser persistence.

- [ ] **Step 5: Run management and global checks**

Run:

```bash
cd frontend
npm test -- src/pages/ParticipantsPage.test.tsx
npm run check:palette
npm run build
```

Expected: all pass.

- [ ] **Step 6: Commit administrator account UI**

```bash
git add frontend/src/features/admin/ParticipantDialog.tsx frontend/src/pages/ParticipantsPage.tsx frontend/src/pages/ParticipantsPage.test.tsx
git commit -m "feat(ui): add participant account management mock"
```

---

### Task 7: Build administrator interview review

**Files:**

- Create: `frontend/src/pages/AdminDashboardPage.tsx`
- Create: `frontend/src/pages/InterviewReviewPage.tsx`
- Create: `frontend/src/features/admin/ScorecardReview.tsx`
- Test: `frontend/src/pages/InterviewReviewPage.test.tsx`

**Interfaces:**

- Consumes: `listInterviews`, `getInterview`, `reviewScorecard`, and `exportInterviewCsv`.
- Produces: interview queue, transcript/detail view, scorecard decisions, and a mock CSV download action.

- [ ] **Step 1: Write failing review tests**

Cover:

```ts
it('shows total, active, completed, and unreviewed counts')
it('opens an interview from the queue')
it('shows participant code rather than personal identity')
it('shows transcript and scorecard without nested explanatory cards')
it('approves an item')
it('requires a rationale when overriding an item')
it('shows AI and expert decisions with text and icons')
it('downloads a CSV blob using the participant code')
```

- [ ] **Step 2: Run and confirm review tests fail**

Run: `cd frontend && npm test -- src/pages/InterviewReviewPage.test.tsx`

Expected: FAIL because administrator review pages are missing.

- [ ] **Step 3: Implement the administrator dashboard**

Render four compact label/value metrics followed by the interview queue. Columns are participant code, progress, state, review, and updated time. Clicking a row navigates to `/admin/interviews/:interviewId`.

- [ ] **Step 4: Implement transcript and scorecard review**

Desktop uses a two-column split; mobile stacks transcript above scorecard. Scorecard rows show question ID, short value, AI decision, expert decision, and `동의`/`변경`. Override uses a shadcn dialog with decision controls and a required rationale textarea.

- [ ] **Step 5: Run review and global checks**

Run:

```bash
cd frontend
npm test -- src/pages/InterviewReviewPage.test.tsx
npm run check:palette
npm run build
```

Expected: all pass.

- [ ] **Step 6: Commit administrator review UI**

```bash
git add frontend/src/pages/AdminDashboardPage.tsx frontend/src/pages/InterviewReviewPage.tsx frontend/src/features/admin/ScorecardReview.tsx frontend/src/pages/InterviewReviewPage.test.tsx
git commit -m "feat(ui): add administrator review mock"
```

---

### Task 8: Remove the tab UI and verify the functional mock

**Files:**

- Replace: `frontend/src/App.tsx`
- Delete: `frontend/src/UserView.tsx`
- Delete: `frontend/src/ReviewerView.tsx`
- Delete: `frontend/src/components.tsx`
- Modify: `frontend/src/app/routing.test.tsx`
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: all routes and components from Tasks 1–7.
- Produces: one supported role-separated mock UI and current contributor commands.

- [ ] **Step 1: Compose the final route tree and extend routing tests**

Replace `App.tsx` with `ApiProvider`, `SessionProvider`, `BrowserRouter`, and
these exact routes:

```tsx
<Route path="/login" element={<RequireGuest><LoginPage /></RequireGuest>} />
<Route element={<RequireRole role="participant"><ParticipantLayout /></RequireRole>}>
  <Route path="/interview" element={<InterviewPage />} />
  <Route path="/account/password" element={<PasswordPage />} />
</Route>
<Route element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
  <Route path="/admin" element={<AdminDashboardPage />} />
  <Route path="/admin/participants" element={<ParticipantsPage />} />
  <Route path="/admin/interviews/:interviewId" element={<InterviewReviewPage />} />
</Route>
```

Add a wildcard redirect that uses the authenticated role when present and
`/login` for guests. Extend routing tests to render the complete route tree and
prove participant/admin default destinations.

- [ ] **Step 2: Prove no new code imports legacy UI modules**

Run:

```bash
rg -n "UserView|ReviewerView|from './components'|#user|#reviewer" frontend/src
```

Expected before deletion: matches only in the three old files; no new route imports them.

- [ ] **Step 3: Delete the old tab components**

Remove the three files only after all equivalent route tests pass. Do not preserve an alternate UI entry point.

- [ ] **Step 4: Update active documentation**

Document `npm test`, `npm run check:palette`, and the mock routes. State that fixture login is development-only and that real PostgreSQL authentication is the next slice. Remove instructions for `#user` and `#reviewer`.

- [ ] **Step 5: Run the full deterministic verification suite**

Run:

```bash
cd frontend
npm test
npm run check:palette
npm run build
cd ..
uv run python tests/test_scorecard.py
uv run python tests/test_flow_scenarios.py
uv run python tests/test_api_persistence.py
bash tests/test_run_web_app.sh
bash tests/test_vite_proxy.sh
```

Expected: all commands pass. Backend tests confirm the UI-only slice did not alter current interview behavior.

- [ ] **Step 6: Run browser smoke checks**

Start `./run_web_app.sh` and verify at desktop and 360 px widths:

1. Guest navigation redirects to `/login`.
2. `participant01` enters `/interview`, sends a mock answer, refreshes, and retains remembered login when selected.
3. `admin` enters `/admin`, creates a participant, copies the one-time password, opens an interview, approves one item, and overrides one item with a rationale.
4. Keyboard Tab order reaches every form and dialog action; Escape closes dialogs; visible focus remains present.
5. Browser console contains no errors and no request is sent to the current unauthenticated backend API.

- [ ] **Step 7: Commit cleanup and docs**

```bash
git add frontend/src README.md AGENTS.md
git commit -m "docs(ui): make role-separated mock the supported frontend"
```

---

## Plan Self-review

- Spec coverage: this plan covers the approved UI mock, route separation,
  concise copy, three-color system, optional password screen, central account
  management mock, participant interview, and administrator review. PostgreSQL,
  server authentication, durable sessions, and AWS deployment are deliberately
  separate implementation plans because each is independently reviewable.
- Completeness scan: every code-producing step names concrete files, interfaces,
  checks, and outcomes; no deferred implementation markers remain.
- Type consistency: all pages consume the single `AppApi` contract from Task 2;
  role values remain `participant | admin`, and interview mutation uses the same
  required `clientTurnId` contract as the architecture spec.
