# Research: Resilience

**Feature**: `003-resilience` · **Date**: 2026-10-30 · **Spec**: [spec.md](spec.md)

Decisions taken while planning. Each names what was chosen, why, and what was rejected.
Library facts were checked against the versions installed on `main` (AI SDK 6.0.319,
`@ai-sdk/*` on the `ai-v6` lines, Hono 4.13, `@hono/zod-openapi` 1.6, Zod 4.6) and
Context7 on 2026-10-30.

## R-01 Waiting goes through the clock port: `ClockPort.sleep`

**Decision**: `ClockPort` (001) gains `sleep(ms: Milliseconds, signal?: AbortSignal):
Promise<void>`. The system adapter uses `setTimeout` and rejects with the signal's
reason on abort. `createFakeClock` in `@tamiz/test-utils` keeps a list of pending
sleepers that `advance(ms)` resolves in due-time order (and `runAll()` resolves the
rest), so retry waits, cool-downs and per-attempt timeouts are driven by tests without
real time.

**Rationale**: constitution VIII ("time via `ClockPort`") and FR-005. A separate
scheduler port would be a second port for the same concept (X). The fake stays generic:
it does not import gateway types (001 R-09).

**Alternatives**: `vi.useFakeTimers()` (couples application tests to Vitest and to
global timers, and still needs the system clock to agree); a `SchedulerPort` next to
`ClockPort` (two ports for one concept).

## R-02 Timeout and retry are higher-order functions; randomness is injected

**Decision**: `application/resilience/timeout.ts` exports
`withTimeout(clock)(ms, run: (signal) => Promise<T>)`, which aborts the inner signal and
resolves to a typed timeout when `clock.sleep(ms)` wins the race.
`application/resilience/retry.ts` exports `withRetry({ clock, random, settings })(attempt)`,
which retries only `ProviderError`s with `retryable: true`, waits
`random() × min(maxDelayMs, baseDelayMs × 2^(n-1))` (full jitter, AWS architecture blog
"Exponential Backoff and Jitter"), raises the wait to an upstream `retryAfterMs` when
present, and never waits past the deadline. `random` is a `() => number` dependency
(`Math.random` in `main.ts`, a seeded sequence in tests), not a port.

**Rationale**: composition over inheritance (IX); the composition `timeout → retry →
breaker → next target` from `CLAUDE.md` section 5 is literally function composition.
Full jitter spreads synchronised retries best for the same expected delay.

**Alternatives**: decorrelated jitter (needs the previous wait, more state, no benefit
at two attempts); a `RandomPort` (a function is enough; a port would have one real
implementation and no I/O).

## R-03 Provider errors keep the timeout inside the adapter; the executor adds a signal

**Decision**: the adapters of 002 keep bounding each call with `timeoutMs`
(`AbortSignal.timeout`, real time, which is what the network needs). `ProviderCompletionInput`
gains an optional `signal` that the executor passes for the request deadline and for
client disconnects; the adapter combines both with `AbortSignal.any`. The executor's
`withTimeout` is the fake-clock-testable bound used in application tests and as a
second guard; both resolve to `cause: "timeout"`.

**Rationale**: the real network timeout must abort the socket (002 US6-4), which only
the adapter can do; the application must still be testable without real waits. A
deadline or disconnect abort that is not a timeout maps to a new cause `aborted`, which
is never retried, never counted by the breaker and never reported to the client as a
provider failure.

**Alternatives**: moving the timeout out of the adapters (breaks 002's tested
behaviour); real timers in application tests (slow, flaky).

## R-04 Circuit breaker: pure transitions in the domain, storage behind a port

**Decision**: `domain/model/circuit.ts` holds the closed list `CIRCUIT_STATES = ["closed",
"open", "half_open"]` and pure functions over a `CircuitSnapshot`
(`{ failures, openUntil?, trialPending }`): `stateAt(snapshot, now)`, and the decisions
"allow call / skip / trial". `application/ports/circuit-state.port.ts` stores
snapshots with atomic operations:

| Operation | Meaning | Redis (R-11) |
|---|---|---|
| `snapshot(targetId)` | current record | `MGET` of the three keys |
| `recordFailure(targetId)` | increment and return consecutive failures | `INCR` |
| `recordSuccess(targetId)` | reset failures, clear open and trial | `DEL` |
| `open(targetId, cooldownMs)` | open until now + cool-down, mark half-open pending | `SET open PX`, `SET pending` |
| `tryAcquireTrial(targetId, leaseMs)` | one trial at a time | `SET trial NX PX` |

`application/resilience/circuit-breaker.ts` is the policy over the port: before a call
it asks `stateAt`; open → skip; half-open → `tryAcquireTrial` (lease = attempt timeout)
or skip; after a counted failure `recordFailure` and `open` at the threshold (or at once
in half-open); after a success `recordSuccess`. Every transition emits an event.

**Rationale**: the state machine is the interesting logic and stays pure and
property-testable; the port is the minimum a shared store needs for the single-trial
guarantee across instances (FR-029). Expiry of the open key is the store's job, so no
instance cleans up.

**Alternatives**: a single `get`/`set` port with read-modify-write (races between
instances break the single trial); the whole breaker inside the Redis adapter (logic
not testable without Redis, duplicated in the in-memory adapter).

## R-05 What counts, what advances, what is retried

**Decision**:

| `ProviderError.cause` | Retried on the same target | Counted by the breaker | Advances the chain | `x-tamiz-fallback` reason |
|---|---|---|---|---|
| `rate_limited` | yes | yes | yes | `rate_limited` |
| `http_error`, retryable (5xx) | yes | yes | yes | `http_error` |
| `http_error`, not retryable (4xx) | no | no | yes | `http_error` |
| `timeout` | yes | yes | yes | `timeout` |
| `network` | yes | yes | yes | `network` |
| `malformed_response` | no | no | yes | `malformed_response` |
| `authentication` | no | no | yes | `authentication` |
| `aborted` (deadline, disconnect) | no | no | no (stops) | — |
| circuit open (no call) | — | — | yes | `circuit_open` |

**Rationale**: spec Assumptions: any final failure advances (another provider is
another credential and another API); only failures that say something about the
provider's health are retried and counted. A rejected credential or request is a
configuration or request problem, not an outage.

**Alternatives**: not advancing on 4xx (a misconfigured key would take a whole route
down although the next target is fine); counting every failure (a bad key would open
the circuit and hide the real cause behind `circuit_open`).

## R-06 Residency: an allowed set on the decision, checked twice

**Decision**: rules and the default chain gain an optional `residency` list (closed list
`local`, `eu`, `us`, `global` of 002). `decide()` copies the matched rule's list (or the
default chain's) into `RoutingDecision.allowedResidencies`, or all four when absent.
`validatePolicy` rejects a chain entry whose target residency is outside its own rule's
list (`rules.N.route.M: target residency "us" is outside the rule's residency` — the
residency is policy data, not request data). The executor checks every target before
calling it and stops with a `ResidencyViolationError` (kind `residency_violation`,
fields `ruleId`, `targetId`, `residency`, `allowed`) mapped to 451 `policy_blocked`.

The shipped `default.yaml` gains two statements: `pinned-local` allows `[local]`, and
`long-documents-eu` allows `[eu, local]` with its chain changed to `[mistral-small,
ollama-llama]` (it listed `openai-mini`, a US target, which would now be a boot error).
The first target of every rule is unchanged, so the routing dataset of 002 keeps 44/44.

**Rationale**: the explicit set is how feature 005 will express "this request may only
go local" (it narrows `allowedResidencies` from sensitivity); this feature builds the
guard that enforces it. An implicit "never weaker than the primary" rule would block
the default chain's EU → US step for every non-sensitive request, which is not what an
operator who wrote that chain means. Boot validation catches contradictions statically
(VI), the runtime guard catches what only a request can decide.

**Alternatives**: implicit ordering local < eu < us/global (surprising for non-sensitive
traffic, see above); skipping a violating target and continuing (a later allowed target
would hide that the chain was misconfigured, and "degrade or skip silently" is what the
constitution forbids — blocking makes the problem visible); filtering the chain in
`decide()` (the decision would no longer show what the policy said, and 005's narrowing
happens after decide).

## R-07 Request deadline

**Decision**: `resilience.requestDeadlineMs` (default 60 000) starts at the use case's
first `clock.now()`. Each attempt runs with `min(effectiveTimeoutMs, remaining)`; a
retry wait or a next target is not started when the remaining time is below 1 ms or
below the wait. Exhausting the deadline yields `provider_timeout` (504) with the targets
tried so far in `x-tamiz-fallback`.

**Rationale**: three targets × two attempts × 60 s would otherwise hold a client for six
minutes. A single number per policy is enough (X).

**Alternatives**: deadline from a client header (no standard header in the OpenAI
protocol; a later feature can add one); no deadline (unbounded worst case).

## R-08 One chain executor for both completion and streaming

**Decision**: `application/resilience/execute-chain.ts` exports
`executeChain(deps)(decision, attempt)` where `attempt(target, { timeoutMs, signal })`
returns `Promise<Result<T, ProviderError>>`. It returns `Result<Served<T>, ChainFailure>`
with `Served = { target, value, abandoned: Abandoned[] }` and `ChainFailure` one of:
exhausted (last error + abandoned), all circuits open (+ shortest remaining cool-down),
residency violation, deadline. `routeInference` uses it with `T = ProviderCompletion`;
`streamInference` uses it with `T = StartedStream` (resolved at the first token, R-09).

**Rationale**: fallback, retry, breaker and residency rules must be identical before
the first token (FR-023); one function guarantees it. The executor is a composition of
the R-02 and R-04 functions, not a class hierarchy (IX).

**Alternatives**: duplicate loops in two use cases (drift); a generic resilience
"pipeline" framework (X).

## R-09 Streaming port and adapters

**Decision**: `LlmProviderPort` gains `stream(input): Promise<Result<StartedStream,
ProviderError>>`. The promise resolves only when the first text delta arrives (or fails
before it), so a pre-first-token failure is an ordinary `ProviderError` and goes
through R-08. `StartedStream = { first: string; rest: AsyncIterable<StreamPart> }` with
`StreamPart` = `{ type: "delta", text }` | `{ type: "finish", finishReason, usage? }` |
`{ type: "error", error: ProviderError }`. The AI SDK adapter uses `streamText(...)`
with `maxRetries: 0` and the same signals as `generateText`, iterates `fullStream`
(v6 part types `text-delta`, `finish`, `error`, `abort`; verified in the installed
`index.d.ts`), maps `error` parts with the R-05 table of 002 and an inter-chunk idle
timer (FR-025) that aborts the call. A stream that ends without `finish` yields an
`error` part (`malformed_response`).

**Rationale**: the use case never sees AI SDK types; the "first token" boundary is
explicit in the type.

**Alternatives**: returning the raw `fullStream` (AI SDK types leak into application);
a callback API (harder to compose with the executor).

## R-10 Server-sent events in the presentation layer

**Decision**: `POST /v1/chat/completions` keeps one route; when the validated body has
`stream: true` the handler calls `streamInference`. On `ok` it sets `x-tamiz-route`,
`x-tamiz-rule`, `x-tamiz-fallback` and then uses Hono's `streamSSE` to write `data:`
lines with `ChatCompletionChunk` JSON (`object: "chat.completion.chunk"`, same `id` and
`created` for every chunk), then a usage chunk (`choices: []`, `usage` with `cost_usd`
and `estimated`), then `data: [DONE]`. A mid-stream `error` part writes one
`data: {"error": {...ErrorEnvelope.error}}` line and closes without `[DONE]` (the
shape OpenAI's own SDK raises as an API error). `c.req.raw.signal` aborts the upstream
call on disconnect. On `err` before the first token the JSON error response of the
non-streaming path is returned. The request contract accepts `stream: true` and
`stream_options: { include_usage?: boolean }` (accepted for compatibility; Tamiz always
sends the usage chunk because cost visibility is a product promise).

**Rationale**: OpenAI-compatible clients already parse this format; headers are known
when the stream starts because streaming begins only after the first token (FR-022).

**Alternatives**: always omitting the usage chunk unless requested (hides cost); a
custom event name for errors (`event: error`) (OpenAI clients ignore unknown event
names, the error would go unnoticed).

## R-11 Shared state with Redis/Valkey

**Decision**: `infrastructure/cache/redis-circuit-state.ts` implements the port with
`ioredis` 5 (works with Valkey), keys `tamiz:circuit:{targetId}:{failures|open|pending|trial}`,
the operations of R-04, and a wrapper that switches to the in-memory adapter on
connection errors (`ioredis` `error`/`end` events; reconnection switches back) logging
one `warn` per switch. `REDIS_URL` (optional) selects it in `main.ts`; absent means
in-memory. Tests use Testcontainers with the `valkey/valkey:8` image through
`@testcontainers/redis`-compatible `GenericContainer` and are tagged as integration
tests (skipped when Docker is unavailable, with a visible skip reason). `docker-compose.yml`
does not exist yet on `main`; `T-003-06` creates it with the `valkey` service only and
the OPS task extends it.

**Rationale**: the stack in `CLAUDE.md` names Redis (Valkey); `ioredis` is the de-facto
client with Valkey support; `SET NX PX` gives the single trial across instances.

**Alternatives**: `node-redis` 5 (equivalent; `ioredis` has simpler reconnect events);
`iovalkey` (a fork with a smaller user base); Postgres advisory locks (no database until
feature 006).

## R-12 Routing events port and the log sink

**Decision**: `application/ports/routing-events.port.ts` declares `RoutingEventsPort {
emit(event: RoutingEvent): void }` (fire-and-forget, never throws into the request).
`RoutingEvent` is a discriminated union on `type`: `attempt.started`,
`attempt.succeeded`, `attempt.failed`, `retry.scheduled`, `fallback`, `target.skipped`,
`residency.blocked`, `circuit.changed`, `stream.failed`. Fields: `requestId`, `targetId`,
`provider`, `residency`, `attempt`, `reason`, `durationMs`, `at` (ISO from the clock);
never messages, text, keys or upstream bodies (the type has no field for them).
`infrastructure/telemetry/log-routing-events.ts` writes each event as one `info` (or
`warn` for `circuit.changed` to open, `residency.blocked`, `stream.failed`) line through
the logger port. Tests use `createScriptedPort` or a recording array.

**Rationale**: constitution VI wants trace event + metric + response field; this
feature delivers the event and the field, feature 006 adds trace and metric sinks to
the same port (FR-018).

**Alternatives**: logging directly from the executor (006 would have to parse logs);
an event emitter class (IX).

## R-13 New error types and statuses

**Decision**: contract `ErrorTypeSchema` gains `provider_unavailable` → 503 (all
circuits open; `retry-after` header in seconds, rounded up). `policy_blocked` (451,
001) is used for residency violations. Domain `DomainError` gains
`ResidencyViolationError` and `ProviderUnavailableError` (`retryAfterMs`). The mapper
keeps the exhaustive switch; `test/result.test.ts` and the mapper switch are updated
(T-002-03 pitfall).

**Rationale**: a client should distinguish "the provider failed" (502), "too slow"
(504), "nothing is up right now, retry later" (503) and "your request may not go where
it would have to go" (451).

**Alternatives**: 502 for all-open (loses the retry hint); 403 for residency (it is not
an authorisation problem of the client).

## R-14 Policy file extension

**Decision**: `RoutingPolicySchema` gains:

```yaml
resilience:            # optional, every field optional with the default shown
  requestDeadlineMs: 60000
  maxAttempts: 2       # per target, including the first
  backoff: { baseDelayMs: 250, maxDelayMs: 2000 }
  circuitBreaker: { failureThreshold: 5, cooldownMs: 30000 }
rules:
  - id: …
    residency: [eu, local]   # optional, non-empty, unique
default:
  route: […]
  residency: […]             # optional
```

Ranges: `requestDeadlineMs` ≥ 1 000, `maxAttempts` 1 … 5, `baseDelayMs` ≥ 1,
`maxDelayMs` ≥ `baseDelayMs` (domain check), `failureThreshold` ≥ 1, `cooldownMs` ≥
1 000. Domain `RoutingPolicy.resilience` is always present after validation (defaults
filled). The 002 dataset header still names `default.yaml`; its first routes do not
change (R-06).

**Rationale**: FR-020; defaults keep every existing file valid.

**Alternatives**: environment variables for resilience settings (they belong with the
routes they protect); per-target settings now (X).

## R-15 Test strategy

**Decision**: domain circuit transitions with unit and `fast-check` property tests;
`timeout`/`retry`/`circuit-breaker`/`executeChain` with the fake clock, a seeded random
and scripted providers, plus a property test over generated chains, residency sets and
failure scripts (SC-002, SC-003); presentation with `app.request()` (headers, statuses,
SSE body parsed line by line); adapters' `stream` with MSW returning `text/event-stream`
bodies built with `ReadableStream` (success, error before first chunk, error after two
chunks, stall); Redis adapter with Testcontainers; boot test for a contradictory
residency policy. No real waits outside the adapter timeout tests (200 ms) and the
Redis test.

**Rationale**: SC-006 (no real waiting in the resilience suites) and the 002 pattern.

**Alternatives**: `nock` for SSE (not fetch-native); an in-memory Redis mock (does not
prove `SET NX PX` semantics).
