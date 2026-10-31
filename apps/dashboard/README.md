# apps/dashboard

The Tamiz dashboard: a Next.js 16 (App Router, React 19) operator console over the
gateway's admin API. Organised by feature (`live-traffic`, `audit-log`, `policy-editor`
with the dry-run simulator, `cost-analytics`, `eval-results`, `provider-health`); routes
stay thin. Feature `008-dashboard` (`specs/008-dashboard/`).

**Status (`T-008-02`).** The non-visual skeleton: configuration, operator sign-in, the
backend-for-frontend (BFF) endpoints, the typed gateway client, TanStack Query and the
Playwright harness. Pages are unstyled placeholders: every screen is built from the Claude
Design output after gate G1 (`T-008-10` onwards).

## How it fits together

- **The browser talks only to `/api/*`** on the dashboard's own origin, a fixed allow-list
  (`contracts/dashboard-bff.md`). Each handler validates its input with the contract,
  calls one gateway endpoint with the admin key, parses the answer with the contract and
  answers `Cache-Control: no-store`. The admin key lives only in `src/lib/server/*`
  (`import "server-only"`).
- **Sign-in.** One operator passphrase, stored as an scrypt hash; sessions are in memory,
  8 hours absolute, revoked on sign-out; 5 failures per minute per address, then a minute
  of refusals. `src/proxy.ts` redirects pages without a validly signed cookie to
  `/sign-in`; every data endpoint checks the session store itself.
- **Writes** (`POST`/`PUT`/`DELETE`) are refused with `403 forbidden_origin` unless their
  `Origin` (or `Referer`) is `TAMIZ_DASHBOARD_PUBLIC_URL`'s origin.
- **The gateway client** is `hc<GatewayRoutes>` (type-only import from
  `@tamiz/gateway/routes`), with a 10-second timeout. Errors map to `gateway_unreachable`
  (504), `gateway_credentials` (502), `contract` (502) or `gateway` (the gateway's status).
- **In the browser**, `src/lib/api-client.ts` fetches `/api/*` and parses answers and
  errors (`BffErrorSchema`) for TanStack Query (`src/app/providers.tsx`).

```
src/
├── proxy.ts              page gate (cookie signature)
├── instrumentation.ts    validates the configuration at start; exits listing every problem
├── app/                  routes only: (auth)/sign-in, (console)/*, api/*
└── lib/
    ├── api-client.ts     browser client of /api/*
    ├── schemas.ts        BFF-only shapes (BffErrorSchema, EvalsListSchema)
    └── server/           env, session, passphrase, origin, handler, gateway, bff, context
e2e/                      Playwright: titles start with the scenario id (US1-1 …)
scripts/hash-passphrase.ts
```

## Configuration

`.env.example` documents every variable; the server refuses to start on any missing or
malformed one (US1-6). Make a passphrase hash with (it reads standard input):

```bash
pnpm --filter @tamiz/dashboard hash-passphrase
```

## Commands

```bash
pnpm --filter @tamiz/dashboard dev         # next dev on :3100 (needs .env.local)
pnpm --filter @tamiz/dashboard build       # next build (standalone output)
pnpm --filter @tamiz/dashboard typecheck   # next typegen && tsc --noEmit
pnpm --filter @tamiz/dashboard test        # Vitest: env, session, origin, handlers, gateway mapping
pnpm --filter @tamiz/dashboard exec playwright install chromium   # once
pnpm --filter @tamiz/dashboard e2e         # Playwright against the E2E gateway (build first)
```

`e2e` starts `apps/gateway/scripts/e2e-gateway.ts` (gateway on `:3210`, control on
`:3211`) and `next start` on `:3100` with the test values of `e2e/support/fixtures.ts`.
Locally it reuses servers that are already running; stop them if they run an older build.
