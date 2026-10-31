# Quickstart: verifying the Dashboard

**Feature**: `008-dashboard`. How a reviewer runs the dashboard and checks each story.
Commands are filled in by the implementation tasks; the shapes are in
[`contracts/`](contracts/) and [`data-model.md`](data-model.md).

## Prerequisites

- Node.js 22, pnpm 10, `pnpm install` at the root.
- Playwright's Chromium: `pnpm --filter @tamiz/dashboard exec playwright install chromium`.
- Optional: Docker (PostgreSQL for policy persistence, the full stack), `gh` (to download
  eval reports).

## 1. Unit and contract suites (no browser)

```bash
pnpm test        # includes the dashboard's Vitest project and the gateway policy endpoint tests
pnpm lint && pnpm typecheck && pnpm arch && pnpm build
```

Expected: green. The gateway suite covers `GET`/`PUT /v1/admin/policy` (US5-1, US5-3 …
US5-6, US5-8); the dashboard suite covers the pure parts (research R-13).

## 2. Browser flows against the E2E gateway

```bash
pnpm --filter @tamiz/dashboard e2e            # starts the E2E gateway and `next start`
pnpm --filter @tamiz/dashboard e2e --ui       # interactive
```

Expected: every test is green; titles start with their scenario id
(`grep -rhoE "US[0-9]-[0-9]+" apps/dashboard/e2e | sort -u` lists every scenario of
`spec.md`). The accessibility scan runs inside the same suite (US9-1).

## 3. Run it by hand

```bash
# terminal 1: the gateway (in-memory audit log; or DATABASE_URL for persistence)
pnpm --filter @tamiz/gateway generate-api-key dashboard     # put its entry in TAMIZ_ADMIN_API_KEYS
pnpm --filter @tamiz/gateway dev

# terminal 2: the dashboard
pnpm --filter @tamiz/dashboard hash-passphrase              # reads the passphrase from stdin
cp apps/dashboard/.env.example apps/dashboard/.env.local    # fill the key, hash, secret, URLs
pnpm --filter @tamiz/dashboard dev                          # http://localhost:3100
```

Then:

1. Sign in (US1-2). Open the browser's developer tools and search the network panel and
   storage for the admin key: nothing (US1-3).
2. Send a chat completion with a DNI to the gateway (`curl` from `apps/gateway/README.md`);
   it appears in live traffic with a `local` badge within 5 seconds (US2-1).
3. Simulator: paste `Resume el expediente de 12345678Z para el comité.` → DNI highlighted,
   `critical`, `restrict_to_local`, local chain (US3-1). With the real privacy service
   (`docker compose up privacy`) the detection is real; otherwise the gateway fails closed and
   the simulator says so (US3-3).
4. Audit log: filter by route, load older (US4-1, US4-2).
5. Policy: change a rule's `route` to an undeclared target → issue with its path, save
   refused (US5-2, US5-3); fix it and save → version + 1; simulate again and see the new
   version (US5-4).
6. Evals: download a report and reload the evals screen (US6-1):

   ```bash
   gh run download <run-id> -n evals-report -D apps/dashboard/data/evals/<run-id>
   ```

7. Cost and providers: open both; the totals match `GET /v1/admin/cost` for the same range
   (US7-1); idle targets are listed (US8-1).
8. Toggle the theme and reload: no flash (US9-5). Narrow the window to a phone width: menu
   navigation, stacked lists, no horizontal scroll (US9-6).

## 4. Container

```bash
docker build -f apps/dashboard/Dockerfile -t tamiz-dashboard .
docker compose up dashboard gateway
```

Expected: the image runs as a non-root user, `GET /api/health` answers, and the dashboard
refuses to start with a missing variable, listing it (US1-6).
