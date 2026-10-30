---

description: "Task list for feature 003-resilience"
---

# Tasks: Resilience

**Input**: Design documents from `specs/003-resilience/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md` (R-01 … R-15), `data-model.md`,
`contracts/{http.md,policy.example.yaml}`, `quickstart.md`; feature 002 merged
(`T-002-02` … `T-002-08` done, `main` at 89d6344 or later).

**Tests**: Mandatory. Constitution III requires every Given/When/Then of `spec.md` to map
one-to-one to a test; the "Scenario coverage" table below is that mapping. Write each
test before the code it covers and watch it fail first.

**Organization**: Phases are the backlog tasks `T-003-02` … `T-003-06` of
`docs/tasks/BACKLOG.md` (one session, one PR each), as in features 001 and 002. The
`[USn]` label keeps the mapping to the spec's user stories. Within a phase the order is
tests → implementation → verification → task record.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel with its neighbours (different files, no dependency on an
  unfinished task).
- **[Story]**: user story of `spec.md` (`US1` … `US7`).
- Paths are repository-relative. `gateway/` abbreviates `apps/gateway/`.

## Scenario coverage

| Spec scenario | Task | Spec scenario | Task |
|---|---|---|---|
| US1-1 retryable primary failure → second target, headers | T023, T027 | US4-5 per-target isolation | T013 |
| US1-2 non-retryable → no retry, next target | T023, T027 | US4-6 auth / request rejection not counted | T013 |
| US1-3 no fallback → no header | T023, T027 | US4-7 all circuits open → 503 + `retry-after` | T023, T027 |
| US1-4 all fail → 502 / 504, headers | T023, T027 | US5-1 every step is one event, in order | T023 |
| US1-5 cost and model of the answering target | T026, T027 | US5-2 header and events agree | T023, T027 |
| US2-1 next target outside residency → 451, no call | T023, T027 | US5-3 no content in events and logs | T025, T027 |
| US2-2 primary outside residency → 451, no call | T023 | US5-4 default sink = log lines | T025 |
| US2-3 contradictory policy → boot error | T021, T028 | US6-1 SSE chunks, usage, `[DONE]` | T042, T044 |
| US2-4 no statement → all allowed, residency in events | T021, T023 | US6-2 headers final at first token | T044 |
| US3-1 one retryable failure → retry, same target | T003 | US6-3 fallback rules before first token | T043 |
| US3-2 attempts = configured maximum | T003 | US6-4 failure after first token → error event | T042, T043, T044 |
| US3-3 non-retryable → one call | T003 | US6-5 first-token and idle timeouts | T042 |
| US3-4 waits within full-jitter bounds | T003 | US6-6 client disconnect aborts upstream | T043, T044 |
| US3-5 deadline stops retry / advance → 504 | T003, T023 | US6-7 exhausted before first token → JSON error | T043, T044 |
| US4-1 threshold → open + event | T013 | US7-1 open state shared within 1 s | T055 |
| US4-2 open → skip with `circuit_open` | T013, T023 | US7-2 open state expires by itself | T055 |
| US4-3 cool-down → one trial, others skip | T012, T013 | US7-3 store down → in-memory + warning | T055 |
| US4-4 trial success closes, failure reopens | T013 | | |

Success criteria: SC-001 T023/T027; SC-002, SC-003 T024; SC-004 T023, T025, T027;
SC-005 T027; SC-006 T040 (suite timing); SC-007 T044; SC-008 T055; SC-009 this table.

---

## Phase 1: `T-003-02` — Composable timeout and retry (US3)

**Goal**: waiting through `ClockPort`, `withTimeout` and `withRetry` as functions, no
real timers in tests.

**Independent test**: `quickstart.md` section 1 (timeout and retry suites).

**Branch**: `T-003-02-timeout-and-retry`. Depends on `T-003-01` (this spec, approved).

### Tests first

- [ ] T001 [P] [US3] Extend `packages/test-utils/test/fake-clock.test.ts`: `sleep(ms)`
  resolves only when `advance` reaches its due time, several sleepers resolve in due
  order, `sleep(0)` resolves on the next `advance(0)`, an aborted signal rejects with
  the signal's reason and removes the sleeper, `runAll()` resolves every pending sleeper
  (R-01)
- [ ] T002 [P] [US3] Write `gateway/test/resilience/timeout.test.ts`: with the fake
  clock, `withTimeout(clock)(ms, run)` returns `run`'s result when it settles first;
  returns a `ProviderError` with `cause: "timeout"`, `retryable: true` when `ms` elapses
  first, and aborts the signal given to `run`; an external abort yields `cause:
  "aborted"`, not retryable (FR-001, FR-005, R-02, R-03)
- [ ] T003 [P] [US3] Write `gateway/test/resilience/retry.test.ts` with the fake clock and
  a seeded `random` (a fixed sequence): one retryable failure then success → two calls,
  success returned (US3-1); retryable failure on every attempt → exactly `maxAttempts`
  calls, last error returned (US3-2); `authentication`, `malformed_response`, non-retryable
  `http_error` and `aborted` → one call (US3-3); waits equal `random × min(maxDelayMs,
  baseDelayMs × 2^(n-1))` for n = 1 … 4 and stay within that bound for 200 random
  values (US3-4); a `retryAfterMs` larger than the computed wait raises it, capped by
  `maxDelayMs` (edge case); a wait that would end past the deadline is not started and
  the result is `cause: "aborted"` with reason deadline (US3-5); a `retry.scheduled`
  event is emitted per wait with `attempt` and `waitMs` (FR-017 preview)
- [ ] T004 [P] [US3] Write `gateway/test/system-clock.test.ts`: `sleep(20)` resolves
  after ≥ 20 ms of real time; an abort rejects at once (the only real-time test of the
  phase)

### Implementation

- [ ] T005 [US3] Implement `sleep` in `packages/test-utils/src/fake-clock.ts` (pending
  sleepers ordered by due time, resolved by `advance`/`set`, `runAll()`); rebuild
  `@tamiz/test-utils` (T-002-03 pitfall: the gateway resolves it through `dist`)
- [ ] T006 [US3] Add `sleep(ms: Milliseconds, signal?: AbortSignal): Promise<void>` to
  `gateway/src/application/ports/clock.port.ts` and implement it in
  `gateway/src/infrastructure/clock/system-clock.ts` (`setTimeout`, cleared and rejected
  on abort)
- [ ] T007 [US3] Extend `gateway/src/domain/errors.ts`: cause `aborted` in
  `PROVIDER_ERROR_CAUSES`, optional `retryAfterMs: Milliseconds` on `ProviderError`
  (grep `assertNever(` and `PROVIDER_ERROR_CAUSES` for every switch to update)
- [ ] T008 [US3] Implement `gateway/src/application/resilience/timeout.ts` (`withTimeout`)
- [ ] T009 [US3] Implement `gateway/src/application/resilience/retry.ts` (`withRetry({
  clock, random, events, settings })`; the events dependency is the
  `RoutingEventsPort` type of `data-model.md` §3.1, declared here in
  `gateway/src/application/ports/routing-events.port.ts` with the full event union)

### Verification

- [ ] T010 [US3] Run `pnpm lint typecheck arch test build` from the root; write
  `docs/tasks/done/T-003-02-timeout-and-retry.md`; set `T-003-02` to `done` in
  `docs/tasks/BACKLOG.md` in the same commit

**Checkpoint**: a single target is retried with bounded, jittered, testable waits.

---

## Phase 2: `T-003-03` — Circuit breaker and circuit state (US4)

**Goal**: per-target closed/open/half-open with pure transitions, a `CircuitStatePort`
and its in-memory adapter.

**Independent test**: `quickstart.md` section 1 (circuit suites).

**Branch**: `T-003-03-circuit-breaker`. Depends on Phase 1.

### Tests first

- [ ] T011 [P] [US4] Write `gateway/test/domain/circuit.test.ts`: `stateAt` returns
  `open` while `openUntil > now`, `half_open` when `trialPending` and not open, `closed`
  otherwise; `remainingCooldownMs` is 0 unless open and never negative when the clock
  moves backwards (edge case); a `fast-check` property over random snapshots and times
  confirms the three states are exhaustive and exclusive
- [ ] T012 [P] [US4] Write `gateway/test/cache/in-memory-circuit-state.test.ts` (port
  contract, reusable by `T-003-06`): `recordFailure` increments and returns the count;
  `recordSuccess` resets count, open and trial; `open(id, cooldownMs)` makes `snapshot`
  report `openUntil = now + cooldownMs` and `trialPending: true`; `tryAcquireTrial`
  returns `true` once and `false` until the lease (`leaseMs`) expires (US4-3); targets
  are independent (US4-5). Export the scenario list as
  `describeCircuitStateContract(factory)` in `gateway/test/cache/circuit-state-contract.ts`
- [ ] T013 [P] [US4] Write `gateway/test/resilience/circuit-breaker.test.ts` with the
  fake clock, the in-memory adapter and a recording events array: threshold 3 → the
  third counted failure opens the circuit and emits `circuit.changed` `closed → open`
  (US4-1); `admit` while open → `{ skip: remainingMs }` and no call (US4-2); after the
  cool-down the first `admit` → `"trial"`, a concurrent one → skip (US4-3); trial
  success → `closed`, count reset; trial failure → `open` for a full cool-down (US4-4);
  two targets do not affect each other (US4-5); `authentication`, `malformed_response`,
  non-retryable `http_error` and `aborted` do not count (US4-6); a half-open trial that
  ends in `timeout` counts as a failure (edge case)

### Implementation

- [ ] T014 [US4] Implement `gateway/src/domain/model/circuit.ts`: `CIRCUIT_STATES =
  ["closed", "open", "half_open"] as const`, `CircuitSnapshot { failures: number;
  openUntil?: number; trialPending: boolean }`, `stateAt`, `remainingCooldownMs`
- [ ] T015 [US4] Declare `gateway/src/application/ports/circuit-state.port.ts`
  (`snapshot`, `recordFailure`, `recordSuccess`, `open`, `tryAcquireTrial`, all async,
  per `data-model.md` §3.1)
- [ ] T016 [US4] Implement `gateway/src/infrastructure/cache/in-memory-circuit-state.ts`
  over a `Map`, with times from the clock port
- [ ] T017 [US4] Implement `gateway/src/application/resilience/circuit-breaker.ts`
  (`createCircuitBreaker({ state, clock, events, settings })` → `{ admit(target),
  onResult(target, result, mode) }`, R-04, R-05 counting rules)

### Verification

- [ ] T018 [US4] Run `pnpm lint typecheck arch test build`; write
  `docs/tasks/done/T-003-03-circuit-breaker.md` (note the decision to keep the in-memory
  adapter in `infrastructure/cache/`, plan "Structure Decision"); set `T-003-03` to `done`

**Checkpoint**: a failing target is taken out of rotation and probed after its cool-down.

---

## Phase 3: `T-003-04` — Fallback chain, residency guard, events and headers (US1, US2, US5)

**Goal**: `executeChain` composing residency → breaker → retry(timeout) per target;
`routeInference` on top; `x-tamiz-fallback`, 451/503/504; events with a log sink;
policy `resilience` and `residency`.

**Independent test**: `quickstart.md` sections 2, 3 and 4.

**Branch**: `T-003-04-fallback-chain`. Depends on Phase 2.

### Tests first

- [ ] T019 [P] [US1] Extend `packages/contracts/test/error.test.ts`: `provider_unavailable`
  accepted, status 503; the eight existing values unchanged (FR-019)
- [ ] T020 [P] [US2] Extend `packages/contracts/test/routing-policy.test.ts`: the
  `contracts/policy.example.yaml` of this feature (as JSON) parses; a policy without
  `resilience` parses; rejected with paths: `maxAttempts: 0` and `6`,
  `requestDeadlineMs: 999`, `cooldownMs: 999`, `failureThreshold: 0`, `residency: []`,
  `residency: ["mars"]`, an unknown key inside `resilience` (FR-020, R-14)
- [ ] T021 [P] [US2] Extend `gateway/test/domain/routing-policy.test.ts` and
  `routing-decision.test.ts` (+ the property test): `validatePolicy` fills
  `DEFAULT_RESILIENCE` (60000, 2, 250/2000, 5/30000); rejects `maxDelayMs < baseDelayMs`,
  a duplicate residency, and a chain entry outside its rule's or the default's residency
  list with the path `rules.N.route.M` / `default.route.M` (US2-3, FR-014); `decide`
  sets `allowedResidencies` to the matched rule's list, the default's, or all four when
  absent (US2-4, FR-012)
- [ ] T022 [P] [US5] Write `gateway/test/domain/fallback.test.ts`:
  `formatFallbackHeader([])` is `""`, two entries give `a:timeout,b:circuit_open`;
  `FALLBACK_REASONS` is the closed list of FR-016
- [ ] T023 [P] [US1] Write `gateway/test/resilience/execute-chain.test.ts` with the fake
  clock, seeded random, in-memory circuit state, scripted attempts and a recording
  events array:
  - primary retryable failure on every attempt, second succeeds → `Served` from the
    second, `abandoned = [primary:<cause>]` (US1-1);
  - primary `authentication` → one call, next target (US1-2);
  - primary succeeds → `abandoned = []` (US1-3);
  - every target fails → `exhausted`, last error; last failure `timeout` → reported as
    timeout (US1-4);
  - allowed `[local, eu]`, chain `eu → us`, primary fails → `residency` failure, no call
    to `us`, `residency.blocked` event (US2-1);
  - primary outside the allowed set → `residency`, zero calls (US2-2);
  - no statement → every residency allowed, each event carries the target's residency
    (US2-4);
  - open circuit → skipped with `circuit_open` and next target called (US4-2);
  - every circuit open → `unavailable` with the shortest remaining cool-down (US4-7);
  - deadline reached during a wait → `deadline`, no further attempt (US3-5);
  - the full event sequence of a retry-then-fallback run, in order, each with
    `requestId` (US5-1), and the abandoned list equals the `fallback` events (US5-2);
  - the primary's open circuit receives 0 calls during the cool-down while 20 requests
    are served by the second target (SC-001)
- [ ] T024 [P] [US2] Write `gateway/test/resilience/execute-chain.property.test.ts`
  (`fast-check`, ≥ 1 000 runs): random chains of 1–5 targets with random residencies,
  random allowed sets, random failure scripts (causes, retryable flags, delays) and
  random breaker states → no attempt on a target outside the allowed set (SC-002); no
  non-retryable failure retried, attempts per target ≤ `maxAttempts`, every wait within
  its bound, total fake time ≤ deadline + one attempt timeout (SC-003)
- [ ] T025 [P] [US5] Write `gateway/test/telemetry/log-routing-events.test.ts`: each event
  type becomes one log line through a recording logger with the event's fields and the
  documented level (`warn` for opening, residency block, stream failure; `info`
  otherwise) (US5-4); the `RoutingEvent` type has no content field and a test feeding
  events built from a request whose messages contain a marker finds no marker in the
  output (US5-3)
- [ ] T026 [P] [US1] Extend `gateway/test/application/route-inference.test.ts`: the
  use case passes the decision, the request's deadline and the provider's `complete` to
  the executor; on fallback, `RoutedCompletion.target`, `usage`, `cost` and `modelName`
  are those of the answering target and `abandoned` is set (US1-5); `RoutingFailure`
  carries the `ChainFailure`
- [ ] T027 [US1] Extend `gateway/test/chat-completions.test.ts` (helpers in
  `gateway/test/helpers/app.ts` gain a per-target script):
  - fallback → 200, `x-tamiz-route` = second target, `x-tamiz-fallback:
    mistral-small:http_error` (US1-1);
  - non-retryable primary → header reason `authentication` (US1-2);
  - healthy → no `x-tamiz-fallback` (US1-3);
  - all fail → 502 `provider_error`, or 504 `provider_timeout` when the last failure is
    a timeout, with both headers (US1-4);
  - `usage.cost_usd` priced with the answering target (US1-5);
  - residency violation → 451 `policy_blocked` and a message without request content
    (US2-1);
  - all circuits open → 503 `provider_unavailable` with `retry-after` in whole seconds
    rounded up (US4-7);
  - the captured pino output of the whole file contains no message content or key
    (US5-3, SC-004);
  - p95 of 200 healthy requests stays within 2 ms of the T-002-06 baseline measured in
    the same test (SC-005)
- [ ] T028 [US2] Add `gateway/test/policy/fixtures/invalid/residency-contradiction.yaml`
  and a case in `file-policy-loader.test.ts` (path `rules.0.route.1`), and extend
  `gateway/test/boot.integration.test.ts`: booting with it exits 1 naming the path and
  the residency (US2-3)

### Implementation

- [ ] T029 [US1] Extend `packages/contracts/src/error.ts` (`provider_unavailable` → 503)
  and `packages/contracts/src/routing-policy.ts` (`ResilienceSettingsSchema`, `residency`
  on rules and `default`, ranges of R-14: "`requestDeadlineMs` ≥ 1 000, `maxAttempts`
  1 … 5, `baseDelayMs` ≥ 1, `failureThreshold` ≥ 1, `cooldownMs` ≥ 1 000", residency
  lists "min 1, unique")
- [ ] T030 [US2] Extend `gateway/src/domain/errors.ts` with `ResidencyViolationError`
  and `ProviderUnavailableError` (`data-model.md` §2.1) and update every exhaustive
  switch (`presentation/mappers/error-envelope.ts`, `test/result.test.ts`)
- [ ] T031 [US2] Extend `gateway/src/domain/model/routing-policy.ts` (`ResilienceSettings`,
  `DEFAULT_RESILIENCE`, `residency`, the three validations of `data-model.md` §2.2) and
  `gateway/src/infrastructure/policy/policy-mapper.ts`
- [ ] T032 [US2] Add `allowedResidencies` to `gateway/src/domain/model/routing-decision.ts`
- [ ] T033 [P] [US5] Implement `gateway/src/domain/model/fallback.ts`
- [ ] T034 [US1] Implement `gateway/src/application/resilience/execute-chain.ts`
  (R-08: per target residency → `breaker.admit` → `withRetry(withTimeout(attempt))` →
  `breaker.onResult` → events; deadline from the request start)
- [ ] T035 [US1] Rework `gateway/src/application/use-cases/route-inference.ts` on
  `executeChain` (`RouteInferenceDeps` += `circuits`, `events`, `random`;
  `RoutedCompletion.abandoned`; `RoutingFailure = { decision, failure }`)
- [ ] T036 [P] [US5] Implement `gateway/src/infrastructure/telemetry/log-routing-events.ts`
- [ ] T037 [US1] Update `gateway/src/presentation/routes/chat-completions.ts` and
  `mappers/error-envelope.ts`: `ChainFailure` → status, envelope, `x-tamiz-route`,
  `x-tamiz-fallback` (only when non-empty), `retry-after`; OpenAPI responses 451, 503
  and the `x-tamiz-fallback` header documented
- [ ] T038 [US2] Replace `gateway/policies/default.yaml` with
  `specs/003-resilience/contracts/policy.example.yaml` (version 2); update the
  default-policy assertions in `gateway/test/policy/file-policy-loader.test.ts`
  (version 2, `long-documents-eu` chain); confirm the routing dataset gate still reports
  44/44 with `--reporter=default`
- [ ] T039 [US1] Wire `gateway/src/main.ts`: in-memory circuit state, log routing-events
  sink, `Math.random`, breaker settings from the policy

### Verification

- [ ] T040 [US1] Run `pnpm lint typecheck arch test build`; time the resilience suites
  (SC-006, < 10 s, no real waits); run `quickstart.md` sections 2–4 and paste the
  responses (keys redacted) into `docs/tasks/done/T-003-04-fallback-chain.md`; set
  `T-003-04` to `done`

**Checkpoint**: a provider outage no longer becomes a client outage, and never leaks
data to a disallowed place.

---

## Phase 4: `T-003-05` — Streaming with fallback before the first token (US6)

**Goal**: `stream: true` on the same endpoint, OpenAI-compatible SSE, fallback only
before the first token, typed error event after it.

**Independent test**: `quickstart.md` section 5.

**Branch**: `T-003-05-streaming`. Depends on Phase 3.

### Tests first

- [ ] T041 [P] [US6] Extend `packages/contracts/test/chat-completion-request.test.ts`
  (`stream: true` accepted; `stream_options: { include_usage: true }` accepted; unknown
  key in `stream_options` rejected) and add
  `packages/contracts/test/chat-completion-chunk.test.ts` (`ChatCompletionChunkSchema`:
  a delta chunk, a finish chunk, a usage chunk with `choices: []`; `StreamErrorEventSchema`)
- [ ] T042 [P] [US6] Extend `gateway/test/llm/adapter-scenarios.ts` with a streaming list
  and run it in the four `*.adapter.test.ts` files with MSW `text/event-stream` bodies
  (OpenAI/Mistral/Ollama `data:` chunks, Anthropic `event:` messages):
  - success → `first` text, then deltas, then `finish` with usage and `modelName`
    (US6-1);
  - 500 before the first chunk → `ProviderError` from `stream()` (US6-3 at the adapter
    level);
  - error after two chunks → an `error` part (US6-4);
  - no first chunk within `timeoutMs` → `timeout`, and a gap between chunks longer than
    `timeoutMs` → `error` part with `timeout` (US6-5);
  - body ends without a finish → `error` part `malformed_response` (edge case);
  - no usage → `finish` without usage;
  - zero unhandled requests
- [ ] T043 [P] [US6] Write `gateway/test/application/stream-inference.test.ts` with
  scripted `stream` attempts:
  - primary fails before its first token, second streams → served by the second,
    `abandoned` set (US6-3);
  - error part after the first token → surfaced as a final `error` part, no fallback,
    counted by the breaker (US6-4);
  - every target fails before a token → `RoutingFailure` (US6-7);
  - the request signal aborted → upstream signal aborted, `aborted` not counted (US6-6);
  - usage estimated from the streamed text when the finish has none, and cost computed
- [ ] T044 [P] [US6] Extend `gateway/test/chat-completions.test.ts` with streaming,
  parsing the SSE body line by line:
  - success → chunks valid per contract, identical `id`/`created`/`model`, usage chunk
    with `cost_usd`, then `[DONE]` (US6-1);
  - headers `x-tamiz-route`, `x-tamiz-rule`, `x-request-id` and `x-tamiz-fallback`
    after a pre-token fallback (US6-2);
  - mid-stream failure → one `data: {"error":…}` line valid per `StreamErrorEventSchema`,
    no `[DONE]` (US6-4);
  - exhausted before a token → JSON error response, status 502/504 (US6-7);
  - an aborted client request aborts the scripted upstream (US6-6);
  - first chunk forwarded within 20 ms p95 over 100 streams (SC-007)
- [ ] T045 [P] [US6] Extend `gateway/test/openapi.test.ts`: the 200 response of the chat
  route declares `text/event-stream`; `ChatCompletionChunk` is a component;
  `provider_unavailable` appears in the error type enum

### Implementation

- [ ] T046 [US6] Extend `packages/contracts/src/chat-completion.ts` (`stream:
  z.boolean().optional()`, `stream_options`, `ChatCompletionChunkSchema`,
  `StreamErrorEventSchema`, exports in `src/index.ts`)
- [ ] T047 [US6] Extend `gateway/src/application/ports/llm-provider.port.ts` (`stream`,
  `signal` on the input, `StartedStream`, `StreamPart`)
- [ ] T048 [US6] Implement `stream` in `gateway/src/infrastructure/llm/ai-sdk-provider.ts`
  (`streamText`, `maxRetries: 0`, `fullStream` parts `text-delta`/`finish`/`error`/`abort`
  as verified in the installed `ai` typings, idle timer, `AbortSignal.any`, error mapping
  shared with `complete`, `retryAfterMs` from `retry-after`); give the
  provider-registry's "not configured" adapter a `stream` that returns the same error
- [ ] T049 [US6] Implement `gateway/src/application/use-cases/stream-inference.ts` on
  `executeChain` with `attempt = provider.stream`
- [ ] T050 [P] [US6] Implement `gateway/src/presentation/mappers/chat-completion-chunk.ts`
  (each output validated against the contract)
- [ ] T051 [US6] Add the streaming branch to `gateway/src/presentation/routes/chat-completions.ts`
  (`streamSSE`, headers set before the first write, `c.req.raw.signal` passed down,
  JSON error before the first token) and register `ChatCompletionChunk` in
  `gateway/src/presentation/openapi-schemas.ts` with `.meta({ id })`
- [ ] T052 [US6] Wire `streamInference` in `gateway/src/main.ts` and `createApp` deps

### Verification

- [ ] T053 [US6] Run `pnpm lint typecheck arch test build`; run `quickstart.md` section 5
  against Ollama if available (otherwise state it in the record); write
  `docs/tasks/done/T-003-05-streaming.md`; set `T-003-05` to `done`

**Checkpoint**: interactive clients stream answers with the same resilience guarantees
up to the first token.

---

## Phase 5: `T-003-06` — Shared circuit state on Redis/Valkey (US7)

**Goal**: the `CircuitStatePort` over Redis/Valkey with expiry and single trial across
instances, falling back to memory when the store is down.

**Independent test**: `quickstart.md` section 6.

**Branch**: `T-003-06-redis-circuit-state`. Depends on Phase 2 (may run in parallel
with Phases 3 and 4; both edit `main.ts` and `env.ts`, the second to merge rebases).

### Setup

- [ ] T054 Add `ioredis` (5.x) to `gateway/package.json` dependencies and `testcontainers`
  (11.x) to its devDependencies (R-11)

### Tests first

- [ ] T055 [P] [US7] Write `gateway/test/cache/redis-circuit-state.test.ts` with
  Testcontainers (`valkey/valkey:8`), skipped with a visible reason when Docker is not
  available:
  - run `describeCircuitStateContract` (T012) against the adapter;
  - two adapter instances: one opens, the other sees `open` within 1 s (US7-1, SC-008);
  - the open key expires after the cool-down with no instance acting (US7-2);
  - `tryAcquireTrial` is granted to exactly one of two instances (FR-029);
  - stopping the container → operations succeed against memory, one `warn` per mode
    switch, and one on recovery (US7-3)
- [ ] T056 [P] [US7] Extend `gateway/test/config/env-002.test.ts` (or a new
  `env-003.test.ts`): `REDIS_URL` optional, `redis://` and `rediss://` accepted, any
  other scheme rejected without echoing the value

### Implementation

- [ ] T057 [US7] Implement `gateway/src/infrastructure/cache/redis-circuit-state.ts`
  (keys `tamiz:circuit:{targetId}:{failures|open|pending|trial}`, `INCR`, `SET … PX`,
  `SET … NX PX`, `DEL`, in-memory fallback wrapper with mode-switch warnings)
- [ ] T058 [US7] Add `REDIS_URL` to `gateway/src/infrastructure/config/env.ts`
  (`EXPECTED_FORMAT` entry, never echoed)
- [ ] T059 [US7] Select the circuit-state adapter in `gateway/src/main.ts` (`REDIS_URL`
  set → Redis with fallback; unset → in-memory) and close the connection on shutdown
- [ ] T060 [P] [US7] Create `docker-compose.yml` with a `valkey` service (port 6379,
  healthcheck) and `.env.example` documenting `REDIS_URL` and the variables of features
  001/002; mention both in `README.md`
- [ ] T061 [US7] Confirm the Testcontainers suite runs (not skipped) in the CI job on
  `ubuntu-latest`; if the job needs a change (for example a timeout), update
  `.github/workflows/ci.yml`

### Verification

- [ ] T062 [US7] Run `pnpm lint typecheck arch test build`; record the CI run showing the
  Redis suite executed; write `docs/tasks/done/T-003-06-redis-circuit-state.md`; set
  `T-003-06` to `done`

**Checkpoint**: two gateway instances agree on which providers are down.

---

## Phase 6: Polish and cross-cutting

- [ ] T063 [P] Update `README.md` "Status": feature 003 done, the `x-tamiz-fallback`
  header, streaming, link to `specs/003-resilience/quickstart.md`
- [ ] T064 [P] Update `apps/gateway/README.md` (behaviour table: fallback, 451/503,
  streaming; `REDIS_URL`) and `docs/architecture.md` (request flow: the resilience step
  now exists; events port and its sinks)
- [ ] T065 [P] Update `CLAUDE.md` section 12 with `docker compose up valkey` and the
  `--reporter=default` tip for seeing passing-test output
- [ ] T066 Run `quickstart.md` end to end and record the results in the last task
  record of the feature

Tasks T063–T066 belong to the last PR of the feature (`T-003-05` or `T-003-06`,
whichever merges second).

---

## Dependencies

```text
Phase 1 (T-003-02) ─▶ Phase 2 (T-003-03) ─┬─▶ Phase 3 (T-003-04) ─▶ Phase 4 (T-003-05) ─┐
                                          └─▶ Phase 5 (T-003-06) ────────────────────────┴─▶ Phase 6
```

- Phase 5 needs only Phase 2's port and contract tests; it can run as a separate
  session alongside Phases 3–4.
- Feature 005's `T-005-05` (streaming de-anonymization) depends on Phase 4; feature
  006 adds sinks to the routing-events port declared in Phase 1.
- Within a phase, `[P]` tasks are independent files; unmarked tasks depend on the ones
  above them.

## Parallel execution examples

- Phase 1: T001 … T004 together, then T005 → T009.
- Phase 2: T011 … T013 together, then T014 → T017.
- Phase 3: T019 … T026 together (eight test files), T027 and T028 after the helpers
  change; T033 and T036 in parallel with T034.
- Phase 4: T041 … T045 together; T050 in parallel with T049.
- Phase 3 ∥ Phase 5 as two sessions.

## Implementation strategy

1. **MVP** = Phases 1–3: timeouts, retries, breaker and fallback with the residency
   guard on the non-streaming endpoint. This is the resilience promise of the project
   and what SC-001 … SC-006 measure.
2. Phase 4 extends the same guarantees to streaming clients.
3. Phase 5 makes the breaker correct for more than one instance (needed for the OPS
   deployment, not for the demo).
4. Each phase is one PR, one backlog row flipped to `done`, one task record under
   `docs/tasks/done/`.

## Totals

| Phase | Backlog | Tasks | Stories |
|---|---|---|---|
| 1 | `T-003-02` | T001–T010 (10) | US3 |
| 2 | `T-003-03` | T011–T018 (8) | US4 |
| 3 | `T-003-04` | T019–T040 (22) | US1, US2, US5 |
| 4 | `T-003-05` | T041–T053 (13) | US6 |
| 5 | `T-003-06` | T054–T062 (9) | US7 |
| 6 | polish | T063–T066 (4) | — |
| **Total** | | **66** | |
