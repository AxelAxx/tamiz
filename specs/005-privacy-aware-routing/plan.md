# Implementation Plan: Privacy-Aware Routing

**Branch**: `005-privacy-aware-routing` | **Date**: 2026-10-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-privacy-aware-routing/spec.md`

## Summary

The gateway inspects every request before deciding and executing.

- **Detection.** A new `PiiDetectorPort` returns the findings and the sensitivity level
  of the request's messages, or a typed failure. Its HTTP adapter calls the privacy
  service's `/analyze` once per request, over the messages joined by a blank line. It
  validates the answer with a Zod mirror of `services/privacy/openapi.json`, maps
  code-point offsets back to per-message UTF-16 offsets, and is wrapped by an in-memory
  LRU cache keyed by a SHA-256 hash, which stores positions only.
- **Decision.** The domain grows `SensitivityLevel`, `PrivacyAction` and a `privacy`
  section of the policy. `decide()` combines the rule match with the level's action:
  - the chain is filtered by the level's residencies;
  - `restrict_to_local` uses `localRoute`;
  - `block` and empty chains become blocks.
- **Execution.** `RouteInference` and `StreamInference` run inspection concurrently with
  classification and apply the action:
  - for `anonymize`, they replace findings with `<KIND_n>` (a TypeScript port of feature
    004's rule, held to the same test vectors), add the versioned placeholder notice, and
    restore the answer in one pass;
  - streaming restores through a placeholder-safe buffer;
  - detector failures apply `onDetectorError`;
  - every step is a routing event with no content.
- **Endpoints.** `POST /v1/simulate` runs everything except the provider call.
- **Responses.** New headers `x-tamiz-sensitivity` and `x-tamiz-privacy`, and a new
  error type `privacy_unavailable` (503).

## Technical Context

**Language/Version**: TypeScript 5.x strict (001 flags), ESM, Node.js 22 LTS.

**Primary Dependencies**:
- the 001–003 set: Hono 4 with `streamSSE`, `@hono/zod-openapi` 1.6, Zod 4, pino, AI SDK 6;
- Node's `crypto` (SHA-256) and global `fetch` for the detector adapter;
- no new runtime dependency;
- dev: MSW 2 (detector adapter tests) and `fast-check` (decision and streaming
  properties).

**Storage**: in-process LRU cache for detection results (positions only). No database
(feature 006).

**Testing**:
- Vitest root projects;
- `FakePiiDetector` in `@tamiz/test-utils`;
- MSW for the HTTP adapter (contract mismatch, timeout, 5xx);
- `fast-check` for SC-001 (≥ 10 000 decisions) and SC-003 (all chunk splits);
- `app.request()` for headers, statuses and `/v1/simulate`;
- shared placeholder test vectors with the Python service;
- a log, event and cache capture that fails on any test value (SC-006);
- the routing dataset of 002 must stay at ≥ 95 % after the policy changes.

**Target Platform**: Linux containers, GitHub Actions `ubuntu-latest`; developed on
Windows 11.

**Project Type**: monorepo (one web service + libraries + the Python service), unchanged.

**Performance Goals**: inspection overhead p95 < 30 ms on a cache hit, and < detector
latency + 10 ms on a miss (SC-005); stream buffer latency bounded by the longest
placeholder (≈ 16 characters).

**Constraints**:
- domain and application import no library (001 rules);
- no message content, values or mappings in events, logs, errors, headers or the cache
  (V);
- detection failure never routes as clean (VI);
- every wait goes through `ClockPort` (VIII);
- the policy file format changes (version 3, required `privacy` section): the two shipped
  policies are updated in the same PR as the loader.

**Scale/Scope**:
- 5 backlog tasks (`T-005-02` … `T-005-06`);
- about 6 new domain/application modules, 1 new port plus a cache port, 2
  infrastructure adapters and 1 new route;
- new contract schemas for the privacy service mirror and the simulator;
- 20 FRs, 7 stories, 34 scenarios.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | How this plan complies | Status |
|---|---|---|---|
| I | Strict Clean Architecture | **Domain** gains `sensitivity.ts` (levels, entities), `privacy-policy.ts` (actions, validation, the decision's privacy step) and `placeholders.ts` (pure, port of 004 R-07) and `restore-stream.ts` (pure buffer). **Application** gains `ports/pii-detector.port.ts`, `ports/detection-cache.port.ts` and `use-cases/{inspect-sensitivity,simulate-policy}.ts`. **Adapters** live in `infrastructure/privacy/` and `infrastructure/cache/`. `pnpm arch` must stay green. | PASS |
| II | Contract-first | The privacy service's contract is mirrored in Zod in `packages/contracts/src/privacy-service.ts`, with a drift test against `openapi.json` (R-03). Simulator request/response, the policy's `privacy` section, the new headers and the error type are Zod in contracts and appear in `/openapi.json`. | PASS |
| III | Spec before code | The 34 scenarios map to named tests (coverage table in `tasks.md`). | PASS |
| IV | Evals are executable spec | The PII-leak metric and thresholds are defined (SC-004) and gated in 007 through `/v1/simulate`. The routing dataset of 002 must stay ≥ 95 % with the new policy (checked in `T-005-02`). | PASS |
| V | Privacy by default | Fail closed; the mapping lives in request scope (a closure, never a field of a logged object); the cache holds positions only; events have no content fields; a capture test greps everything for test values. | PASS |
| VI | Fail fast, never silently | A missing `privacy` section or unsafe `critical` stops boot; detector failure is an event and a header (`unknown`); a missing privacy URL stops boot. | PASS |
| VII | Strict TypeScript | Closed lists as tuples; discriminated unions for `Inspection` (`ok` / `failed`) and decisions (`route` / `block`); branded `MessageIndex`; no `any`. | PASS |
| VIII | Testability | The detector and the cache are ports with fakes; the timeout and concurrency go through `ClockPort`; streaming restoration is a pure state machine. | PASS |
| IX | Composition over inheritance | The cache is a decorator over the detector port (`withDetectionCache(detector, cache)`); restoration is a function; privacy is a step composed into the existing `decide`. | PASS |
| X | Simplicity | Two new ports. `PiiDetectorPort` has an HTTP adapter and a fake, as required for testing. `DetectionCachePort` has an in-memory adapter now; the backlog names a `CachePort`, and a Valkey adapter is deliberately not built (R-08). No new runtime dependency. | PASS |
| — | English-only (ADR-0002) | Artefacts are in English; test texts are Spanish by design. | PASS |
| — | Task protocol | One PR per backlog task `T-005-02` … `T-005-06`. | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/005-privacy-aware-routing/
├── spec.md              # Specification (T-005-01), draft awaiting review
├── plan.md              # This file
├── research.md          # Phase 0: decisions R-01 … R-12
├── data-model.md        # Phase 1: contract, domain, port and adapter shapes
├── quickstart.md        # Phase 1: how to verify the feature end to end
├── contracts/
│   ├── README.md
│   ├── http.md                      # headers, statuses, /v1/simulate
│   ├── policy.example.yaml          # default policy after 005 (→ apps/gateway/policies/default.yaml)
│   ├── simulate.example.json        # request + response pair
│   └── placeholder-vectors.json     # shared test vectors (Python reference ↔ TypeScript port)
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root; new or changed files only)

```text
packages/
├── contracts/src/
│   ├── privacy-service.ts          # new: Zod mirror of services/privacy/openapi.json (T-005-03)
│   ├── routing-policy.ts           # + privacy section, version 3 (T-005-02)
│   ├── simulate.ts                 # new: SimulateRequest/Response (T-005-06)
│   └── error.ts                    # + privacy_unavailable (T-005-04)
└── test-utils/src/fake-pii-detector.ts   # new (T-005-03)

apps/gateway/
├── policies/{default,local-only}.yaml    # + privacy section, version 3 (T-005-02)
├── prompts/anonymization-notice.v1.md    # new: versioned placeholder instruction (T-005-04)
├── src/
│   ├── domain/
│   │   ├── errors.ts               # + PrivacyBlockedError, DetectorFailure causes
│   │   └── model/
│   │       ├── sensitivity.ts      # levels, DetectedEntity, Inspection (T-005-02)
│   │       ├── privacy-policy.ts   # new: actions, validation, applyPrivacy() (T-005-02)
│   │       ├── routing-policy.ts   # + privacy section in RoutingPolicy and validatePolicy
│   │       ├── routing-decision.ts # decide() → RouteDecision | BlockDecision (T-005-02)
│   │       ├── placeholders.ts     # new: anonymize/restore, port of 004 R-07 (T-005-04)
│   │       └── restore-stream.ts   # new: placeholder-safe buffer (T-005-05)
│   ├── application/
│   │   ├── ports/pii-detector.port.ts      # new (T-005-03)
│   │   ├── ports/detection-cache.port.ts   # new (T-005-03)
│   │   └── use-cases/
│   │       ├── inspect-sensitivity.ts      # new: detector + timeout + cache + events (T-005-03/04)
│   │       ├── route-inference.ts          # inspection, actions, anonymize/restore (T-005-04)
│   │       ├── stream-inference.ts         # + streaming restore (T-005-05)
│   │       └── simulate-policy.ts          # new (T-005-06)
│   ├── infrastructure/
│   │   ├── privacy/http-pii-detector.ts    # new (T-005-03)
│   │   ├── cache/in-memory-detection-cache.ts  # new LRU with TTL (T-005-03)
│   │   └── config/env.ts                   # + TAMIZ_PRIVACY_URL, _TIMEOUT_MS, _CACHE_* (T-005-03)
│   ├── presentation/
│   │   ├── routes/chat-completions.ts      # headers, 451/503 mapping (T-005-04)
│   │   ├── routes/simulate.ts              # new (T-005-06)
│   │   └── mappers/error-envelope.ts       # + privacy kinds
│   └── main.ts                             # wire detector, cache, notice file
└── test/
    ├── domain/{sensitivity,privacy-policy,placeholders,restore-stream}.test.ts
    ├── domain/privacy-decision.property.test.ts
    ├── application/{inspect-sensitivity,route-inference-privacy,stream-inference-privacy,simulate-policy}.test.ts
    ├── privacy/http-pii-detector.test.ts         # MSW
    ├── cache/in-memory-detection-cache.test.ts
    ├── contracts/privacy-service-drift.test.ts   # Zod vs services/privacy/openapi.json
    ├── chat-completions-privacy.test.ts, simulate.test.ts
    └── privacy/no-leak.test.ts                   # SC-006 capture
docker-compose.yml, .env.example                  # TAMIZ_PRIVACY_URL documented
```

**Structure Decision**: the gateway layers of `CLAUDE.md` section 5.
- **Placeholders and the stream buffer are domain.** They are pure string rules with no
  dependency.
- **Inspection is an application use case.** It composes the port, the timeout and the
  events.
- **The cache is a port with an in-memory adapter.** The application decides what is
  cached (positions only); infrastructure decides how it is stored.

## Requirement → task mapping

| Backlog task | Requirements | Spec stories |
|---|---|---|
| `T-005-02` Domain: levels, actions, policy `privacy` section, decision, validation, policy files | FR-001 … FR-005, FR-020 | US6, US1 (decision part) |
| `T-005-03` Detector port, HTTP adapter, Zod mirror + drift test, fake, cache, env | FR-006 … FR-010 | US3 (adapter part), US7 |
| `T-005-04` Inspection + actions + anonymize/restore in `RouteInference`, headers, errors, events | FR-011 … FR-015 | US1, US2, US3 |
| `T-005-05` Streaming restoration | FR-016, FR-017 | US4 |
| `T-005-06` `SimulatePolicy` + `POST /v1/simulate` | FR-018, FR-019 | US5 |

Order: `T-005-02` → `T-005-03` → `T-005-04` → {`T-005-05`, `T-005-06`}. The last two
need only `T-005-04` and touch different files, except `main.ts` and the contracts index.

## Complexity Tracking

No constitution violations to justify. For review:

- **R-01: anonymization in the gateway from `/analyze`, not via `/anonymize`.** This
  keeps values out of the cache, and lets the gateway number placeholders across messages
  it joined itself. The cost is a second implementation of a 40-line rule, held equal by
  shared vectors.
- **R-05: `451` for `block`** (the backlog said `422`).
- **R-04: the decision's return type becomes a union** (`route` | `block`). Callers of
  `decide` (`route-inference`, `stream-inference`, the routing dataset test) change in
  `T-005-02`.
- **Policy format version 3 with a required `privacy` section.** This is a breaking
  change for policy files; both shipped files are updated in the same PR.
