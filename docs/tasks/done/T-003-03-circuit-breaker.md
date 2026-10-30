# T-003-03 — Circuit breaker and circuit state

| Field | Value |
|---|---|
| Task | `T-003-03` (see `docs/tasks/BACKLOG.md`) |
| Feature | `003-resilience` |
| Spec | `specs/003-resilience/spec.md` (US4-1 … US4-6, FR-006 … FR-010); `tasks.md` Phase 2 (T011–T018); `research.md` R-04, R-05 |
| Branch / PR | `T-003-03-circuit-breaker` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex for the session) |
| Status | done |

## What was done

Each target now has its own circuit.

- `domain/model/circuit.ts` holds the closed list `CIRCUIT_STATES` (`closed`, `open`,
  `half_open`), the stored `CircuitSnapshot` (`failures`, `openUntil?`, `trialPending`)
  and the pure functions `stateAt` and `remainingCooldownMs`.
- `application/ports/circuit-state.port.ts` declares the storage operations a shared
  store needs: `snapshot`, `recordFailure`, `recordSuccess`, `open`, `tryAcquireTrial`.
- `infrastructure/cache/in-memory-circuit-state.ts` implements them, with times from the
  clock port.
- `application/resilience/circuit-breaker.ts` is the policy over the port.
  - `admit` returns call, trial or skip with the remaining cool-down.
  - `onResult` handles the outcome:
    - success → closed;
    - counted failure → count, and open at the threshold;
    - failed trial → reopen;
    - other failures → nothing.
  - Every transition emits `circuit.changed` (US4-1 … US4-6, FR-006 … FR-010).
- The routing-events port now types `from`/`to` with the domain `CircuitState`.

## Files touched

- `apps/gateway/src/domain/model/circuit.ts`: new (T014).
- `apps/gateway/src/application/ports/circuit-state.port.ts`: new (T015).
- `apps/gateway/src/infrastructure/cache/in-memory-circuit-state.ts`: new (T016).
- `apps/gateway/src/application/resilience/circuit-breaker.ts`: new (T017).
- `apps/gateway/src/application/ports/routing-events.port.ts`: `CircuitState` from the domain replaces the temporary `CircuitStateName`.
- `apps/gateway/test/domain/circuit.test.ts` (T011), `test/cache/{circuit-state-contract,in-memory-circuit-state.test}.ts` (T012), `test/resilience/circuit-breaker.test.ts` (T013).
- `docs/tasks/BACKLOG.md`: `T-003-03` → `done` (that row only).

## Decisions

- **`stateAt` takes the cool-down, so a backwards clock jump cannot keep a circuit
  open.** If `openUntil - now` exceeds one cool-down, the clock moved back and the
  circuit is half-open. `remainingCooldownMs` is always within `[0, cooldownMs]` (a
  property test with 1 000 runs checks exhaustive, exclusive states and that bound).
- **Counted failures are the retryable ones** (`rate_limited`, 5xx `http_error`,
  `timeout`, `network`), as in R-05. During a half-open trial, `aborted` (the request
  deadline cut the trial short) also counts, per the spec edge case.
  - Credential or request rejections and malformed bodies change nothing, even during a
    trial: the lease simply expires and the next request probes again. They say
    nothing about the provider's health, so they neither close nor reopen the circuit.
- **A request that finds the trial already taken is skipped with `remainingMs: 0`.**
  The executor of `T-003-04` turns the shortest remaining cool-down into `retry-after`,
  so it must use at least 1 second there (noted for `T-003-04`).
- **`admit` takes the lease length** (the attempt's timeout), so a trial that hangs
  releases the half-open slot after one attempt, not after a fixed time.
- **`onResult` always calls `recordSuccess` on success**, instead of reading the
  snapshot first. One store operation per success is simpler, and with Redis it is a
  single `DEL`.
- **The in-memory adapter lives in `infrastructure/cache/`**, not `@tamiz/test-utils`
  as the backlog row says. It is the production adapter for a single instance (FR-010),
  and tests import it directly (the plan's "Structure Decision").
- **The port contract is a reusable suite** (`describeCircuitStateContract`) that the
  Redis adapter of `T-003-06` will run unchanged.

## How it was verified

```bash
pnpm --filter @tamiz/gateway exec vitest run test/domain/circuit.test.ts test/cache test/resilience
#  Test Files 5 passed   Tests 46 passed
pnpm lint          # Checked 159 files. No fixes applied.
pnpm typecheck     # Tasks: 5 successful, 5 total
pnpm arch          # ✔ no dependency violations found (68 modules, 187 dependencies cruised)
pnpm test --coverage   # Test Files 51 passed (51)   Tests 550 passed (550)   Type Errors no errors
#  application/resilience 100 % lines; the new domain and cache files fully covered
pnpm build         # Tasks: 3 successful, 3 total
```

All breaker tests run on the fake clock; nothing waits in real time.

## Pending / follow-ups

- `T-003-04`: `executeChain` composes residency → `admit` → `withRetry(withTimeout(...))`
  → `onResult`. The 503 `retry-after` must use at least 1 s (see Decisions).
- `T-003-06`: the Redis adapter runs `describeCircuitStateContract`.
- No new backlog rows.

## Pitfalls for the next session

- `stateAt` and `remainingCooldownMs` need the cool-down as an argument. Pass the
  policy's `circuitBreaker.cooldownMs`, not a constant.
- `onResult` must receive the `Admission` returned by `admit` for the same call.
  Trial results reopen at once; normal ones count towards the threshold.
- In tests, keep one breaker per test. The in-memory state lives as long as the breaker,
  so sharing one across tests leaks circuit state.

## Links

- Spec / plan / tasks: `specs/003-resilience/{spec,plan,tasks}.md` (Phase 2), `research.md` R-04, R-05, `data-model.md` §2.4, §3.1, §3.2
- ADRs: none added
- Related task records: `docs/tasks/done/T-003-02-timeout-and-retry.md`, `docs/tasks/done/T-003-01-spec-plan-tasks-003.md`
