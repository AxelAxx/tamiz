# T-008-02 — Dashboard non-visual skeleton: app, sign-in, BFF, E2E harness

| Field | Value |
|---|---|
| Task | `T-008-02` (see `docs/tasks/BACKLOG.md`) |
| Feature | `008-dashboard` |
| Spec | `specs/008-dashboard/spec.md` (Phase 1 of `tasks.md`: T001–T015) |
| Branch / PR | `T-008-02-dashboard-skeleton`, cut from `main` at c4d62b5 / PR opened after this commit |
| Date | 2026-10-31 |
| Session | Claude Code (Claude Opus 5.5), side session |
| Status | done |

## What was done

`apps/dashboard` is now `@tamiz/dashboard`, a Next.js 16 app with no designed UI:

- **Configuration** (FR-005, US1-6): a Zod schema for the seven variables of data-model
  §3.3; `instrumentation.ts` validates it at start and exits listing every problem, never a
  value.
- **Operator sign-in** (FR-001, US1-2, US1-4): scrypt passphrase hash
  (`scrypt$N$r$p$salt$hash`, constant-time compare), in-memory sessions signed with
  HMAC-SHA-256, 8 hours absolute, revoked on sign-out; 5 failures per minute per address,
  then 60 s of `429` with `Retry-After`; `hash-passphrase` script (stdin only).
- **Page gate**: `src/proxy.ts` (Next.js 16) checks the cookie signature and redirects to
  `/sign-in`; every data endpoint checks the session store (US1-1).
- **BFF** (FR-002 … FR-004, FR-006): composable `withNoStore`, `withOrigin`, `withSession`
  and `callGateway(schema)`; handlers `session`, `health`, `gateway-health`, `audit`, `cost`,
  `providers`, `simulate`. Each validates its input with the contract, calls one gateway
  endpoint with the admin key and a 10 s timeout, parses the answer with the contract and
  maps errors as `contracts/dashboard-bff.md` lists.
- **Gateway refactor** (R-02): the `register*` functions return the app they extend,
  `createApp` chains them in `registerRoutes`, and `type GatewayRoutes` is exported
  (`@tamiz/gateway/routes`, type-only). No behaviour change: the whole gateway suite stays
  green.
- **Typed client**: `hc<GatewayRoutes>` on the server; `src/lib/api-client.ts` in the
  browser (parses answers and `BffErrorSchema`); TanStack Query provider.
- **E2E harness** (R-13): `apps/gateway/scripts/e2e-gateway.ts` (real `createApp`, in-memory
  adapters, default policy, a fake detector keyed by synthetic markers, providers that
  throw, test keys) with a control server on `127.0.0.1`; `playwright.config.ts` starts it
  and `next start`, Chromium only.
- **Placeholders**: `/sign-in`, the seven console routes and `/` → `/live`, plain text, plus
  a plain-text gateway status read through TanStack Query.

## Files touched

- `apps/gateway/src/presentation/app.ts`, `routes/**` — chained registration, `GatewayRoutes`.
- `apps/gateway/package.json` — `exports["./routes"]` (types → `src/presentation/app.ts`),
  `e2e-gateway` script.
- `apps/gateway/scripts/e2e-gateway.ts` — the E2E gateway and its control port.
- `apps/gateway/test/routes-type.test.ts` — T004.
- `apps/gateway/README.md` — the route type and the E2E gateway.
- `apps/dashboard/**` — the app (see its `README.md`), tests T001–T003 plus `handler` and
  `gateway` unit tests, `e2e/auth.spec.ts` (T005), `e2e/key-leak.spec.ts` (T006).
- `turbo.json` — `.next/**` build outputs (cache excluded), `e2e` task.
- `pnpm-lock.yaml`.
- `specs/008-dashboard/tasks.md` — T001–T015 ticked.

## Decisions

- **Versions** (checked against the npm registry and Context7 on 2026-10-31, pinned exactly):
  `next` 16.4.3, `react`/`react-dom` 19.3.1, `@tanstack/react-query` 5.105.0,
  `@playwright/test` 1.64.1, `@types/react`/`@types/react-dom` 19.3.0, `jsdom` 30.1.3,
  `server-only` 0.0.1. `hono` and `zod` use the same ranges as the gateway, so one copy is
  installed and the `hc` types line up.
- **Only the dependencies this phase uses.** Tailwind, shadcn/ui, Motion, React Hook Form,
  TanStack Table, Recharts, next-themes and Testing Library arrive with the task that first
  uses them (`T-008-10` onwards), not here (constitution X). `plan.md` lists them for the
  feature.
- **`GatewayRoutes` comes from the gateway's source**, not a build: the `exports` entry
  points `types` at `src/presentation/app.ts`. The dashboard's `tsc` therefore type-checks
  that slice of the gateway with the dashboard's options (same strict base). The gateway's
  `dist/` has no declarations and emitting them would need more work; no runtime code is
  imported.
- **`createApp` still returns `GatewayApp`**; only the type of the chain is exported, so no
  test or caller changed.
- **Rate-limit address (deviation from R-03).** Next.js route handlers do not expose the
  socket address, and Next.js keeps a client-sent `X-Forwarded-For` (it only fills the
  header when absent: `base-server.js`, `x-forwarded-for ??= socket.remoteAddress`). So:
  - with `TAMIZ_DASHBOARD_TRUST_PROXY=true`, the first `X-Forwarded-For` hop;
  - otherwise every attempt shares one bucket (`"direct"`). A forged header cannot escape
    the limit; the cost is that a flood of wrong passphrases locks every operator out for
    a minute. Behind a reverse proxy, set the variable to `true`.
- **Two BFF error types added** to `BffErrorSchema` (dashboard-only, data-model §1.3):
  `invalid_request` (400, a request that fails its contract before the gateway is called,
  which `dashboard-bff.md` requires but the enum lacked) and `rate_limited` (429).
- **`POST /api/session` checks the origin** too (it is a non-GET endpoint per the contract),
  which also stops login CSRF.
- **Session cookie**: `HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`, plus `Secure`
  unless the public URL's host is `localhost`, `127.0.0.1` or `[::1]`.
- **Server state lives on `globalThis`** (`lib/server/context.ts`): route handlers can be
  bundled apart, and a session created by one must be seen by all.
- **No `.js` suffixes in dashboard imports**: Turbopack does not map `./x.js` to `x.ts`
  (the build fails with "module not found"), unlike `tsc` with NodeNext in the other
  packages.
- **The E2E dashboard runs `next start`.** Next.js warns that `next start` "does not work"
  with `output: "standalone"`, but it serves correctly; the standalone server needs
  `.next/static` copied next to it, which is the Dockerfile's job (`T-008-09`).
- **E2E with `TAMIZ_DASHBOARD_TRUST_PROXY=true`**, so the rate-limit test's lock-out
  (its own `X-Forwarded-For`) does not lock the other tests out.
- **US1-1 covers the endpoints that exist**: `/api/policy` and `/api/evals` arrive with
  `T-008-08` and `T-008-07`, whose tests should add them to `DATA_ENDPOINTS` in
  `e2e/support/fixtures.ts` (US1-1 and the key search then cover them).
- **The E2E fake detector** never caches, so an outage toggled after a clean answer is
  still seen (`T-008-04`, US3-3).

## How it was verified

```bash
pnpm lint        # exit 0 (2 pre-existing unused-import warnings in other packages)
pnpm typecheck   # 8 successful
pnpm arch        # ✔ no dependency violations found (124 modules, 441 dependencies cruised)
pnpm build       # dashboard: 9 dynamic API routes, 9 static pages, Proxy
pnpm test        # Test Files 106 passed; Tests 1057 passed | 27 skipped
pnpm --filter @tamiz/dashboard e2e
#   ok US1-1 without a session every page redirects to sign-in and every data endpoint answers 401
#   ok US1-2 the right passphrase lands on live traffic; a wrong one says so
#   ok US1-2 the sixth failure in a minute is refused with 429 and Retry-After
#   ok US1-4 sign-out ends the session and the old cookie stops working
#   ok US1-5 cross-origin writes are refused and nothing reaches the gateway
#   ok US1-3 the admin key reaches the gateway on every call and the browser never sees it
#   6 passed (9.3s)
```

Manual: `next start` with `TAMIZ_GATEWAY_URL` unset and a malformed admin key printed five
`VARIABLE: message` lines (none containing the value) and exited; nothing stayed listening.
`echo … | pnpm --filter @tamiz/dashboard hash-passphrase` printed a valid hash line.

## Pending / follow-ups

- The Playwright suite does not run in CI yet: the `e2e` job is `T-008-09` (T055).
- US1-6's automated test against the built server is `T-008-09` (T054); this task has the
  schema tests and the manual run above.
- Everything visual waits for gate G1 (`T-008-10`).

## Pitfalls for the next session

- **Do not add `.js` to imports under `apps/dashboard`** (Turbopack cannot resolve them).
- **`pnpm --filter @tamiz/dashboard typecheck` runs `next typegen` first**: `next-env.d.ts`
  and `.next/types` are generated and git-ignored.
- **Playwright reuses running servers locally** (`reuseExistingServer` outside CI). After a
  rebuild, stop old ones (ports 3100, 3210, 3211) or the run tests stale code.
- **`getByRole("alert")` also matches Next.js's route announcer** (`#__next-route-announcer__`);
  locate alerts by text.
- **Layouts may only export what Next.js allows**; a stray `export const` in `layout.tsx`
  fails `next typegen`.
- **New gateway routes must join `registerRoutes`** in `app.ts`, or `hc` will not know them
  (`T-008-08` adds `GET`/`PUT /v1/admin/policy`).
- **`process.env.X` fails `noPropertyAccessFromIndexSignature`** and Biome rejects
  `process.env["X"]`; destructure instead (`const { X } = process.env`).

## Links

- Spec / plan / tasks: `specs/008-dashboard/`
- ADRs: none added
- Related task records: `docs/tasks/done/T-008-01-spec-plan-tasks-008.md`,
  `docs/tasks/done/T-006-04-audit-query-api.md`, `docs/tasks/done/T-006-06-cost-and-providers.md`,
  `docs/tasks/done/T-007-06-evals-ci-job.md`
