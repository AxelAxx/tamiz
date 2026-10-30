# Data Model: Resilience

**Feature**: `003-resilience` · **Date**: 2026-10-30 · **Spec**: [spec.md](spec.md) ·
**Research**: [research.md](research.md)

Additions to the shapes of features 001 and 002. Nothing listed in those data models
is redefined; every change here is an extension. Paths are under `apps/gateway/src/`
unless they start with `packages/`.

## 1. Contract extensions (`packages/contracts`)

### 1.1 `error.ts`

| Change | Value |
|---|---|
| `ErrorTypeSchema` | + `provider_unavailable` |
| `errorTypeToHttpStatus` | `provider_unavailable: 503` |

### 1.2 `chat-completion.ts`

| Schema | Change |
|---|---|
| `ChatCompletionRequestSchema.stream` | `z.boolean().optional()` (was `z.literal(false)`) |
| `ChatCompletionRequestSchema.stream_options` | new, optional `z.strictObject({ include_usage: z.boolean().optional() })` |
| `ChatCompletionChunkSchema` | new, see below |
| `StreamErrorEventSchema` | new: `z.strictObject({ error: ErrorEnvelopeSchema.shape.error })` |

```text
ChatCompletionChunk {
  id: string                       // "chatcmpl-<requestId>", same for every chunk
  object: "chat.completion.chunk"
  created: int ≥ 0                 // same for every chunk
  model: string                    // provider model name of the answering target
  choices: [{ index: 0, delta: { role?: "assistant"; content?: string },
              finish_reason: "stop" | "length" | "content_filter" | null }]   // [] on the usage chunk
  usage?: ChatCompletionUsage      // only on the usage chunk (cost_usd and estimated set)
}
```

### 1.3 `routing-policy.ts`

```text
ResilienceSettings (all optional; defaults in brackets) {
  requestDeadlineMs?: int ≥ 1000            [60000]
  maxAttempts?: int 1..5                    [2]
  backoff?: { baseDelayMs?: int ≥ 1 [250]; maxDelayMs?: int ≥ 1 [2000] }
  circuitBreaker?: { failureThreshold?: int ≥ 1 [5]; cooldownMs?: int ≥ 1000 [30000] }
}
RoutingRule  += residency?: Residency[] (min 1, unique)
default      += residency?: Residency[] (min 1, unique)
RoutingPolicy += resilience?: ResilienceSettings
```

Unknown keys stay rejected (strict objects).

## 2. Domain (`domain/`)

### 2.1 `errors.ts`

| Change | Fields |
|---|---|
| `PROVIDER_ERROR_CAUSES` | + `aborted` (deadline or client disconnect; never retried, never counted, never a fallback reason) |
| `ProviderError` | + `retryAfterMs?: Milliseconds` (from an upstream `retry-after` header) |
| new `ResidencyViolationError` | `kind: "residency_violation"`, `ruleId: RuleId \| "default"`, `targetId: TargetId`, `residency: Residency`, `allowed: Residency[]`, `message` |
| new `ProviderUnavailableError` | `kind: "provider_unavailable"`, `retryAfterMs: Milliseconds`, `message` |

`DomainError` widens accordingly; every exhaustive switch (`presentation/mappers/error-envelope.ts`,
`test/result.test.ts`) gains the cases: `residency_violation` → `policy_blocked` (451),
`provider_unavailable` → `provider_unavailable` (503).

### 2.2 `model/routing-policy.ts`

```text
ResilienceSettings {        // always complete after validatePolicy
  requestDeadlineMs: Milliseconds
  maxAttempts: number       // 1..5
  backoff: { baseDelayMs: Milliseconds; maxDelayMs: Milliseconds }
  circuitBreaker: { failureThreshold: number; cooldownMs: Milliseconds }
}
RoutingRule    += residency?: ReadonlyArray<Residency>
RoutingPolicy  += resilience: ResilienceSettings
               ;  default += residency?: ReadonlyArray<Residency>
DEFAULT_RESILIENCE: ResilienceSettings   // the bracketed defaults of §1.3
```

`validatePolicy` additions (one issue per problem, path + message, never request data):

- `maxDelayMs < baseDelayMs` → `resilience.backoff.maxDelayMs: expected at least baseDelayMs`.
- duplicate residency in a list → `rules.N.residency.M: expected each residency at most once`.
- chain entry outside its rule's (or the default's) residency list →
  `rules.N.route.M: expected a target whose residency is in the rule's residency list (target residency "us")`.

### 2.3 `model/routing-decision.ts`

```text
RoutingDecision += allowedResidencies: ReadonlyArray<Residency>   // rule's, default's, or all RESIDENCIES
```

`decide()` stays total and pure; the property test gains "every decision's
`allowedResidencies` is non-empty and equals the matched source's list or all four".

### 2.4 `model/circuit.ts` (new)

```text
CIRCUIT_STATES = ["closed", "open", "half_open"] as const
CircuitSnapshot { failures: number; openUntil?: number /* epoch ms */; trialPending: boolean }
stateAt(snapshot, nowMs): CircuitState
  // openUntil > nowMs                      → "open"
  // trialPending (and not open)            → "half_open"
  // otherwise                              → "closed"
remainingCooldownMs(snapshot, nowMs): number   // 0 unless open
```

### 2.5 `model/fallback.ts` (new)

```text
FALLBACK_REASONS = ["rate_limited", "http_error", "timeout", "network",
                    "malformed_response", "authentication", "circuit_open"] as const
Abandoned { targetId: TargetId; reason: FallbackReason }
formatFallbackHeader(abandoned): string   // "a:timeout,b:circuit_open"
```

## 3. Application (`application/`)

### 3.1 Ports

```text
ClockPort (001) += sleep(ms: Milliseconds, signal?: AbortSignal): Promise<void>

LlmProviderPort (002):
  complete(input)                                    // unchanged
  stream(input): Promise<Result<StartedStream, ProviderError>>   // new, resolves at first token
ProviderCompletionInput += signal?: AbortSignal
StartedStream { first: string; modelName: string; rest: AsyncIterable<StreamPart> }
StreamPart = { type: "delta"; text: string }
           | { type: "finish"; finishReason: FinishReason; usage?: ProviderUsage }
           | { type: "error"; error: ProviderError }

CircuitStatePort (new):
  snapshot(targetId): Promise<CircuitSnapshot>
  recordFailure(targetId): Promise<number>
  recordSuccess(targetId): Promise<void>
  open(targetId, cooldownMs: Milliseconds): Promise<void>
  tryAcquireTrial(targetId, leaseMs: Milliseconds): Promise<boolean>

RoutingEventsPort (new):
  emit(event: RoutingEvent): void
RoutingEvent = { type: "attempt.started" | "attempt.succeeded" | "attempt.failed"
                     | "retry.scheduled" | "fallback" | "target.skipped"
                     | "residency.blocked" | "circuit.changed" | "stream.failed";
                 requestId; targetId; provider; residency; at: string;
                 attempt?; reason?; durationMs?; waitMs?; from?: CircuitState; to?: CircuitState }
```

### 3.2 Resilience functions (`application/resilience/`)

| Module | Export | Contract |
|---|---|---|
| `timeout.ts` | `withTimeout(clock)(ms, run)` | resolves to `run`'s result or a `timeout` `ProviderError`; aborts `run`'s signal on expiry |
| `retry.ts` | `withRetry({ clock, random, events, settings })(target, attempt, deadline)` | FR-003, FR-004; returns the last result |
| `circuit-breaker.ts` | `createCircuitBreaker({ state, clock, events, settings })` → `{ admit(target), onResult(target, result) }` | FR-006 … FR-009; `admit` → `"call" \| "trial" \| { skip: remainingMs }` |
| `execute-chain.ts` | `executeChain(deps)(request, decision, attempt)` | R-08; returns `Result<Served<T>, ChainFailure>` |

```text
Served<T>    { target: ModelTarget; value: T; abandoned: ReadonlyArray<Abandoned> }
ChainFailure = { kind: "exhausted"; target: ModelTarget; error: ProviderError; abandoned }
             | { kind: "unavailable"; retryAfterMs: Milliseconds; abandoned }
             | { kind: "residency"; error: ResidencyViolationError; abandoned }
             | { kind: "deadline"; target?: ModelTarget; abandoned }
```

### 3.3 Use cases

```text
RouteInferenceDeps += circuits: CircuitBreaker; events: RoutingEventsPort; random: () => number
RoutedCompletion   += abandoned: ReadonlyArray<Abandoned>
RoutingFailure     := { decision; failure: ChainFailure }        // replaces { decision, target, error }

StreamInference (new): (request, signal) => Promise<Result<RoutedStream, RoutingFailure>>
RoutedStream { decision; target; abandoned; modelName; first: string;
               parts: AsyncIterable<StreamPart>;          // usage resolved/estimated on finish
               createdAt: Date }
```

`routeInference` order: classify → `getActive` → `decide` → deadline from the clock →
`executeChain(attempt = provider.complete)` → usage and cost of the serving target
(002) → `createdAt`. `streamInference` is the same with `attempt = provider.stream`;
usage and cost are computed when the `finish` part arrives (estimated from the streamed
text when the provider reports none).

## 4. Infrastructure

| Module | Role |
|---|---|
| `clock/system-clock.ts` | + `sleep` via `setTimeout`, rejects on abort |
| `llm/ai-sdk-provider.ts` | + `stream` via `streamText` / `fullStream`; `signal` combined with the timeout; `retryAfterMs` from `APICallError.responseHeaders["retry-after"]` |
| `cache/in-memory-circuit-state.ts` | `CircuitStatePort` over a `Map`, times from the clock port |
| `cache/redis-circuit-state.ts` | `CircuitStatePort` over `ioredis` (R-11), with fallback to in-memory |
| `telemetry/log-routing-events.ts` | `RoutingEventsPort` → logger port (R-12) |
| `config/env.ts` | + `REDIS_URL` (optional URL) |

## 5. Presentation

| Change | Detail |
|---|---|
| `routes/chat-completions.ts` | `stream: true` → `streamInference` + `streamSSE`; headers `x-tamiz-fallback` (only when non-empty), `retry-after` on 503; OpenAPI response content `text/event-stream` documented |
| `mappers/chat-completion-chunk.ts` | `StreamPart` → `ChatCompletionChunk` / usage chunk / error event, each validated against the contract |
| `mappers/error-envelope.ts` | new kinds (§2.1); `ChainFailure` → status, envelope and headers |

## 6. Configuration

| Setting | Env var | Type | Default |
|---|---|---|---|
| `redisUrl` | `REDIS_URL` | URL (`redis://` or `rediss://`) | unset → in-memory circuit state |

Policy-level settings are in §1.3 and live in the policy file, not the environment.

## 7. Relationships

```text
InferenceRequest ─classify→ ClassifiedRequest ─decide(policy)→ RoutingDecision{chain, allowedResidencies}
      │                                                          │
      └──────────────── executeChain ◀───────────────────────────┘
                         │  per target: residency guard → breaker.admit → withRetry(withTimeout(attempt))
                         │              → breaker.onResult → events.emit
                         ▼
             Served{target, value, abandoned} | ChainFailure
                         │
        RoutedCompletion / RoutedStream ──presentation──▶ 200 JSON | SSE | 451/502/503/504 + headers
```
