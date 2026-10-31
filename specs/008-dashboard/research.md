# Research: Dashboard

**Feature**: `008-dashboard` · **Date**: 2026-10-31

Decisions taken for the plan. Each one names what was chosen, why, and what else was
considered. The ones flagged **(review)** are listed in the `T-008-01` task record for
Alex.

## R-01 A backend-for-frontend inside the dashboard holds the admin key

**Decision**:
- **Boundary.** The browser talks only to the dashboard's own route handlers under
  `app/api/*`. Each handler maps to exactly one gateway call (FR-003):

  | Dashboard endpoint | Gateway call |
  |---|---|
  | `GET /api/audit` | `GET /v1/admin/audit` |
  | `GET /api/cost` | `GET /v1/admin/cost` |
  | `GET /api/providers` | `GET /v1/admin/providers` |
  | `POST /api/simulate` | `POST /v1/simulate` |
  | `GET /api/policy` | `GET /v1/admin/policy` |
  | `PUT /api/policy` | `PUT /v1/admin/policy` |
  | `GET /api/gateway-health` | `GET /health` |
  | `GET /api/evals` | none: reads the reports folder (R-09) |

- **Key.** The admin key lives in `TAMIZ_DASHBOARD_ADMIN_KEY`, read by
  `src/lib/server/env.ts`; the gateway client is `src/lib/server/gateway.ts`. Both start with
  `import "server-only"`, so importing them from a client component fails the build.
- **Data fetching.** Client components use TanStack Query against `/api/*`. Server
  components never pass gateway data with secrets to the client; they pass nothing secret
  because the key is never in a return value.
- **Logging.** The handlers log method, endpoint, status, duration and the gateway's
  `x-request-id`; never a body (FR-014).

**Rationale**: the key must never be in the browser (FR-002). A fixed allow-list keeps the
dashboard from becoming an admin proxy anyone with a session cookie can aim at any gateway
path.

**Alternatives**:
- calling the gateway from the browser with a key per operator: the gateway has no operator
  identities, and every browser would hold an admin key;
- a generic `/api/gateway/[...path]` proxy: less code, but it would expose every current and
  future admin endpoint;
- Server Actions for reads: they are POST-only and do not cache; route handlers fit
  TanStack Query's polling and caching.

## R-02 The gateway client is `hc` typed by the gateway's route type, and responses are parsed by the contracts **(review)**

**Decision**:
- **Typing.** `T-008-02` changes the gateway's `register*` functions to return the app they
  extend, so `createApp` chains them and exports
  `type GatewayRoutes = ReturnType<typeof buildRoutes>`. The dashboard imports it with
  `import type` from `@tamiz/gateway` (a `devDependency`, type-only: no gateway code is
  bundled) and builds `hc<GatewayRoutes>(TAMIZ_GATEWAY_URL)`.
- **Parsing.** Every response is still parsed with the `@tamiz/contracts` schema
  (`AuditPageSchema`, `SimulateResponseSchema`, …) before it leaves the BFF (FR-006). A
  mismatch answers `502 { error: { type: "contract", endpoint, issues: [paths] } }` to the
  browser and logs the paths, never the body.

**Rationale**: `GatewayApp` is `OpenAPIHono<AppEnv>` today, and routes are registered by
`void` functions, so `hc<GatewayApp>` knows no routes. Chaining is a small mechanical
change. Types catch drift at build time; parsing catches it at run time when the gateway is
a different version from the dashboard (edge case "version skew").

**Alternatives**:
- a hand-written `fetch` client with Zod parsing only: works, but drops the stack choice
  (`hc`) of the foundational document and checks request shapes only at run time;
- generating a client from `/openapi.json`: adds a code-generation step the project avoids.

## R-03 Operator sign-in: one passphrase, server-side sessions **(review)**

**Decision**:
- **Credential.** `TAMIZ_DASHBOARD_PASSPHRASE_HASH` holds an scrypt hash
  (`scrypt$N$r$p$salt$hash`, Node `crypto.scrypt`), produced by
  `pnpm --filter @tamiz/dashboard hash-passphrase`. Comparison uses `timingSafeEqual`.
- **Sessions.** A random 32-byte session id in a cookie `tamiz_session`: `HttpOnly`,
  `Secure` (except on `localhost`), `SameSite=Strict`, `Path=/`, signed with HMAC-SHA-256
  under `TAMIZ_DASHBOARD_SESSION_SECRET` (≥ 32 bytes). The server keeps the ids in an
  in-memory map with an absolute expiry of 8 hours (FR-001). Sign-out deletes the id, so a
  copied cookie stops working (US1-4).
- **Rate limit.** 5 failures per minute per client address (the socket address, or the
  first `X-Forwarded-For` hop when `TAMIZ_DASHBOARD_TRUST_PROXY=true`), in memory.
- **Gate.** Next.js 16 `proxy.ts` (the former `middleware.ts`) redirects pages without a
  valid cookie signature to `/sign-in`; each route handler checks the session in the store
  (the proxy cannot see the in-memory map) and answers `401` before calling the gateway
  (US1-1).
- **Restart.** A dashboard restart signs every operator out. That is acceptable for one
  instance.

**Rationale**: the audience is a small team self-hosting; a shared operator passphrase is
the least machinery that keeps an exposed dashboard from being an open admin console. All
signed-in operators are admins of the gateway (spec Assumptions).

**Alternatives**:
- no sign-in, rely on network isolation: one misconfigured reverse proxy publishes the
  admin API;
- Auth.js with an identity provider: right for larger teams, but it adds a provider, a
  database adapter and a configuration surface for a portfolio-sized console; it can replace
  the passphrase later behind the same session check;
- stateless signed cookies (JWT): no server state, but sign-out could not revoke a copied
  cookie.

## R-04 Cross-origin writes are refused by `Origin`, plus `SameSite=Strict`

**Decision**: every non-GET route handler compares the `Origin` header (or `Referer` when
`Origin` is absent) with `TAMIZ_DASHBOARD_PUBLIC_URL`'s origin and answers `403` on a
mismatch or when both are absent, before reading the body (US1-5, FR-004).

**Rationale**: `SameSite=Strict` already stops the cookie on cross-site requests in current
browsers; the `Origin` check covers older ones and same-site subdomains, with no token to
thread through forms.

**Alternatives**: a double-submit CSRF token: more moving parts for the same protection
here.

## R-05 Live traffic polls with an overlap window and deduplicates by id

**Decision**:
- **Query.** Every 2 seconds, `GET /api/audit?from=<since>&limit=200`, where `since` is the
  newest `startedAt` seen minus an overlap of 5 minutes (the longest plausible request
  deadline), on the first poll `now − 5 min`. The BFF follows `nextCursor` while pages are
  full, so a burst is not truncated.
- **Merge.** Entries are merged into a map by `id`; the view is the newest 100 by
  `startedAt` (then `id`). New ids are marked for a short highlight.
- **Why the overlap.** Entries are written when the request ends, but ordered and filtered
  by `startedAt`. A long request that started before an already shown short one would be
  missed by `from = newest startedAt` (US2-5).
- **Pause.** While paused, polling continues into a pending buffer and the counter shows its
  size; resume merges it (US2-4). TanStack Query does not poll hidden tabs
  (`refetchIntervalInBackground: false`); the overlap window makes the catch-up exact when
  the tab returns within 5 minutes, and beyond that the screen says older entries are in the
  audit log.
- **Failure.** Failed polls back off (2, 4, 8, … up to 30 s) and show the last success time
  (US2-6).

**Rationale**: no gateway change, exact deduplication, and bounded load (one indexed query
every 2 seconds per open screen).

**Alternatives**:
- server-sent events from the gateway: lower latency, but a new long-lived endpoint, a
  fan-out from the async audit writer and reconnection logic, for a 2-second gain the demo
  does not need;
- ordering by `endedAt`: would need a new audit index and query parameter.

## R-06 Simulator: one form schema from the contracts, highlighting by UTF-16 offsets

**Decision**:
- **Form.** React Hook Form with a Zod resolver over a form schema built from
  `ChatMessageSchema`: an optional system message, one or more user messages, the requested
  model (default `tamiz-auto`, the evals' default), a total size check against the gateway's
  body limit (`MAX_BODY_BYTES`, 1 MiB, exported to the contracts in `T-008-04`). Errors show
  next to the field (US3-4).
- **Highlighting.** The response's offsets are UTF-16 indices into each message's `content`
  (`SimulatedEntitySchema`); JavaScript strings are UTF-16, so `content.slice(start, end)`
  is exact for accents and emoji (US3-5). Overlapping spans are drawn as the union with both
  labels. Highlighting renders spans over the read-only copy of the submitted text, never
  modifying it.
- **Privacy.** The form state lives in React state only: no `localStorage`, no query string,
  no analytics; the BFF logs no body (US3-6, FR-014).
- **Decision flow.** A fixed sequence of five steps (inspection → classification → rule →
  action → chain), each with its value; for `block`, the deciding step is marked from
  `blockReason` (`detector_unavailable` → inspection, `action` → action, `no_target` →
  chain) (US3-7).

**Rationale**: one schema source, exact offsets with no conversion, nothing persisted.

**Alternatives**: a contenteditable input with inline highlights: attractive, but caret and
IME handling get fragile and highlights could alter the text.

## R-07 Audit log: URL-held filters, infinite query on the keyset cursor

**Decision**:
- **Filters** are the fields of `AuditQuerySchema` except `cursor` and `limit`, held in the
  URL search params (shareable, US4-3) and parsed with the same schema; an invalid value is
  dropped with a notice. The route and rule pickers are filled from `/api/providers` (target
  ids) and `/api/policy` (rule ids).
- **Paging.** TanStack Query `useInfiniteQuery` with `nextCursor`; a "Load older" button
  (no page numbers, no total count: the gateway does not count). It disables itself with
  "No older entries" when `nextCursor` is `null` (US4-2).
- **Table.** TanStack Table in manual mode (no client-side sort; the gateway's order is the
  order), one row per entry, activation opens the shared entry detail (US4-6).

**Rationale**: keyset paging cannot jump to page N, so a "load older" list is the honest
control.

**Alternatives**: numbered pages: would need offset queries the gateway deliberately does
not offer.

## R-08 Cost and provider health read the aggregates as they are

**Decision**:
- **Cost.** Presets (last 7 days, last 30 days, this month) and a custom range; groupBy
  `day` | `route` | `model`. The chart is a shadcn Chart (Recharts): grouped bars of actual
  vs baseline per key, distinguished by colour and pattern or label (US7-6). Totals come
  from `totals` and are not recomputed (US7-1). Saving = `baselineCostUsd − costUsd`,
  percent = saving / baseline, shown as unavailable when `baseline` is `null` (US7-4).
- **Providers.** Window picker 5 / 15 / 60 minutes; refetch every 10 seconds; the cool-down
  counts down locally from `cooldownRemainingMs` and `generatedAt` between refetches
  (US8-2).

**Rationale**: the gateway already tests these aggregates against SQL; the dashboard only
formats.

## R-09 Eval reports are files in a folder the dashboard reads **(review)**

**Decision**:
- `TAMIZ_DASHBOARD_EVALS_DIR` (default `./data/evals`) holds `*.json` reports. `GET /api/evals`
  lists them, parses each with `EvalReportSchema`, and answers
  `{ reports: [{ file, report }], unreadable: [{ file, issue }] }` sorted by
  `run.startedAt` descending (US6-4, US6-5).
- Reports arrive by downloading the CI artifact:
  `gh run download <run-id> -n evals-report -D <dir>` (the quickstart shows it). The demo
  deployment ships a committed snapshot under `apps/dashboard/data/evals/`.
- The history groups runs by `run.policy` (`id`, `version`); a report without `policy`
  is grouped as "unknown policy".

**Rationale**: the report is already a validated file artifact; the gateway has no reason to
serve CI output, and a folder needs no new endpoint.

**Alternatives**:
- `GET /v1/admin/evals` in the gateway: couples the runtime gateway to CI artifacts;
- fetching artifacts from the GitHub API at run time: needs a GitHub token in the dashboard
  and fails offline.

## R-10 The gateway gets a replaceable policy store, persisted in PostgreSQL when configured **(review)**

**Decision**:
- **Port.** `PolicyRepositoryPort` gains `getActiveVersion()` (policy plus metadata: source
  `file` | `store`, `savedAt`, `savedBy`, `contentHash`, `persistent`) and
  `replace(policy, meta, baseVersion)` returning `Result<PolicyVersion, "conflict">`.
  `getActive()` stays as it is, so every use case keeps reading the active policy per
  request and sees a save at once (FR-017, US5-4).
- **Use case.** `ReplacePolicy` (application):
  1. refuse a different `id` (US5-8);
  2. set `version = baseVersion + 1`;
  3. `validatePolicy` (domain, cross-field rules);
  4. the injected provider check (the boot check `checkProviderSettings`, passed in as a
     function by `main.ts`);
  5. `replace`, which refuses when the active version is not `baseVersion` (US5-5);
  6. log `policy.replaced` with id, version, admin client id and content hash (never the
     document; FR-017).
- **Adapters.**
  - in memory (no `DATABASE_URL`): `persistent: false`; the editor warns (US5-7);
  - PostgreSQL: an append-only table `policy_versions` with a unique `(policy_id, version)`.
    `replace` inserts in a transaction that checks the current maximum version equals
    `baseVersion`, so two gateways sharing the database cannot both win.
- **Boot.** With persistence, the gateway loads the file, then the newest stored version for
  the file's policy id; it uses the stored one when its version is greater than or equal to
  the file's, otherwise the file (a hand-edited file with a higher version wins and is
  recorded as a version). Either way the boot line names the source.

**Rationale**: an editor whose saves vanish on restart surprises operators; the audit log
already lives in PostgreSQL, so history goes there too. The port gains a method because a
second adapter (PostgreSQL) needs it, and the use cases already depend on the port
(constitution X).

**Alternatives**:
- writing the YAML file back: containers run read-only and non-root, and concurrent writes
  need locking;
- memory only: simplest, but a restart silently reverts the policy;
- hot-reloading the file on change: a different feature (operators edit files), and still
  no conflict detection.

## R-11 Validation issues and conflicts in the error envelope **(review)**

**Decision**:
- `ErrorEnvelopeSchema` gains an optional `issues: [{ path: string, message: string }]`
  (path in dot form, `rules.2.route.0`), filled for policy validation failures. Existing
  answers are unchanged (the field is optional).
- `ErrorTypeSchema` gains `conflict` → `409`, used by `PUT /v1/admin/policy` when the base
  version is stale (US5-5).
- The domain's `validatePolicy` issues already carry paths (the boot loader prints them);
  the route maps them to `issues` as they are.

**Rationale**: the editor must show each issue at its path (US5-2, US5-3) for both the
browser-side shape check and the gateway's cross-field check; one shape for both.

**Alternatives**: a dedicated 422 body for the policy endpoint: a second error shape for
clients to handle.

## R-12 The policy editor is CodeMirror 6 over YAML **(review)**

**Decision**:
- **Editor.** CodeMirror 6 (`@codemirror/view`, `@codemirror/lang-yaml`, through a thin React
  wrapper) with line numbers, a lint gutter, and keyboard access (it is a contenteditable
  with a documented accessibility model; `Esc` then `Tab` leaves the editor).
- **Shape check while typing.** Debounced 300 ms: `yaml.parseDocument` → `toJS` →
  `RoutingPolicySchema.safeParse` (the same schema as the gateway). Each issue's path is
  mapped to a line through the document's node ranges (`LineCounter`), shown in the gutter
  and in an issue list that is also the accessible summary (US5-2, FR-018).
- **Save.** `PUT /api/policy` with `{ baseVersion, policy }` (JSON, parsed from the YAML).
  The gateway's `issues` (R-11) go to the same list (US5-3).
- **Formatting.** Load shows `yaml.stringify` of the active policy; comments of the original
  file are not preserved (the gateway stores the parsed document).

**Rationale**: policies are YAML files; operators should edit what they know. CodeMirror 6
is small, modular and works on mobile; issue-to-line mapping needs a real YAML parser.

**Alternatives**:
- Monaco: heavy (several MB), weak on mobile;
- a structured form editor: safer but large, and it hides the file format the docs use;
- a plain `textarea`: no line mapping for issues.

This adds CodeMirror 6 and `yaml` to the dashboard stack, which `CLAUDE.md` §4 does not list.

## R-13 Browser flows run against the real gateway app with fakes

**Decision**:
- **E2E gateway.** `apps/gateway/scripts/e2e-gateway.ts` builds the real `createApp` with
  in-memory adapters (audit log, policy store, circuit state), the default policy, a
  scripted fake detector (findings keyed by fixture text markers) and providers that are
  never called by the screens. It also opens a control server on a second port, bound to
  `127.0.0.1`, with `POST /__e2e/audit` (append entries), `POST /__e2e/reset`, and
  `GET /__e2e/requests` (the `Authorization` header of each received call, for US1-3).
  The control server exists only in this script.
- **Dashboard.** Playwright `webServer` starts the E2E gateway and `next start` on a
  production build with test env values.
- **Accessibility.** `@axe-core/playwright` on every screen, light and dark, at 1280×800 and
  390×844; violations of impact `serious` or `critical` fail (US9-1, SC-004).
- **Key search (US1-3).** The test records every response (`page.on("response")`: headers
  and body), the cookies and `localStorage`/`sessionStorage`, and searches them for the key.
- **Naming.** Each test title starts with its scenario id (`US3-1 …`), so the coverage table
  can be checked with `grep`.
- **CI.** A third job `e2e` in `.github/workflows/ci.yml` (`T-008-09`) with the Playwright
  Chromium image; traces and screenshots uploaded on failure.

**Rationale**: the real app guarantees the screens see real contract answers (including the
new policy endpoints); the fakes keep it offline and deterministic (constitution VIII).

**Alternatives**:
- MSW: it intercepts in the process that fetches; here the fetches happen in the Next.js
  server process started by Playwright, which MSW cannot reach from the test;
- a hand-written fake gateway with fixture JSON: drifts from the real contract.

Unit and component tests (Vitest, Testing Library, jsdom) cover the pure parts: the merge
and deduplication of live traffic, span highlighting, issue-path-to-line mapping, formatting,
session and origin checks.

## R-14 Themes, motion and live announcements

**Decision**:
- **Themes.** `next-themes` with `attribute="class"`, `defaultTheme="system"`,
  `disableTransitionOnChange`; `suppressHydrationWarning` on `<html>` so there is no flash
  (US9-5). Tokens are CSS variables in Tailwind v4's `@theme`, from the received design.
- **Motion.** Motion's `useReducedMotion`; with reduced motion the row arrival and panel
  transitions become opacity-only (US9-3).
- **Announcements.** One `aria-live="polite"` region in live traffic, updated at most every
  10 seconds with "N new requests" (US9-4).
- **Colour.** Every status (route badge, circuit, pass/fail, outcome) has a word and an icon
  besides colour (FR-020).

## R-15 The design gate

**Decision**:
- `design-brief.md` is the hand-off: the inventory of screens and components with their
  data, states, responsive behaviour and stack. Alex takes it to Claude Design.
- What comes back goes to `specs/008-dashboard/design/`: the exported screens per screen and
  breakpoint, the token set (colour, type, spacing, radius, shadow) and any component notes.
  A link to the Claude Design project is recorded in `design/README.md`.
- **Gate `G1`** in `tasks.md`: no task that renders UI starts until `design/` exists and
  Alex has ticked `G1`. The backlog row `T-008-10` (added by this spec) implements the
  tokens, the app shell, navigation and the theme toggle from the design; every screen task
  depends on it.
- **Non-visual work** of `T-008-02` (the Next.js app, the BFF, sign-in logic, the API
  client, Playwright, Turbo) does not wait for the design; its pages are unstyled
  placeholders.

**Rationale**: Alex's rule: screens are designed in Claude Design, not in code. Splitting the
skeleton lets the plumbing land while the design is being made.

## R-16 Container and configuration

**Decision**:
- **Build.** Next.js `output: "standalone"`; multi-stage Dockerfile (`node:22-alpine`, pnpm
  `deploy` of the dashboard), runs as `node` (uid 1000), port `3100`, read-only root file
  system except `/tmp`; healthcheck `GET /api/health` (the dashboard itself, no gateway).
- **Environment** (Zod at start, FR-005): `TAMIZ_GATEWAY_URL`, `TAMIZ_DASHBOARD_ADMIN_KEY`,
  `TAMIZ_DASHBOARD_PASSPHRASE_HASH`, `TAMIZ_DASHBOARD_SESSION_SECRET`,
  `TAMIZ_DASHBOARD_PUBLIC_URL`, optional `TAMIZ_DASHBOARD_EVALS_DIR`,
  `TAMIZ_DASHBOARD_TRUST_PROXY`. Secrets are never echoed in error messages.
- **Admin key.** A key for client `dashboard` with role `admin`, created with the existing
  `api-key:add dashboard --admin` or `TAMIZ_ADMIN_API_KEYS`.
- **Compose.** `docker-compose.yml` gains `dashboard` (`T-008-09`).

**Rationale**: matches the gateway and privacy images (non-root, multi-stage) and the
delivery plan.
