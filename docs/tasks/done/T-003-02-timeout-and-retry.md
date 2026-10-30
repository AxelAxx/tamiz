# T-003-02 — Composable timeout and retry

| Field | Value |
|---|---|
| Task | `T-003-02` (see `docs/tasks/BACKLOG.md`) |
| Feature | `003-resilience` |
| Spec | `specs/003-resilience/spec.md` (US3-1 … US3-5, FR-001 … FR-005); `tasks.md` Phase 1 (T001–T010); `research.md` R-01, R-02, R-03 |
| Branch / PR | `T-003-02-timeout-and-retry` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex for the session) |
| Status | done |

## What was done

Waiting now goes through the clock port: `ClockPort` gains `sleep(ms, signal?)`, the
system clock implements it with `setTimeout`, and the fake clock of `@tamiz/test-utils`
keeps pending sleepers that `advance`, `set` and `runAll` resolve in due order (R-01).

`application/resilience/timeout.ts` exports `withTimeout(clock)(target, ms, run, outer?)`.
It races the attempt against `clock.sleep` and handles the three outcomes:

- the attempt settles first: its result is returned;
- the time runs out: a retryable `timeout` is returned and the attempt's signal is
  aborted;
- the outer signal aborts first: a non-retryable `aborted` is returned (R-03).

`application/resilience/retry.ts` exports `withRetry({ clock, random, events,
settings })(context, attempt)`:

- only retryable failures are retried, up to `maxAttempts`;
- the wait is `floor(random × min(maxDelayMs, baseDelayMs × 2^(n-1)))` (full jitter),
  raised to an upstream `retryAfterMs` hint capped by `maxDelayMs`;
- a wait that would end at or after the request deadline is not started, and the result
  is `aborted` ("request deadline reached");
- each wait is announced as a `retry.scheduled` event (FR-003, FR-004, US3).

The domain gains the cause `aborted` and an optional `retryAfterMs` on `ProviderError`.
`application/ports/routing-events.port.ts` declares the full event union of
data-model §3.1, which `T-003-03` and `T-003-04` emit.

## Files touched

- `packages/test-utils/src/fake-clock.ts`: `sleep`, `pendingSleeps`, `runAll`, `drive` (T005); `test/fake-clock.test.ts` (T001).
- `apps/gateway/src/application/ports/clock.port.ts`, `src/infrastructure/clock/system-clock.ts`: `sleep` (T006).
- `apps/gateway/src/domain/errors.ts`: cause `aborted`, `retryAfterMs` (T007).
- `apps/gateway/src/application/ports/routing-events.port.ts`: new (T009).
- `apps/gateway/src/application/resilience/{timeout,retry}.ts`: new (T008, T009).
- `apps/gateway/test/resilience/{helpers,timeout.test,retry.test}.ts`, `test/system-clock.test.ts`: T002–T004.
- `apps/gateway/test/domain/errors.test.ts`: the cause list includes `aborted`.
- `apps/gateway/test/not-found-and-request-id.test.ts`: its hand-written `{ now }` clock became `createFakeClock`, since `ClockPort` now requires `sleep`.
- `docs/tasks/BACKLOG.md`: `T-003-02` → `done` (that row only).

## Decisions

- **The fake clock gains `drive(promise)`, beyond T001's `runAll`.** It flushes pending
  callbacks, then advances to the next sleeper's due time, and repeats until the promise
  settles. If the promise is still pending with no sleeper left, it rejects ("never
  settles"). Tests therefore never depend on exactly when a sleep is registered.
  `MAX_DRIVE_STEPS` (10 000) turns an endless sleep loop into a failure instead of a
  hang.
- **`withTimeout` takes the target**, because a `ProviderError` names its target and
  provider. The race ends with `attempt.abort()` in every branch: aborting after the run
  has won is a no-op, and it guarantees the losing run never keeps a socket open.
- **Waits are whole milliseconds (`Math.floor`)**: the `Milliseconds` brand is integral,
  and flooring keeps every wait within its cap.
- **The deadline check uses `now + wait ≥ deadline`.** The retry layer returns `aborted`
  with the message "request deadline reached"; `T-003-04` maps the executor's deadline
  failure to 504.
- **The `RoutingEvent` union is declared in full now** (T009), with `CircuitStateName`
  as a string union until `T-003-03` adds `domain/model/circuit.ts`, and
  `AbandonReason` = provider causes except `aborted`, plus `circuit_open`. The type has
  no field that could carry message content.
- **The error mapper is not changed yet.** `aborted` would currently map to
  `provider_error` (502). Nothing on the HTTP path produces it until `T-003-04`, which
  maps `ChainFailure` (deadline → 504) as planned.

## How it was verified

```bash
pnpm --filter @tamiz/test-utils exec vitest run test/fake-clock.test.ts   # Tests 16 passed
pnpm --filter @tamiz/gateway exec vitest run test/resilience test/system-clock.test.ts test/domain/errors.test.ts
#  Test Files 4 passed   Tests 26 passed
pnpm lint          # Checked 151 files. No fixes applied.
pnpm typecheck     # Tasks: 5 successful, 5 total
pnpm arch          # ✔ no dependency violations found (64 modules, 173 dependencies cruised)
pnpm test --coverage   # Test Files 48 passed (48)   Tests 521 passed (521)   Type Errors no errors
#  application/resilience 100 % lines (93.3 % branches); fake-clock.ts 100 % lines
pnpm build         # Tasks: 3 successful, 3 total
```

The only real-time waits are the 20 ms system-clock test and the abort test (< 1 s).
The retry property-style test (200 random waits) runs on the fake clock.

## Pending / follow-ups

- `T-003-03`: domain `circuit.ts` (replace `CircuitStateName` with the domain type),
  `CircuitStatePort`, the in-memory adapter and the breaker.
- `T-003-04`: `executeChain`, attempt events, the `aborted`/deadline mapping to 504.
- The adapters do not set `retryAfterMs` yet; `T-003-05` (T048) reads `retry-after`
  when it touches the adapter.
- No new backlog rows.

## Pitfalls for the next session

- **Every hand-written `ClockPort` now needs `sleep`.** Use `createFakeClock` in tests,
  and rebuild `@tamiz/test-utils` after changing it (`pnpm --filter @tamiz/test-utils
  build`).
- **Drive time-dependent promises with `clock.drive(p)`.** If code under test waits on
  something that is not a clock sleep (a scripted port that never resolves, for
  example), `drive` rejects with "never settles"; that message points at the test
  script, not at the clock.
- With several rounds on one fake clock, time accumulates: give such tests a far
  deadline (see the 200-wait retry test).

## Links

- Spec / plan / tasks: `specs/003-resilience/{spec,plan,tasks}.md` (Phase 1), `research.md` R-01 … R-03, `data-model.md` §3.1, §3.2
- ADRs: none added
- Related task records: `docs/tasks/done/T-003-01-spec-plan-tasks-003.md`, `docs/tasks/done/T-001-06-test-utils.md`
