# Implementation Plan: Resilience

**Branch**: `003-resilience` | **Date**: 2026-10-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-resilience/spec.md`

## Summary

Make the routing of feature 002 resilient without changing who decides the route. The
application gains small, composable resilience functions over the clock port
(`withTimeout`, `withRetry` with exponential backoff and full jitter, a per-target
circuit breaker whose pure transitions live in the domain and whose state sits behind a
`CircuitStatePort`), and one `executeChain` that walks the decided chain applying, per
target: residency guard → breaker → retry(timeout(attempt)) → breaker update → event.
`routeInference` uses it for completions; a new `streamInference` uses it for streams
whose start is the first token. The decision carries the allowed residencies declared
on rules and the default chain; a target outside them is never called (451). Every step
is an event on a `RoutingEventsPort` (log sink now, telemetry sinks in 006), and
responses say what happened with `x-tamiz-fallback`. `POST /v1/chat/completions`
accepts `stream: true` and answers with OpenAI-compatible server-sent events. Circuit
state is in memory by default and shared through Redis/Valkey when `REDIS_URL` is set.

## Technical Context

**Language/Version**: TypeScript 5.x strict (001 flags), ESM, Node.js 22 LTS.

**Primary Dependencies**: features 001/002 set (Hono 4 with `hono/streaming`
`streamSSE`, `@hono/zod-openapi` 1.6, Zod 4, pino, AI SDK 6 `generateText` and
`streamText` with `maxRetries: 0`, `@ai-sdk/*` on the `ai-v6` lines) plus `ioredis` 5
(`T-003-06`); dev: `msw` 2 (streaming bodies), `fast-check`, `testcontainers` 11 with the
`valkey/valkey:8` image (`T-003-06`).

**Storage**: circuit state in memory (default) or Redis/Valkey keys with expiry
(`T-003-06`). No database (feature 006).

**Testing**: Vitest root projects; fake clock with pending sleepers (R-01) and a seeded
random for every resilience test; `fast-check` property tests for the executor (SC-002,
SC-003) and the circuit transitions; MSW `text/event-stream` bodies for the four
adapters' `stream`; `app.request()` for headers, statuses and SSE bodies; Testcontainers
for the Redis adapter (skipped with a reason when Docker is absent); the boot test gains
the contradictory-residency case.

**Target Platform**: Linux containers, GitHub Actions `ubuntu-latest` (Docker available
for Testcontainers); developed on Windows 11.

**Project Type**: monorepo (one web service + libraries), unchanged.

**Performance Goals**: resilience overhead < 2 ms p95 when healthy (SC-005); first
streamed chunk forwarded < 20 ms p95 in-process (SC-007); resilience suites < 10 s with
no real waits (SC-006).

**Constraints**: domain and application import no library (001 rules); no message
content, keys or upstream bodies in events, logs or errors (V); AI SDK retries stay off
(the executor is the only retry layer); a residency violation blocks, never degrades
(VI); every wait and cool-down goes through `ClockPort` (VIII); existing policy files
stay valid (all new policy fields optional).

**Scale/Scope**: 5 backlog tasks (`T-003-02` … `T-003-06`); ~10 new
domain/application modules, 2 new ports, 3 infrastructure adapters, 1 new contract
schema family (chunks), 1 new error type; ≈ 31 FRs, 7 stories.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | How this plan complies | Status |
|---|---|---|---|
| I | Strict Clean Architecture | Domain gains pure `circuit.ts`, `fallback.ts` and the residency fields; application gains `ports/{circuit-state,routing-events}.port.ts`, `resilience/*`, `use-cases/stream-inference.ts`, importing only domain; adapters in `infrastructure/{cache,telemetry,llm,clock}`; presentation maps to contracts; `main.ts` wires. `pnpm arch` must stay green. | PASS |
| II | Contract-first | `ChatCompletionChunkSchema`, `StreamErrorEventSchema`, `provider_unavailable`, `stream: true`, the policy's `resilience`/`residency` fields are Zod in `@tamiz/contracts`; the OpenAPI document is still generated from them (`.meta({ id })`, 002 pitfall). | PASS |
| III | Spec before code | Every acceptance scenario maps to a test task (coverage table in `tasks.md`). | PASS |
| IV | Evals are executable spec | No new AI behaviour (resilience is deterministic); the routing dataset of 002 must stay at 44/44 after the default policy's residency edits (R-06), checked in `T-003-04`. The resilience thresholds are SC-001 … SC-008, enforced by tests. | PASS |
| V | Privacy by default | Events have no field for content (R-12); residency guard blocks instead of degrading (R-06); 451 messages carry policy data only. | PASS |
| VI | Fail fast, never silently | Every fallback, skip, retry, block and circuit change is an event and, for fallbacks, a response header; contradictory residency statements stop boot; deadline-bounded execution. | PASS |
| VII | Strict TypeScript | Closed lists as tuples (`CIRCUIT_STATES`, `FALLBACK_REASONS`, new causes); discriminated unions for events, stream parts and chain failures; no `any`. | PASS |
| VIII | Testability | Time and waiting via `ClockPort` (R-01), randomness injected (R-02), state via `CircuitStatePort` with an in-memory adapter; no real waits in resilience tests. | PASS |
| IX | Composition over inheritance | `withTimeout`, `withRetry`, the breaker and `executeChain` are functions composed per target (R-02, R-08). | PASS |
| X | Simplicity | Two new ports, each with two real adapters or a sink required by 006 (`CircuitStatePort`: memory + Redis; `RoutingEventsPort`: log now, OTel/audit in 006). Settings per policy, not per target. Randomness is a function, not a port. | PASS |
| — | English-only (ADR-0002) | All artefacts in English. | PASS |
| — | Task protocol | One PR per backlog task `T-003-02` … `T-003-06`. | PASS |

No violations. Two changes to earlier contracts are deliberate and listed for review:
`ClockPort` gains `sleep` (001 port), and `default.yaml` changes the `long-documents-eu`
chain (002 policy, R-06).

**Post-design re-check (after Phase 1)**: unchanged; the design added no port beyond
the two above and no package beyond `ioredis` and `testcontainers` (`T-003-06`).

## Project Structure

### Documentation (this feature)

```text
specs/003-resilience/
├── spec.md              # Specification (T-003-01), draft for Alex's review
├── plan.md              # This file
├── research.md          # Phase 0: decisions R-01 … R-15
├── data-model.md        # Phase 1: contract, domain, port and adapter shapes
├── quickstart.md        # Phase 1: how to verify the feature end to end
├── contracts/
│   ├── README.md
│   ├── http.md                # headers, new statuses, SSE response
│   └── policy.example.yaml    # default policy after 003 (→ apps/gateway/policies/default.yaml)
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root; new or changed files only)

```text
packages/
├── contracts/src/
│   ├── error.ts                     # + provider_unavailable (503)
│   ├── chat-completion.ts           # stream: boolean, stream_options, ChatCompletionChunk, StreamErrorEvent
│   └── routing-policy.ts            # + resilience, residency
└── test-utils/src/fake-clock.ts     # + sleep / pending sleepers resolved by advance()

apps/gateway/
├── policies/default.yaml            # residency statements, resilience section, version 2
├── src/
│   ├── domain/
│   │   ├── errors.ts                # + aborted cause, retryAfterMs, ResidencyViolationError, ProviderUnavailableError
│   │   └── model/
│   │       ├── routing-policy.ts    # + ResilienceSettings, residency, validation
│   │       ├── routing-decision.ts  # + allowedResidencies
│   │       ├── circuit.ts           # new: states and pure transitions
│   │       └── fallback.ts          # new: reasons, Abandoned, header format
│   ├── application/
│   │   ├── ports/
│   │   │   ├── clock.port.ts        # + sleep
│   │   │   ├── llm-provider.port.ts # + stream, signal, StartedStream, StreamPart
│   │   │   ├── circuit-state.port.ts   # new
│   │   │   └── routing-events.port.ts  # new
│   │   ├── resilience/
│   │   │   ├── timeout.ts           # new (T-003-02)
│   │   │   ├── retry.ts             # new (T-003-02)
│   │   │   ├── circuit-breaker.ts   # new (T-003-03)
│   │   │   └── execute-chain.ts     # new (T-003-04)
│   │   └── use-cases/
│   │       ├── route-inference.ts   # uses executeChain (T-003-04)
│   │       └── stream-inference.ts  # new (T-003-05)
│   ├── infrastructure/
│   │   ├── clock/system-clock.ts    # + sleep
│   │   ├── llm/ai-sdk-provider.ts   # + stream, signal, retryAfterMs
│   │   ├── cache/in-memory-circuit-state.ts   # new (T-003-03)
│   │   ├── cache/redis-circuit-state.ts       # new (T-003-06)
│   │   ├── telemetry/log-routing-events.ts    # new (T-003-04)
│   │   └── config/env.ts            # + REDIS_URL (T-003-06)
│   ├── presentation/
│   │   ├── routes/chat-completions.ts         # SSE branch, new headers and statuses
│   │   ├── mappers/chat-completion-chunk.ts   # new
│   │   ├── mappers/error-envelope.ts          # new kinds, ChainFailure mapping
│   │   └── openapi-schemas.ts                 # + ChatCompletionChunk component
│   └── main.ts                      # circuit state (memory | Redis), events sink, random
└── test/
    ├── resilience/{timeout,retry,circuit-breaker,execute-chain}.test.ts
    ├── resilience/execute-chain.property.test.ts
    ├── domain/{circuit,fallback}.test.ts, domain/routing-policy.test.ts (extended)
    ├── application/{route-inference,stream-inference}.test.ts
    ├── llm/*.adapter.test.ts         # + streaming scenarios
    ├── cache/{in-memory,redis}-circuit-state.test.ts
    ├── chat-completions.test.ts      # fallback headers, 451/503/504, SSE
    └── boot.integration.test.ts      # contradictory residency
docker-compose.yml                    # new: valkey service only (T-003-06; OPS extends it)
.env.example                          # new: REDIS_URL documented (T-003-06)
```

**Structure Decision**: the gateway layers of `CLAUDE.md` section 5; resilience
functions live in `application/resilience/` as the project document's layout says. The
in-memory circuit-state adapter is a production adapter (single instance), so it lives
in `infrastructure/cache/` rather than in `@tamiz/test-utils` (the backlog row of
`T-003-03` says test-utils; tests import the infrastructure adapter directly, which the
architecture rules allow for tests). Fakes that are still generic (clock, scripted
port) stay in `@tamiz/test-utils`.

## Requirement → task mapping

| Backlog task | Requirements | Spec stories |
|---|---|---|
| `T-003-02` Composable timeout and retry (+ `ClockPort.sleep`, fake clock sleepers) | FR-001 … FR-005 | US3 |
| `T-003-03` Circuit breaker, `CircuitStatePort`, in-memory adapter | FR-006 … FR-010 | US4 |
| `T-003-04` Chain execution, residency guard, events, headers, policy extension | FR-011 … FR-020 | US1, US2, US5 |
| `T-003-05` Streaming: port, adapters, `StreamInference`, SSE endpoint | FR-021 … FR-028 | US6 |
| `T-003-06` Redis/Valkey circuit state + Testcontainers + compose | FR-029 … FR-031 | US7 |

Order: `T-003-02` → `T-003-03` → `T-003-04` → `T-003-05`; `T-003-06` needs only
`T-003-03` and can run in parallel with `T-003-04`/`T-003-05` (disjoint files except
`main.ts` and `env.ts`; rebase on whichever merges second). Feature 005 (`T-005-05`
streaming de-anonymization) depends on `T-003-05`; feature 006 adds sinks to the
`RoutingEventsPort`.

## Complexity Tracking

No constitution violations to justify. For review:

- **R-06 residency model**: explicit allowed set per rule/default (absent = all), boot
  check for contradictions, runtime block. The alternative "never weaker than the
  primary" was rejected because it blocks the default chain for non-sensitive traffic.
- **R-05**: any final failure advances the chain; only retryable ones are retried and
  counted.
- **`default.yaml` change** (R-06): `long-documents-eu` drops `openai-mini`; policy
  version 2. The routing dataset's first routes are unchanged.
- **`ClockPort.sleep`** (R-01) extends a 001 port instead of adding a scheduler port.
