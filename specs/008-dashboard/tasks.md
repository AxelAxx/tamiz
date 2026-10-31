---

description: "Task list for feature 008-dashboard"
---

# Tasks: Dashboard

**Input**: `specs/008-dashboard/` (`plan.md`, `spec.md`, `research.md` R-01 … R-16,
`data-model.md`, `contracts/`, `quickstart.md`, `design-brief.md`); features 002–007 merged;
this spec approved by Alex (`T-008-01`).

**Tests**: Mandatory. They are written before the code, and every scenario maps to a test
whose title starts with the scenario id (table below).

**Organization**: Phases are the backlog tasks, one PR each. `dash/` abbreviates
`apps/dashboard/`, `gateway/` abbreviates `apps/gateway/`, and `contracts/` abbreviates
`packages/contracts/`.

**Design gate.** Gate **G1** ("design received") sits between Phase 1 and Phase 2. No task
that renders designed UI (Phase 2 onwards, except the gateway half of Phase 6) starts
before G1 is ticked. Every screen PR is checked against the design by Alex (SC-007);
deviations go in its task record (FR-024).

## Scenario coverage

| Scenario | Task | Scenario | Task |
|---|---|---|---|
| US1-1 no session → redirect / 401 | T005 | US5-1 editor shows policy and meta | T042 |
| US1-2 sign-in, 8 h, wrong, rate limit | T002, T005 | US5-2 shape issues with paths while typing | T041, T042 |
| US1-3 admin key never in the browser | T006, T053 | US5-3 cross-field issues refused | T035, T042 |
| US1-4 sign-out revokes | T002, T005 | US5-4 save → version + 1, used at once | T035, T042 |
| US1-5 cross-origin writes refused | T003, T005 | US5-5 stale base → conflict | T035, T036, T042 |
| US1-6 bad config refuses to start | T001, T054 | US5-6 client key 403, no key 401 | T035 |
| US2-1 new entry within 5 s, badges | T023 | US5-7 boots from history / warns | T036, T042 |
| US2-2 fallback marker | T023 | US5-8 different policy id refused | T035 |
| US2-3 blocked / failed rows | T023 | US6-1 passing report, provenance | T045 |
| US2-4 pause, counter, resume | T022, T023 | US6-2 failing metric and cases | T045 |
| US2-5 late-finishing entries, no duplicates | T022, T023 | US6-3 error / skipped | T045 |
| US2-6 gateway down, retrying | T023 | US6-4 history by policy version | T044, T045 |
| US2-7 no content shown | T023 | US6-5 unreadable file listed | T044, T045 |
| US2-8 entry detail | T023 | US6-6 no reports | T045 |
| US3-1 DNI → critical, local only | T027 | US7-1 chart by day, totals to the cent | T050 |
| US3-2 anonymize, provider messages | T027 | US7-2 group by route / model | T050 |
| US3-3 block, detector outage | T027 | US7-3 not served apart | T050 |
| US3-4 inline validation, nothing sent | T027 | US7-4 baseline unavailable | T049, T050 |
| US3-5 several messages, exact offsets | T026, T027 | US7-5 empty range | T050 |
| US3-6 text never persisted | T027 | US7-6 table alternative, not colour only | T050 |
| US3-7 decision flow order, deciding step | T027 | US8-1 every target, idle shown | T047 |
| US4-1 filter by route | T032 | US8-2 cool-down countdown, 10 s refresh | T047 |
| US4-2 load older, no repeats, end | T032 | US8-3 window switch | T047 |
| US4-3 filters in the URL | T031, T032 | US9-1 no serious / critical violations | T017, T052 |
| US4-4 empty state names filters | T032 | US9-2 keyboard, focus, skip link | T016, T052 |
| US4-5 invalid range | T032 | US9-3 reduced motion | T023 |
| US4-6 table semantics, detail | T032 | US9-4 polite throttled announcements | T023 |
| | | US9-5 theme persists, no flash | T016 |
| | | US9-6 phone layout | T016, T052 |

---

## Phase 1: `T-008-02` — Non-visual skeleton: app, sign-in, BFF, E2E harness (US1)

No designed UI: pages are unstyled placeholders. This phase does not wait for G1.

### Tests first

- [x] T001 [P] [US1] `dash/test/env.test.ts`: the configuration schema (`data-model.md` §3.3)
  accepts a complete set and rejects each missing or malformed variable, listing every
  problem at once; no secret value appears in the messages (US1-6, FR-005).
- [x] T002 [P] [US1] `dash/test/session.test.ts`:
  - passphrase hash format `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>` and constant-time
    comparison;
  - cookie signature (tampered → invalid), absolute expiry at 8 h with an injected clock;
  - sign-out deletes the session (US1-4);
  - 5 failures per 60 s per address, then refused for 60 s; `X-Forwarded-For` only with
    `TAMIZ_DASHBOARD_TRUST_PROXY=true` (US1-2).
- [x] T003 [P] [US1] `dash/test/origin.test.ts`: non-GET with a foreign `Origin`, a foreign
  `Referer`, or neither → `403 forbidden_origin` before the body is read; same origin passes
  (US1-5, R-04).
- [x] T004 [P] `gateway/test/routes-type.test.ts`: `hc<GatewayRoutes>` exposes the admin,
  simulate and health routes with their typed responses (`expectTypeOf`), and the app built
  by `createApp` still answers every existing route (R-02).
- [x] T005 [US1] `dash/e2e/auth.spec.ts` (Playwright, against the E2E gateway):
  - `US1-1` every page redirects to `/sign-in` and every `/api/*` data endpoint answers 401,
    with no call recorded by the E2E gateway's control port;
  - `US1-2` right passphrase → `/live`; wrong → message; sixth failure in a minute → 429 with
    `Retry-After`;
  - `US1-4` sign-out → next `/api/audit` is 401, the old cookie replayed is 401;
  - `US1-5` a cross-origin `POST /api/simulate` and `DELETE /api/session` → 403, nothing
    reaches the gateway.
- [x] T006 [US1] `dash/e2e/key-leak.spec.ts` (`US1-3`, first version): sign in, visit every
  placeholder page, call every BFF endpoint; record every response header and body, the
  cookies and both storages; the admin key appears nowhere; the control port shows
  `Authorization: Bearer <key>` on every gateway call. Extended in T053.

### Implementation

- [x] T007 `dash/package.json` (`@tamiz/dashboard`, private, ESM), `next.config.ts`
  (`output: "standalone"`, port 3100), `tsconfig.json` extending `@tamiz/tsconfig`,
  `vitest.config.ts` (jsdom), registration in the root Vitest projects, `turbo.json`
  (`build`, `typecheck`, `test`, `e2e`), Biome coverage. Dependencies as in `plan.md`
  (exact versions pinned by the lockfile).
- [x] T008 `dash/src/lib/server/env.ts` (`import "server-only"`; Zod; exits listing every
  problem) and `dash/.env.example` documenting each variable.
- [x] T009 `dash/src/lib/server/session.ts` (in-memory store, signing, expiry, rate limit),
  `dash/scripts/hash-passphrase.ts` (reads stdin, prints the hash),
  `dash/src/app/api/session/route.ts` (`POST`, `DELETE`), `dash/src/proxy.ts` (page gate:
  cookie signature → otherwise redirect to `/sign-in`).
- [x] T010 `dash/src/lib/server/origin.ts` and `dash/src/lib/server/handler.ts`: composable
  `withSession`, `withOrigin`, `callGateway(schema)` (R-01, constitution IX).
- [x] T011 `gateway/src/presentation/app.ts` and `routes/**`: `register*` return the app so
  `createApp` chains them; export `type GatewayRoutes`. No behaviour change: the whole gateway
  suite stays green.
- [x] T012 `dash/src/lib/server/gateway.ts`: `hc<GatewayRoutes>` with the admin key, a
  10-second timeout, contract parsing and the error mapping of
  `contracts/dashboard-bff.md` (`gateway_unreachable`, `gateway_credentials`, `contract`,
  `gateway`). Route handlers `dash/src/app/api/{health,gateway-health,audit,cost,providers,simulate}/route.ts`;
  each validates its input with the contract schema, logs no body, sets
  `Cache-Control: no-store`.
- [x] T013 `dash/src/lib/api-client.ts` (browser `fetch` of `/api/*`, parsing with the
  contracts and `BffErrorSchema`), `dash/src/lib/schemas.ts` (`data-model.md` §1.3), the
  TanStack Query provider in `dash/src/app/providers.tsx`.
- [x] T014 `gateway/scripts/e2e-gateway.ts`: the real `createApp` with in-memory adapters,
  the default policy, a scripted fake detector (findings keyed by fixture markers), fake
  providers that throw if called, test API keys (a `dashboard` admin key and a client key);
  a control server on `127.0.0.1` with `POST /__e2e/audit`, `POST /__e2e/reset`,
  `POST /__e2e/circuit`, `POST /__e2e/detector` (outage on/off) and `GET /__e2e/requests`.
  `dash/playwright.config.ts` with `webServer` for it and `next start`; Chromium only.
- [x] T015 Unstyled placeholder pages for `/sign-in` and the seven console routes, `/`
  redirecting to `/live`; `dash/README.md`; gates; record; backlog row.

---

## Gate G1: design received

- [ ] **G1** Alex has brought the Claude Design output back and placed it in
  `specs/008-dashboard/design/` with everything `design-brief.md` §9 lists (screens at
  desktop and phone in both themes with their key states, tokens as CSS variables,
  component notes, iconography, `design/README.md` with the project link). Alex ticks this
  box in a commit on `main` (or approves the PR that adds `design/`). **Phases 2–5 and 7–10,
  and the dashboard half of Phase 6, do not start before this box is ticked.**

---

## Phase 2: `T-008-10` — Design tokens, app shell, navigation, shared components (US9 shell)

### Tests first

- [ ] T016 [P] `dash/e2e/shell.spec.ts`:
  - `US9-2` the skip link is the first focusable element; navigation by keyboard; the phone
    navigation Sheet traps and returns focus;
  - `US9-5` light, dark and system apply at once and persist across reloads; no frame
    renders the other theme on load (screenshot of the first paint);
  - `US9-6` at 390×844 the navigation is a menu and there is no horizontal page scroll.
- [ ] T017 [P] `dash/e2e/support/axe.ts` (`@axe-core/playwright`, fails on `serious` or
  `critical`) and `US9-1` for the sign-in page and the empty shell in both themes.

### Implementation

- [ ] T018 Tokens from `design/` into `dash/src/app/globals.css` (Tailwind v4 `@theme`,
  light and dark), fonts, motion durations.
- [ ] T019 shadcn/ui initialised for Tailwind v4; the components the design uses copied into
  `dash/src/components/ui/`.
- [ ] T020 `dash/src/app/(console)/layout.tsx`: sidebar, top bar, gateway status pill
  (`/api/gateway-health`), theme toggle (`next-themes`, `attribute="class"`,
  `defaultTheme="system"`, `suppressHydrationWarning`), operator menu, skip link, toasts;
  `dash/src/app/(auth)/sign-in/page.tsx` and the session-expired dialog as designed.
- [ ] T021 `dash/src/features/shared/`: residency, outcome, action and circuit badges;
  sensitivity indicator; entity chip; fallback marker; money, number and time formatters
  (`dash/test/format.test.ts`: 4 decimals below one cent, grouping, ms/s, UTC day labels);
  region states (loading, empty, error, stale); entry detail drawer. Gates; record (design
  deviations); backlog row.

---

## Phase 3: `T-008-03` — Live traffic (US2)

### Tests first

- [ ] T022 [P] [US2] `dash/test/live-merge.test.ts`: merge by id; order by `startedAt` then
  `id`; cap 100; the overlap window (`since = newest − 5 min`); a late-finishing entry with
  an older `startedAt` is added in place; pause buffer and resume without duplicates
  (US2-4, US2-5, R-05).
- [ ] T023 [US2] `dash/e2e/live-traffic.spec.ts` (entries appended through the control
  port): `US2-1` … `US2-8` as written in the spec; `US9-3` with `reducedMotion: "reduce"`
  rows only fade; `US9-4` the live region text changes at most once per 10 s with a count.
  `US2-7` searches the DOM for every fixture string that is not an audit field.

### Implementation

- [ ] T024 [US2] `dash/src/features/live-traffic/model.ts` (pure merge) and
  `use-live-traffic.ts` (2 s polling, `refetchIntervalInBackground: false`, follow
  `nextCursor` while pages are full, backoff 2→30 s, last-success time).
- [ ] T025 [US2] `dash/src/features/live-traffic/` components (stream header, table, phone
  cards, highlight with Motion and `useReducedMotion`, live region) and
  `dash/src/app/(console)/live/page.tsx`, per the design. Gates; record; backlog row.

---

## Phase 4: `T-008-04` — Policy simulator (US3)

### Tests first

- [ ] T026 [P] [US3] `dash/test/highlight.test.ts`: spans from UTF-16 offsets per message,
  accents and emoji (surrogate pairs), overlapping spans drawn as a union with both labels,
  the text unchanged (US3-5, R-06).
- [ ] T027 [US3] `dash/e2e/simulator.spec.ts`: `US3-1` … `US3-7` as written in the spec.
  `US3-3` toggles the fake detector outage; `US3-6` checks the URL, both storages and the
  dashboard's log output for the typed text after reload.

### Implementation

- [ ] T028 `contracts/src/chat-completion.ts`: export `MAX_BODY_BYTES = 1_048_576`;
  `gateway/src/presentation/app.ts` imports it (no behaviour change).
- [ ] T029 [US3] `dash/src/features/policy-editor/simulator/form.tsx` and `schema.ts`: React
  Hook Form + Zod from `ChatMessageSchema`; optional system message, extra user messages,
  model (default `tamiz-auto`), size limit; Ctrl/Cmd+Enter submits.
- [ ] T030 [US3] Highlighted text, decision flow (five steps, staggered with Motion, the
  deciding step for a block from `blockReason`), chain, provider-receives panel, result meta,
  sample texts; `dash/src/app/(console)/simulator/page.tsx`, per the design. Gates; record;
  backlog row.

---

## Phase 5: `T-008-05` — Audit log (US4)

### Tests first

- [ ] T031 [P] [US4] `dash/test/audit-filters.test.ts`: URL search params ↔ filters through
  `AuditQuerySchema` (without `cursor`, `limit`); invalid values dropped with a notice;
  `from` after `to` refused (US4-3, US4-5).
- [ ] T032 [US4] `dash/e2e/audit-log.spec.ts` (a known set of entries, more than one page):
  `US4-1` … `US4-6` as written in the spec.

### Implementation

- [ ] T033 [US4] `dash/src/features/audit-log/`: filter bar (pickers filled from
  `/api/providers` and `/api/policy` rules; phone Sheet), TanStack Table in manual mode,
  `useInfiniteQuery` on `nextCursor` with "Load older" / "No older entries", the shared
  entry detail; `dash/src/app/(console)/audit/page.tsx`. Gates; record; backlog row.

---

## Phase 6: `T-008-08` — Policy editor and the gateway policy endpoints (US5)

The gateway half (T034–T040) does not depend on G1 and may land first in this PR.

### Tests first

- [ ] T034 [P] [US5] `contracts/test/policy-admin.test.ts`: `ActivePolicySchema`,
  `ReplacePolicyRequestSchema` (`baseVersion: z.int().min(1)`), `contentHash` 64 hex,
  `savedAt`/`savedBy` nullable; `contracts/replace-policy.example.json` of the spec parses;
  the envelope's optional `issues` and `errorTypeToHttpStatus.conflict === 409`.
- [ ] T035 [P] [US5] `gateway/test/admin/policy-route.test.ts` (in-process HTTP, in-memory
  repository): `US5-1` the GET shape for a file policy; `US5-3` each cross-field failure
  (undeclared target, duplicate rule id, unconfigured provider) → 400 with paths and no
  change; `US5-4` version = base + 1, the next `/v1/simulate` and the next chat completion's
  audit entry carry it; `US5-5` stale base → 409 `conflict`; `US5-6` client key 403, none
  401; `US5-8` other id → 400 `policy.id`; one `policy.replaced` log line without the
  document; OpenAPI components present.
- [ ] T036 [P] [US5] `gateway/test/persistence/policy-repository.test.ts` (Testcontainers):
  two concurrent `replace` on the same base → exactly one wins, the other `conflict`
  (`US5-5`); boot uses the newest stored version unless the file's version is higher, which
  is then recorded (`US5-7`); rows are never updated.

### Implementation (gateway)

- [ ] T037 `contracts/src/error.ts` (`conflict`, `issues: Array<{ path: string; message:
  string }>` optional), `contracts/src/policy-admin.ts`, `index.ts` exports.
- [ ] T038 `gateway/src/application/ports/policy-repository.port.ts` (`getActiveVersion`,
  `replace`), `ConflictError` in `domain/errors.ts`, use cases
  `application/use-cases/{get-active-policy,replace-policy}.ts` (R-10 steps 1–6, provider
  check injected).
- [ ] T039 `gateway/src/infrastructure/policy/{in-memory,postgres}-policy-repository.ts`,
  `infrastructure/persistence/schema.ts` (`policy_versions`, `data-model.md` §2.4) and the
  generated `drizzle/0001_policy_versions.sql`; `main.ts` boot selection and wiring;
  `@tamiz/test-utils` in-memory repository updated.
- [ ] T040 `gateway/src/presentation/routes/admin/policy.ts` (`GET`, `PUT`, checks in the
  order of `contracts/gateway-policy.md`), `openapi-schemas.ts`, `app.ts`;
  `gateway/README.md`.

### Tests first (dashboard, after G1)

- [ ] T041 [P] [US5] `dash/test/yaml-issues.test.ts`: YAML → `RoutingPolicySchema` issues →
  lines through `LineCounter`; YAML syntax errors as issues at their line (US5-2).
- [ ] T042 [US5] `dash/e2e/policy-editor.spec.ts`: `US5-1` header with source, version and
  the not-persistent warning (E2E gateway without a database); `US5-2` issues within 1 s
  and save disabled; `US5-3` gateway issues listed after a refused save; `US5-4` save →
  "version N+1", then the simulator shows the new version; `US5-5` conflict dialog after a
  version bump made through the API; `US5-7` the warning text.

### Implementation (dashboard, after G1)

- [ ] T043 [US5] `dash/src/app/api/policy/route.ts` (`GET`, `PUT` with origin check);
  `dash/src/features/policy-editor/editor/` (CodeMirror 6 YAML with lint gutter, 300 ms
  debounced shape check, issue list, action bar, conflict dialog, unsaved-changes guard,
  in-place session-expired dialog); `dash/src/app/(console)/policy/page.tsx`, per the
  design. Gates; record; backlog row.

---

## Phase 7: `T-008-07` — Eval results (US6)

### Tests first

- [ ] T044 [P] [US6] `dash/test/evals-dir.test.ts`: reads `*.json` from a temporary folder,
  parses with `EvalReportSchema`, lists invalid files with an issue summary, sorts by
  `run.startedAt` descending, groups by `run.policy` with "unknown policy" (US6-4, US6-5).
- [ ] T045 [US6] `dash/e2e/evals.spec.ts` with fixtures in `dash/e2e/fixtures/evals/`
  (passing, failing with more than 50 cases, error and skipped, invalid, and an empty
  folder): `US6-1` … `US6-6` as written in the spec.

### Implementation

- [ ] T046 [US6] `dash/src/lib/server/evals.ts`, `dash/src/app/api/evals/route.ts`;
  `dash/src/features/eval-results/` (run header, eval cards, metrics with thresholds,
  failing cases, history, unreadable notice); `dash/src/app/(console)/evals/page.tsx`;
  `dash/data/evals/` snapshot of the CI report of run 41187796710. Gates; record; backlog
  row.

---

## Phase 8: `T-008-11` — Provider health (US8)

- [ ] T047 [US8] `dash/e2e/providers.spec.ts` (circuit opened through the control port):
  `US8-1` … `US8-3` as written in the spec.
- [ ] T048 [US8] `dash/src/features/provider-health/` (window picker, target rows or cards,
  countdown from `cooldownRemainingMs` and `generatedAt`, 10 s refetch);
  `dash/src/app/(console)/providers/page.tsx`. Gates; record; backlog row.

---

## Phase 9: `T-008-06` — Cost analytics (US7, cuttable)

- [ ] T049 [P] [US7] `dash/test/cost-view.test.ts`: saving and percent from a report;
  `baseline: null` → unavailable, never zero; range presets in UTC (US7-4).
- [ ] T050 [US7] `dash/e2e/cost.spec.ts` (entries seeded through the control port; the
  expected totals read from the E2E gateway's `GET /v1/admin/cost`): `US7-1` … `US7-6` as
  written in the spec.
- [ ] T051 [US7] `dash/src/features/cost-analytics/` (controls, KPI cards, shadcn Chart with
  series told apart by more than colour, breakdown table, baseline note);
  `dash/src/app/(console)/cost/page.tsx`. Gates; record; backlog row.

---

## Phase 10: `T-008-09` — Container, CI, accessibility sweep, polish

- [ ] T052 `dash/e2e/accessibility.spec.ts`: every screen with data and in its empty and
  error states, light and dark, 1280×800 and 390×844 → `US9-1` no serious or critical
  violations; `US9-2` keyboard walk of each screen's controls; `US9-6` no horizontal scroll
  and every action reachable on phone width.
- [ ] T053 `dash/e2e/key-leak.spec.ts` extended to every finished screen, a simulation and a
  policy save (`US1-3`, SC-003).
- [ ] T054 `dash/Dockerfile` (multi-stage, `node:22-alpine`, standalone output, user `node`,
  read-only root except `/tmp`, healthcheck `GET /api/health`), `.dockerignore`;
  `docker-compose.yml` gains `dashboard` (port 3100, depends on `gateway`); a test that starts
  the built server with a missing variable and expects a non-zero exit listing it (`US1-6`).
- [ ] T055 `.github/workflows/ci.yml`: job `e2e` (build, Playwright Chromium, the E2E
  gateway, `next start`, traces and screenshots uploaded on failure; under 10 minutes,
  SC-006) and `docker build` of the dashboard in `ci`.
- [ ] T056 Polish: `README.md` (dashboard section, status 008), `docs/architecture.md`
  (dashboard and BFF in the system view), `CLAUDE.md` §12 (dashboard commands), the
  quickstart run recorded; gates; record; backlog row.

## Dependencies

```text
T-008-02 ─▶ G1 ─▶ T-008-10 ─┬─▶ T-008-03 ─┐
                            ├─▶ T-008-04 ─┼─▶ T-008-08 (dashboard half) ─┐
                            ├─▶ T-008-05 ─┤                              │
                            ├─▶ T-008-07 ─┤                              ├─▶ T-008-09
                            ├─▶ T-008-11 ─┤                              │
                            └─▶ T-008-06 ─┘──────────────────────────────┘
T-008-08 (gateway half) has no dependency inside the feature and may start at any time.
```

Within a phase: tests first, then implementation; `[P]` tasks touch different files.

## Totals

| Phase | Backlog | Tasks |
|---|---|---|
| 1 | `T-008-02` | T001–T015 (15) |
| G1 | design received | 1 gate |
| 2 | `T-008-10` | T016–T021 (6) |
| 3 | `T-008-03` | T022–T025 (4) |
| 4 | `T-008-04` | T026–T030 (5) |
| 5 | `T-008-05` | T031–T033 (3) |
| 6 | `T-008-08` | T034–T043 (10) |
| 7 | `T-008-07` | T044–T046 (3) |
| 8 | `T-008-11` | T047–T048 (2) |
| 9 | `T-008-06` | T049–T051 (3) |
| 10 | `T-008-09` | T052–T056 (5) |
| **Total** | | **56 + G1** |

## Implementation strategy

- **While the design is being made.** `T-008-02` (plumbing, sign-in, BFF, E2E harness) and
  the gateway half of `T-008-08` need no design and can land first.
- **MVP for the demo.** After G1: `T-008-10` → `T-008-03` (live traffic) → `T-008-04`
  (simulator, the README GIF) → `T-008-09`. That is a shippable dashboard.
- **Then** the audit log, evals, policy editor and provider health; cost last, because the
  cut order cuts it first.
