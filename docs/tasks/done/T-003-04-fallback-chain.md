# T-003-04 — Fallback chain, residency guard, events and headers

| Field | Value |
|---|---|
| Task | `T-003-04` (see `docs/tasks/BACKLOG.md`) |
| Feature | `003-resilience` |
| Spec | `specs/003-resilience/spec.md` (US1, US2, US5, US3-5, US4-2, US4-7, FR-011 … FR-020, SC-001 … SC-006); `tasks.md` Phase 3 (T019–T040); `research.md` R-05 … R-08, R-12 … R-14 |
| Branch / PR | `T-003-04-fallback-chain` / PR opened after this commit |
| Date | 2026-10-30 |
| Session | Claude Code (Claude Opus 5.5), side session (merge authority delegated by Alex for the session) |
| Status | done |

## What was done

The gateway now executes the whole decided chain.
`application/resilience/execute-chain.ts` walks it target by target:

1. residency guard (a target outside the decision's allowed set is never called; the
   request stops with a residency violation);
2. request deadline;
3. circuit breaker (`admit`: call, single trial, or skip with `circuit_open`);
4. `withRetry(withTimeout(attempt))`, with every result reported to the breaker;
5. after a final failure, advance to the next target; an `aborted` result stops the
   chain.

Every step emits a `RoutingEvent`. `routeInference` runs on top of it, so usage, cost,
model and `abandoned` are those of the answering target (US1-5).

Other changes:

- **Policy file** (contract and domain): optional `resilience` section with defaults,
  and `residency` lists on rules and the default chain. A chain entry outside its own
  list is a boot error (FR-012, FR-014, FR-020).
- **Decision**: carries `allowedResidencies` (FR-012).
- **New domain errors**: `ResidencyViolationError` and `ProviderUnavailableError`.
- **Contract**: error type `provider_unavailable` (503) (FR-019).
- **Responses**:
  - `x-tamiz-fallback` lists abandoned targets as `targetId:reason`;
  - `x-tamiz-route` names the answering target or the last one reached;
  - failures map to 451 (residency), 502, 503 with `retry-after` (every circuit open)
    or 504 (timeout or deadline) (FR-013, FR-015, FR-016);
  - the OpenAPI document declares the new statuses and the header.
- **Events**: `infrastructure/telemetry/log-routing-events.ts` writes each one as a log
  line (FR-017, FR-018).
- **Wiring**: `main.ts` wires in-memory circuit state, the log sink and `Math.random`.
- **`default.yaml`**: version 2. `pinned-local` allows `[local]`; `long-documents-eu`
  allows `[eu, local]` and no longer lists `openai-mini`.

## Files touched

- `packages/contracts/src/{error,routing-policy,index}.ts` and their tests (T019, T020, T029).
- `apps/gateway/src/domain/errors.ts`: the two new error kinds and constructors (T030).
- `apps/gateway/src/domain/model/routing-policy.ts`: `ResilienceSettings`, `DEFAULT_RESILIENCE`, `residency`, validation (T031).
- `apps/gateway/src/domain/model/routing-decision.ts`: `allowedResidencies` (T032).
- `apps/gateway/src/domain/model/fallback.ts`: `FALLBACK_REASONS`, `Abandoned`, `formatFallbackHeader` (T033).
- `apps/gateway/src/application/resilience/execute-chain.ts` (T034).
- `apps/gateway/src/application/use-cases/route-inference.ts`: rework on `executeChain` (T035).
- `apps/gateway/src/application/ports/llm-provider.port.ts`: optional `signal` on the input.
- `apps/gateway/src/application/ports/routing-events.port.ts`: reasons typed with the domain `FallbackReason`.
- `apps/gateway/src/infrastructure/telemetry/log-routing-events.ts` (T036).
- `apps/gateway/src/infrastructure/policy/policy-mapper.ts`: maps `residency` and `resilience`.
- `apps/gateway/src/presentation/{routes/chat-completions,mappers/error-envelope}.ts` (T037).
- `apps/gateway/src/main.ts` (T039).
- `apps/gateway/policies/default.yaml`: from `specs/003-resilience/contracts/policy.example.yaml` (T038).
- Tests:
  - `apps/gateway/test/domain/{residency-and-resilience,fallback}.test.ts` (T021, T022);
  - `test/resilience/{chain-helpers,execute-chain.test,execute-chain.property.test}.ts` (T023, T024);
  - `test/telemetry/log-routing-events.test.ts` (T025);
  - `test/application/route-inference.test.ts` (T026);
  - `test/chat-completions.test.ts` and `test/helpers/app.ts` (T027);
  - `test/policy/fixtures/invalid/residency-contradiction.yaml`, `file-policy-loader.test.ts` and `boot.integration.test.ts` (T028);
  - `test/openapi.test.ts`, `test/{error-envelope,result}.test.ts` and `test/domain/errors.test.ts`: the exhaustive switches.
- `docs/tasks/BACKLOG.md`: `T-003-04` → `done` (that row only).

## Decisions

- **The executor takes the `CircuitStatePort`, not a breaker.** The breaker is created
  per request with the active policy's `circuitBreaker` settings. It is stateless apart
  from the port, so a policy change applies at once (data-model §3.3 said
  `circuits: CircuitBreaker`).
- **A half-open trial is a single attempt** even when `maxAttempts` > 1: a failed trial
  reopens the circuit, so retrying it at once would call a target just declared down.
- **`ChainFailure.target` is the last target reached**, and `abandoned` lists the ones
  before it.
  - For `exhausted` and `unavailable`, the target is the chain's last entry.
  - For `residency` and `deadline`, it is the target where execution stopped, whether
    blocked or not started.
  - That is what `x-tamiz-route` / `x-tamiz-fallback` report, as in `contracts/http.md`.
- **`aborted` (deadline or outer signal) stops the chain** and maps to 504
  `provider_timeout` (the mapper's `provider` case treats `aborted` like `timeout`).
  Client disconnects only matter for streaming (`T-003-05`).
- **`retry-after` is at least 1 s.** A skip while a half-open trial is in flight reports
  0 ms (T-003-03 note); the executor floors the 503 hint at 1 s.
- **`ChainAttempt` receives the timeout it runs under** (the effective timeout capped by
  the time left), so the adapter's own timeout matches the executor's.
- **Bug found by the tests and fixed:** the log sink first called
  `(cond ? logger.warn : logger.info)(…)`, which detaches pino's methods. With the real
  logger every event threw, and every falling-back request became a 500. The sink now
  calls the method on the logger and wraps `emit` in `try/catch`: a sink must never
  throw into a request. A sink test with the real pino logger covers this; the
  recording logger could not.
- **A `fallback` event is emitted for every failed target, including the last one.** The
  header lists only the targets before the reported one. In the success case events and
  header agree exactly (US5-2 test). After an exhausted chain the log has one more
  `fallback` than the header: the event records that the target was left, the header
  what preceded the reported route.
- **The HTTP test for 451 injects a stubbed `routeInference`.** No policy can produce a
  residency violation in this feature: boot validation rejects contradictions, and only
  feature 005 narrows the allowed set per request. The executor tests and the property
  test cover the guard itself.
- **The adapters do not use `ProviderCompletionInput.signal` yet.** The executor's
  `withTimeout` returns at the deadline and aborts the attempt's signal, but the AI SDK
  call keeps running until its own `timeoutMs`. `T-003-05` (T048) combines both signals
  with `AbortSignal.any` when it touches the adapter.
- **SC-005 is measured on the executor**, not against the 002 endpoint: 1 000 healthy
  executions, p95 < 2 ms. The 002 baseline no longer exists to compare against.

## How it was verified

```bash
pnpm lint          # Checked 168 files. No fixes applied.
pnpm typecheck     # Tasks: 5 successful, 5 total
pnpm arch          # ✔ no dependency violations found (71 modules, 210 dependencies cruised)
pnpm test --coverage   # Test Files 56 passed (56)   Tests 623 passed (623)   Type Errors no errors
#  application/resilience 100 % lines (96.4 % branches)
pnpm build         # Tasks: 3 successful, 3 total
pnpm --filter @tamiz/gateway exec vitest run test/resilience test/domain/circuit.test.ts test/cache
#  Tests 63 passed   Duration 1.90 s, fake clock only (SC-006, < 10 s)
```

- The property test (1 000 runs) compares the executor's calls with an independent
  simulation of the residency, breaker and retry rules (SC-002, SC-003).
- The routing dataset gate still reports 44/44 routes with `default.yaml` version 2.

Manual quickstart §2–3 against the real process: port 3125, the default policy, the
three keyed providers pointed at an unreachable local port with test keys, and no
Ollama, so no real provider is contacted.

```text
request 1–3 → HTTP/1.1 502 Bad Gateway
              x-tamiz-fallback: mistral-small:network,openai-mini:network
              x-tamiz-route: ollama-llama
              x-tamiz-rule: default
request 3   → log: circuit.changed closed → open for mistral-small, openai-mini, ollama-llama
              (5 counted failures each: two attempts per request)
request 4   → HTTP/1.1 503 Service Unavailable
              retry-after: 30
              x-tamiz-fallback: mistral-small:circuit_open,openai-mini:circuit_open
              x-tamiz-route: ollama-llama
              {"error":{"type":"provider_unavailable",…}}
log: one "fallback" event per abandoned target; message marker 0 times; API key 0 times
```

Quickstart §4 (contradictory residency stops boot) is covered by the boot integration
test. A real successful fallback to a live provider was not run (no provider reachable
from this machine); it is covered in-process by `chat-completions.test.ts`.

## Pending / follow-ups

- `T-003-05`: streaming on the same executor; adapters honour `signal` (`AbortSignal.any`)
  and read `retry-after` into `retryAfterMs`.
- `T-003-06`: Redis/Valkey circuit state, selected in `main.ts` (currently in memory).
- Feature 005 narrows `allowedResidencies` per request; the guard is in place.
- No new backlog rows.

## Pitfalls for the next session

- **Never call a pino method detached** (`const log = logger.info; log(…)`), and keep
  sinks behind `try/catch`. A recording logger in tests hides this; test sinks with the
  real `createLogger` writing to memory.
- **Failure paths retry and sleep on the fake clock.** Drive them with
  `clock.drive(...)`, or in HTTP tests with `send()` from `test/helpers/app.ts`; a bare
  `app.request` on a failing path hangs on the first retry wait.
- **`default.yaml` is version 2.** `specs/002-provider-routing/contracts/policy.example.yaml`
  is now historical; the current projection is
  `specs/003-resilience/contracts/policy.example.yaml`.
- `RoutingFailure` is `{ decision, failure: ChainFailure }`. Use `failure.error` (a
  `DomainError`) with the envelope mapper and `failure.target` / `failure.abandoned`
  for the headers.
- Biome's `--write` on one package leaves formatting errors in another; run
  `pnpm exec biome check --write .` from the root before `pnpm lint`.

## Links

- Spec / plan / tasks: `specs/003-resilience/{spec,plan,tasks}.md` (Phase 3), `research.md` R-05 … R-08, R-12 … R-14, `data-model.md`, `contracts/http.md`
- ADRs: none added
- Related task records: `docs/tasks/done/T-003-03-circuit-breaker.md`, `docs/tasks/done/T-003-02-timeout-and-retry.md`, `docs/tasks/done/T-002-06-chat-completions-endpoint.md`
