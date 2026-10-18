# Data Model: Contracts and Skeleton

**Feature**: `001-contracts-and-skeleton` · **Date**: 2026-10-18

Nothing is persisted in this feature. The "data model" is the set of contract schemas,
branded types and domain value types that later features build on. All schemas are Zod 4
`strictObject`s unless stated; field names follow the public OpenAI chat completion
shape where the spec says so (FR-008).

## 1. Branded types (`@tamiz/contracts/branded`)

| Type | Base | Constraint | Constructor | Used for |
|---|---|---|---|---|
| `RequestId` | `string` | non-empty, ≤ 128 chars, `^[A-Za-z0-9_-]+$` | `requestId(value)` | correlating a request across logs, audit, headers |
| `PolicyId` | `string` | non-empty, ≤ 64 chars, same charset | `policyId(value)` | identifying a routing policy (feature 002) |
| `Usd` | `number` | finite, ≥ 0 | `usd(value)` | cost per request (feature 002) |
| `Milliseconds` | `number` | finite, ≥ 0, integer | `milliseconds(value)` | durations: uptime, latency, timeouts |

Rules: brands are distinct (`Usd` is not assignable to `Milliseconds`, `RequestId` not
to `PolicyId`); raw primitives are not assignable to a branded type; the constructor
parses and throws on invalid input (contracts are the edge, exceptions are acceptable
there) and a `safe*` variant returns the Zod `SafeParseResult` for callers that want
`Result`-style handling.

## 2. ChatCompletionRequest (non-streaming subset)

| Field | Type | Rules |
|---|---|---|
| `model` | string | non-empty |
| `messages` | `ChatMessage[]` | min 1 item |
| `temperature` | number, optional | `0 ≤ t ≤ 2` |
| `max_tokens` | integer, optional | `> 0` |
| `stream` | literal `false`, optional | `true` is rejected until feature 003 |
| `user` | string, optional | ≤ 256 chars |

`ChatMessage`: `{ role: "system" | "user" | "assistant"; content: string }`. Unknown keys
anywhere are rejected (`strictObject`). Fields outside this list (tools, response_format,
logprobs, content parts) are rejected as unknown until a later feature adds them.

## 3. ChatCompletionResponse (non-streaming)

| Field | Type | Rules |
|---|---|---|
| `id` | string | non-empty |
| `object` | literal `"chat.completion"` | |
| `created` | integer | Unix seconds, ≥ 0 |
| `model` | string | non-empty |
| `choices` | `Choice[]` | min 1 item |
| `usage` | `Usage` | required |

`Choice`: `{ index: integer ≥ 0; message: ChatMessage (role "assistant"); finish_reason: "stop" | "length" | "content_filter" }`.
`Usage`: `{ prompt_tokens: integer ≥ 0; completion_tokens: integer ≥ 0; total_tokens: integer ≥ 0 }`.

Note: the Tamiz-specific routing headers (`x-tamiz-route`, `x-tamiz-fallback`) are
response headers, not body fields; they are specified in feature 002.

## 4. HealthResponse

| Field | Type | Rules |
|---|---|---|
| `status` | `"ok" \| "degraded"` | |
| `version` | string | non-empty (semver or git describe) |
| `uptimeMs` | `Milliseconds` | ≥ 0 |
| `checks` | `HealthCheck[]`, optional | present and non-empty when `status` is `degraded` (refinement) |

`HealthCheck`: `{ name: string; status: "ok" | "degraded" | "down"; detail?: string }`.
The skeleton always returns `status: "ok"` without `checks`; features 006 and OPS fill
`checks` (database, cache, privacy service).

## 5. ErrorEnvelope

```text
{ error: { type: ErrorType; message: string; requestId?: RequestId } }
```

`ErrorType` (closed enum): `invalid_request`, `unauthorized`, `not_found`,
`rate_limited`, `provider_error`, `policy_blocked`, `internal`.

HTTP status mapping used by the gateway mapper (later features reuse it):

| `type` | HTTP |
|---|---|
| `invalid_request` | 400 |
| `unauthorized` | 401 |
| `not_found` | 404 |
| `rate_limited` | 429 |
| `policy_blocked` | 451 |
| `provider_error` | 502 |
| `internal` | 500 |

`message` never contains a stack trace or prompt content.

## 6. Domain types (`apps/gateway/src/domain`)

### `Result<T, E>`

```text
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
ok(value), err(error), isOk(r), isErr(r), map(r, f), mapErr(r, f), andThen(r, f), unwrapOr(r, fallback)
```

Pure functions, no classes, no exceptions. Later features add `all()`/`fromPromise()`
when a use case needs them (constitution X).

### `DomainError`

Discriminated union on `kind`:

| `kind` | Fields | Meaning |
|---|---|---|
| `validation` | `message`, `issues: { path: string; message: string }[]` | input failed a rule |
| `configuration` | `message`, `issues` | environment / policy configuration invalid |
| `not_found` | `message`, `resource: string` | a named thing does not exist |

Each variant has a constructor (`validationError(...)`) and the union is exhaustive so
`switch (error.kind)` can be checked by the compiler. The mapping `DomainError →
ErrorEnvelope.type` lives in `presentation/mappers`.

## 7. GatewayConfig (`apps/gateway/src/infrastructure/config`)

| Setting | Env var | Type | Default |
|---|---|---|---|
| `port` | `PORT` | integer 1–65535 | `3000` |
| `host` | `HOST` | string | `0.0.0.0` |
| `logLevel` | `LOG_LEVEL` | `fatal \| error \| warn \| info \| debug \| trace` | `info` |
| `nodeEnv` | `NODE_ENV` | `development \| test \| production` | `development` |
| `version` | `APP_VERSION` | string | gateway `package.json` version |

`loadConfig(env) → Result<GatewayConfig, ConfigurationError>`. Values are read once at
boot; the config object is frozen and injected, never read from `process.env` elsewhere.

## 8. ClockPort and FakeClock

`ClockPort = { now(): Date }` in `application/ports`. `SystemClock` (infrastructure)
returns `new Date()`. `createFakeClock(start)` (test-utils) returns the port plus
`advance(ms)` and `set(date)`; time never moves on its own.

## 9. Relationships

```text
ChatCompletionRequest ──contains──▶ ChatMessage ◀──contains── Choice ◀── ChatCompletionResponse
HealthResponse.uptimeMs : Milliseconds          ErrorEnvelope.error.requestId : RequestId
GatewayConfig ──feeds──▶ logger, server, HealthResponse.version
ClockPort ──feeds──▶ HealthResponse.uptimeMs (now − startedAt)
DomainError ──mapped by presentation──▶ ErrorEnvelope
```
