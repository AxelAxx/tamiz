# Quickstart: verifying Contracts and Skeleton

**Feature**: `001-contracts-and-skeleton` · **Date**: 2026-10-18

How a reviewer proves the feature works once `T-001-02` … `T-001-06` are merged. Each
step names the spec scenario it demonstrates.

## Prerequisites

- Node.js 22 LTS (`node --version` → `v22.x`). With nvm/fnm: `nvm use` reads `.nvmrc`.
  Node 24 works locally with an `engines` warning; CI is the reference.
- pnpm 10 through Corepack:

```bash
corepack enable pnpm
```

- Git 2.4x+. GitHub CLI only for the branch-protection check.

## 1. Workspace (US1)

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: every command exits 0 and lists `@tamiz/contracts`, `@tamiz/test-utils` and
`@tamiz/gateway` (Turborepo output); `packages/tsconfig` has no scripts and is skipped.

Commit convention (US1-3, US1-4):

```bash
git commit --allow-empty -m "wip"
```

Expected: refused by the `commit-msg` hook with the commitlint report. Then:

```bash
git commit --allow-empty -m "chore: verify commit hook" && git reset --soft HEAD~1
```

Expected: accepted (and undone by the reset).

## 2. Contracts (US2)

```bash
pnpm --filter @tamiz/contracts test
```

Expected: tests named after the scenarios pass, including the type-level file
(`branded.test-d.ts`) that asserts `Usd` is not assignable to `Milliseconds`. The test
corpus contains the invalid samples of SC-004 (unknown field, wrong type, empty
`messages`, bad `role`, `stream: true`).

## 3. Health endpoint (US3)

```bash
pnpm --filter @tamiz/gateway dev
```

In another terminal:

```bash
curl -i http://localhost:3000/health
```

Expected: `200`, header `x-request-id: <generated>`, body like
`{"status":"ok","version":"0.1.0","uptimeMs":1234}`.

```bash
curl -i -H "x-request-id: abc-123" http://localhost:3000/nope
```

Expected: `404`, `x-request-id: abc-123` echoed, body
`{"error":{"type":"not_found","message":"Route not found","requestId":"abc-123"}}`.

In-process variant (US3-2) is `apps/gateway/test/health.test.ts`, run by `pnpm test`.

## 4. Invalid configuration (US4)

```bash
PORT=abc LOG_LEVEL=loud pnpm --filter @tamiz/gateway start
echo "exit: $?"
```

Expected: no port bound, stderr lists `PORT` (expected integer 1–65535) and
`LOG_LEVEL` (expected one of fatal|error|warn|info|debug|trace), exit code 1. Unit
coverage: `apps/gateway/test/env.test.ts`; process coverage:
`apps/gateway/test/boot.integration.test.ts`.

## 5. Log redaction (US5)

`apps/gateway/test/logger.test.ts` logs objects with `prompt`, `messages`,
`authorization` at the top level and under `req.headers` / `body`, captures the line and
asserts every one reads `"[REDACTED]"` while other fields survive. Manual check:

```bash
LOG_LEVEL=debug pnpm --filter @tamiz/gateway dev
```

Then request `/health` with `-H "authorization: Bearer secret"` and confirm the request
log line shows `"authorization":"[REDACTED]"`.

## 6. Architecture limits and CI (US6)

```bash
pnpm arch
```

Expected: `no dependency violations found`. Then add a deliberate violation:

```bash
echo 'import "../infrastructure/logging/logger";' >> apps/gateway/src/domain/result.ts
pnpm arch
git checkout apps/gateway/src/domain/result.ts
```

Expected: the second command fails, printing
`error domain-imports-nothing: apps/gateway/src/domain/result.ts → apps/gateway/src/infrastructure/logging/logger.ts`
and exit code ≥ 1.

Pipeline: open a pull request and confirm a single required check named `ci` runs lint →
typecheck → arch → test → build. Branch protection (US6-7):

```bash
gh api repos/AxelAxx/tamiz/branches/main/protection --jq '.required_status_checks.contexts'
```

Expected: `["ci"]`. A direct `git push origin main` is refused by GitHub.

## 7. Test utilities (US7)

```bash
pnpm --filter @tamiz/test-utils test
pnpm test -- --coverage
```

Expected: `fake-clock.test.ts` shows `now()` stable until `advance(1500)` moves it by
exactly 1500 ms; the builders produce objects that pass the contracts; the root run
reports the three packages and prints a coverage table.

## Timing (SC-001, SC-007)

Measure a fresh clone end to end:

```bash
time (pnpm install && pnpm lint && pnpm typecheck && pnpm arch && pnpm test && pnpm build)
```

Expected: under 5 minutes locally; the CI job summary under 10 minutes. `health.test.ts`
asserts the in-process response takes under 50 ms.
