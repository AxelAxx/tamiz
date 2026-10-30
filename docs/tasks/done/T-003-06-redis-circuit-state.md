# T-003-06 — Shared circuit state on Redis/Valkey

| Field | Value |
|---|---|
| Task | `T-003-06` (see `docs/tasks/BACKLOG.md`) |
| Feature | `003-resilience` |
| Spec | `specs/003-resilience/spec.md` (US7-1 … US7-3, FR-029 … FR-031, SC-008); `tasks.md` Phase 5 (T054–T062) and the feature polish (T063–T066); `research.md` R-04, R-11 |
| Branch / PR | `T-003-06-redis-circuit-state` / PR #20 |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex for the session) |
| Status | done; feature 003 complete |

## What was done

`infrastructure/cache/redis-circuit-state.ts` implements `CircuitStatePort` over `ioredis`
(Valkey-compatible), with per-target keys:

- `failures` (`INCR`);
- `open`: the open-until time, `SET … PX cool-down`, so it expires by itself (US7-2);
- `pending`: the half-open trial is due;
- `trial`: `SET … NX PX lease`, so exactly one instance gets the trial (FR-029).

`withLocalFallback` wraps the store with the in-memory adapter:

- connection events drive the mode, and while the store is unreachable every operation
  is answered from memory, so a request never fails because of the store;
- each switch between shared and local mode is logged once, with an error code but
  never the store's address (FR-030, US7-3);
- the first successful connection is an `info` line.

The rest of the wiring:

- `REDIS_URL` (optional, `redis://` or `rediss://`, never echoed) selects the adapter in
  `main.ts`; without it the gateway keeps in-memory state. `main.ts` now also closes the
  HTTP server and the connection on `SIGINT`/`SIGTERM` (FR-031).
- `docker-compose.yml` has a `valkey` service, and `.env.example` documents every gateway
  variable.
- The feature's polish: README status (features 002 and 003), the gateway README, the
  policies README, `docs/architecture.md` and `CLAUDE.md` section 12.

## Files touched

- `apps/gateway/src/infrastructure/cache/redis-circuit-state.ts`: new (`createRedisStore`, `withLocalFallback`, `createRedisCircuitState`) (T057).
- `apps/gateway/src/infrastructure/config/env.ts`: `REDIS_URL` → `redisUrl` (T058).
- `apps/gateway/src/main.ts`: adapter selection and shutdown (T059).
- `apps/gateway/package.json`, `pnpm-lock.yaml`: `ioredis` 5.11, devDependency `testcontainers` 11.14 (T054).
- Tests:
  - `apps/gateway/test/cache/redis-circuit-state.test.ts` (T055);
  - `test/cache/local-fallback.test.ts` (FR-030 without Docker);
  - `test/cache/circuit-state-contract.ts` (`realTime` option);
  - `test/config/env-003.test.ts` (T056).
- `docker-compose.yml`, `.env.example`: new (T060).
- `README.md` (T063); `apps/gateway/README.md`, `apps/gateway/policies/README.md`, `docs/architecture.md` (T064); `CLAUDE.md` section 12 (T065).
- `docs/tasks/BACKLOG.md`: `T-003-06` → `done` (that row only).

## Decisions

- **The fallback is a separate wrapper (`withLocalFallback`)** around a raw store whose
  failures propagate. Mode switches, warnings and recovery are therefore unit-tested
  without Docker, and the Redis code is only the port's commands.
- **The mode follows connection events, not each command.** `ready` means shared;
  `error` or `close` means local. A single failing command is answered from memory
  without switching, so a transient error cannot leave the gateway stuck in local mode.
  The client fails fast (`enableOfflineQueue: false`, `maxRetriesPerRequest: 1`,
  `commandTimeout` 1 s) and keeps reconnecting in the background (`retryStrategy` up to
  5 s).
- **The adapter starts local until the first `ready`.** That connection is logged at
  `info`. A store that never connects gets exactly one warning; a store that drops after
  connecting gets one warning per switch, plus one on recovery.
- **`openUntil` is written as an absolute time from the writer's clock**, and the key's
  `PX` expiry is the source of truth for closing the cool-down. Clock skew between
  instances only shifts the reported remaining cool-down (`retry-after`), never whether
  the circuit is open.
- **The contract suite got a `realTime` option.** Redis expires keys in real time, so
  the lease test uses a 300 ms lease and also waits for real when run against Redis; the
  in-memory adapter still runs it on the fake clock.
- **`ioredis` 5, not 6.** 6.0 is out, but the plan named 5 and a new major needs its own
  check. **`testcontainers` 11, not 12**: 12 requires Node ≥ 22.22, which the project's
  `.nvmrc` (`22`) does not guarantee.
- **Docker-dependent tests are skipped with a visible reason when Docker is absent**
  (`describe.skipIf`, plus a named skipped test). The unreachable-store test needs no
  Docker and runs everywhere.
- **The 002 polish (T074–T077) was not done in the T-002-08 PR**, so this PR's README
  update covers features 002 and 003 together.

## How it was verified

Locally (Windows; the Docker engine is not running on this machine):

```bash
pnpm lint          # Checked 178 files. No fixes applied.
pnpm typecheck     # Tasks: 5 successful, 5 total
pnpm arch          # ✔ no dependency violations found (76 modules, 242 dependencies cruised)
pnpm test --coverage   # Test Files 62 passed (62)   Tests 702 passed | 12 skipped (714)
#  12 skipped = the 11 Valkey cases (no Docker here) + Anthropic's "no usage" stream case
pnpm build         # Tasks: 3 successful, 3 total
```

- The unreachable-store test runs locally against real `ioredis` (`redis://127.0.0.1:9`):
  every operation succeeds from memory, with exactly one warning.

CI on PR #20 (`ubuntu-latest`, Docker available), run 41040675386, step "Test":

```text
✓ @tamiz/gateway test/cache/redis-circuit-state.test.ts (13 tests | 1 skipped) 8710ms
Test Files 62 passed (62)
Tests      712 passed | 2 skipped (714)
```

- In CI the only skipped Redis test is the "Docker is not available" note. The 12 others
  ran against `valkey/valkey:8` via Testcontainers:
  - the port contract;
  - a circuit opened by one instance seen open by another within 1 s (SC-008, US7-1);
  - the open key expiring by itself (US7-2);
  - exactly one trial granted across two instances (FR-029);
  - the store going away with one warning and operations continuing (US7-3).

## Pending / follow-ups

- Feature 003 is complete. Quickstart §6 (Valkey) is covered by CI. The manual §5
  streaming run against a live Ollama is still not done on this machine (no provider
  reachable); see the T-003-05 record.
- The OPS task extends `docker-compose.yml` with the gateway, the privacy service,
  Postgres, Ollama and Jaeger.
- Feature 009's `get_provider_health` can read circuit state through the same port.
- No new backlog rows.

## Pitfalls for the next session

- **Docker is not running on this Windows machine.** Testcontainers suites are skipped
  locally and only run in CI; read the CI log to confirm they ran (the skipped count of
  `redis-circuit-state.test.ts` must be 1, the note).
- **Never log the Redis URL or an `ioredis` error message.** Messages contain host and
  port; log `error.code` only, as `reasonOf` does.
- **Real-time expiries:** tests against Redis need real waits (keep them short), and the
  shared contract suite takes `{ realTime: true }`.
- `createRedisCircuitState` is `async` (it attempts the first connection); `main.ts`
  awaits it at top level.

## Links

- Spec / plan / tasks: `specs/003-resilience/{spec,plan,tasks,quickstart}.md` (Phase 5, Phase 6), `research.md` R-04, R-11, `data-model.md` §4, §6
- ADRs: none added
- Related task records: `docs/tasks/done/T-003-03-circuit-breaker.md`, `docs/tasks/done/T-003-04-fallback-chain.md`, `docs/tasks/done/T-003-05-streaming.md`
