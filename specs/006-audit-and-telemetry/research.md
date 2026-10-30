# Research: Audit and Telemetry

**Feature**: `006-audit-and-telemetry` · **Date**: 2026-10-30 · **Spec**: [spec.md](spec.md)

Decisions taken while planning. Each names what was chosen, why, and what was rejected.
Library versions and the exact GenAI attribute names are confirmed with Context7 when
each task installs them; the semantic conventions for GenAI are still "development" status
and renamed `gen_ai.system` to `gen_ai.provider.name` in recent releases (R-10).

## R-01 One entry per request, built at the end by a wrapper

**Decision**:
- **Wrapper.** `withAudit(useCase, deps)` wraps `routeInference` and `streamInference`.
  It records the start time; after the result (or, for streams, after the last part,
  error or cancellation) it builds the entry with the pure domain function
  `auditEntry(input)` and calls `audit.append(entry)` without awaiting.
- **Inputs.** The use cases expose what the entry needs:
  - the decision and the inspection counts, never the entities' offsets;
  - the abandoned targets, usage, cost and notice version.
- **Requests that never reach the decision** (validation errors, auth failures) are not
  wrapped.

**Rationale**: FR-001 (exactly one, every outcome) is easiest to guarantee in one place
that sees the whole result; composition over editing every return path (IX).

**Alternatives**: building entries inside each use case (several return paths, easy to
miss one); deriving them from routing events (events are a stream, and assembling them
needs state per request).

## R-02 Writes are asynchronous; losses are visible

**Decision**:
- **Port.** `AuditLogPort.append(entry): void` is fire-and-forget.
- **PostgreSQL adapter.** An async writer:
  - a bounded queue (default 10 000 entries);
  - batches of up to 100 every 250 ms (time from the clock port);
  - each batch is a single multi-row `INSERT`.
- **Losses.** On a database error the batch is retried once, then dropped. On overflow
  the oldest pending entry is dropped. Every loss emits `audit.dropped` (count, reason)
  and a `warn` log line, and is counted in an OTel counter when tracing is on.
- **Shutdown.** The writer is flushed on `SIGTERM`.

**Rationale**: SC-003 (< 2 ms overhead) and FR-004 (never fail the request). Constitution
VI is honoured by making every loss observable.

**Alternatives**: synchronous insert per request (adds a database round trip to every
request and fails requests when the database is down); an outbox table (needs a database
anyway); a message broker (out of scope, X).

## R-03 The messages' hash is HMAC-SHA-256 with a secret

**Decision**:
- **Hash.** `requestHash = HMAC-SHA-256(TAMIZ_AUDIT_HASH_KEY, JSON.stringify(messages))`,
  hex.
- **Key.** It is required when `DATABASE_URL` is set. In memory-only mode a random key is
  generated per process and logged as "ephemeral".
- **Plumbing.** The function is injected, as the detection cache's hash is in feature 005.

**Rationale**: FR-003. A plain SHA-256 of "¿Cuál es mi saldo?" is trivially recoverable by
guessing; a keyed hash still lets an operator correlate identical requests.

**Alternatives**: no hash (loses correlation); plain SHA-256 (guessable); per-request salt
(no correlation).

## R-04 Drizzle with postgres.js; migrations generated and committed, applied at start

**Decision**:
- **Library and driver.** `drizzle-orm` with the `postgres` driver; schema in
  `infrastructure/persistence/schema.ts`.
- **Migrations.** `drizzle-kit generate` writes SQL migrations to `apps/gateway/drizzle/`
  (committed), and `migrate()` runs them at boot before the server listens.
- **Scripts.** `pnpm --filter @tamiz/gateway db:generate` / `db:migrate` are available
  for operators.

Tables:
- `audit_entries`. Scalar columns for every filterable field: `created_at`, `target_id`,
  `rule_id`, `sensitivity`, `privacy_action`, `outcome`. Entity counts are stored as
  `jsonb` with a GIN index for the kind filter; abandoned targets are also `jsonb`.
  Indexes: `(created_at desc, id desc)` for the cursor, plus `target_id`, `rule_id` and
  `outcome`.
- `api_keys`: `client_id`, `key_hash` (unique), `role`, `created_at`, `revoked_at`.

**Rationale**: `CLAUDE.md` section 4 fixes Drizzle and PostgreSQL 17. postgres.js is fast,
has no native dependencies, and is a first-class Drizzle driver. Migrations at boot keep the
demo one command.

**Alternatives**: `pg` (node-postgres; fine, but slower and older API); `drizzle-kit push`
at runtime (not versioned); separate migration job (more operational steps for a demo).

## R-05 Keyset pagination with an opaque cursor

**Decision**:
- **Ordering.** `created_at desc, id desc`.
- **Cursor.** It is base64url of `{t: createdAt ISO, id}`. The next page uses
  `(created_at, id) < (t, id)`.
- **Page size.** Default 50, max 200.
- **In-memory log.** It implements the same ordering and cursor.

**Rationale**: FR-007 (no repeats or skips under concurrent inserts); offset pagination
shifts as rows arrive.

**Alternatives**: offset/limit (unstable); a server-side cursor (stateful).

## R-06 API keys: environment and database, with roles

**Decision**:
- **Lookup.** `ApiKeyRepositoryPort.findByHash(hash) → { clientId, role, revokedAt? }`.
- **Sources.**
  - Environment keys keep working: `TAMIZ_API_KEYS` has role `client`, and the new
    `TAMIZ_ADMIN_API_KEYS` has role `admin`.
  - With a database, keys are also looked up in `api_keys`, and a revoked key is refused.
- **Matching.** It stays constant-time.
- **Management.** `pnpm --filter @tamiz/gateway api-key:add <client> [--admin]` inserts a
  hashed key; this extends `generate-api-key`.

**Rationale**: `CLAUDE.md` section 8 ("API keys per client, hashed in DB"); backward
compatible.

**Alternatives**: database only (breaks the existing setup and tests); a full user and role
system (out of scope).

## R-07 Admin-only routes by role

**Decision**:
- **Authentication.** `apiKeyAuth` (existing) sets `clientId` and now `role`.
- **Authorization.** `adminOnly()` on `/v1/admin/*` answers `403 forbidden` for `client`
  keys.
- **Contract.** A new error type `forbidden` is added to the contract.

**Rationale**: FR-008.

## R-08 Baseline = the policy's most expensive target, stored per entry

**Decision**:
- **Choosing the baseline.** It is the target with the highest input + output price in
  the active policy; ties are broken by declaration order.
- **Per entry.** Each entry stores `baselineCostUsd` computed at write time, with the
  entry's tokens at the baseline's prices, plus `baselineTargetId`.
- **The report.** It sums stored values, so price changes never rewrite history.

**Rationale**: FR-012, US3; stable historical reports.

**Alternatives**: computing at query time with current prices (history changes when a price
changes); a fixed "GPT-4" price table (not policy data).

## R-09 Spans created through a `TracerPort` in the application

**Decision**:
- **Port.** `TracerPort.request(name, attrs, fn)` and `TracerPort.attempt(target, fn)`
  return the function's result; `span.event(name, attrs)` and `span.set(attrs)`.
- **Use.** `withTracing` wraps the use cases, and `executeChain` calls `tracer.attempt`
  around each provider attempt.
- **Adapters.** The OTel adapter maps these to `@opentelemetry/api` spans. The default is
  a no-op tracer, and tests use an in-memory one.
- **Events.** The routing-events OTel sink adds events to the active request span through
  the same port.

**Rationale**: FR-009/FR-010. Auto-instrumentation of `fetch`/AI SDK would create spans that
may record URLs and bodies by default. Explicit spans give exact control over every
attribute, and the domain stays free of OTel (I).

**Alternatives**: AI SDK's `experimental_telemetry` (records prompts unless configured,
and couples traces to one library); `@opentelemetry/auto-instrumentations-node` (noise,
content risk).

## R-10 GenAI attribute names

**Decision**: Attempt spans are named `chat {model}`, with kind `CLIENT`. Attributes:

| Attribute | Value |
|---|---|
| `gen_ai.operation.name` | `chat` |
| `gen_ai.provider.name` | provider (`gen_ai.system` is also set while backends migrate) |
| `gen_ai.request.model` | requested model |
| `gen_ai.response.model` | served model |
| `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` | usage |
| `gen_ai.response.finish_reasons` | finish reasons |
| `error.type` | on failure |

Request spans are named `tamiz.request`. Attributes:
- `tamiz.route`, `tamiz.rule`, `tamiz.sensitivity`, `tamiz.privacy.action`;
- `tamiz.entities.<KIND>` counts;
- `tamiz.fallbacks`;
- `tamiz.cost_usd`.

Events:
- `routing.decision`;
- `routing.fallback` (`target`, `reason`);
- `privacy.inspected`, `privacy.detector_failed`, `privacy.anonymized` (counts only);
- `circuit.changed`.

Never set: `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.prompt`,
`gen_ai.completion`, `gen_ai.system_instructions`.

**Rationale**: the conventions are what Jaeger, Grafana and vendors understand. The
convention is still in development, so names are checked against the current spec at
implementation (`T-006-05`), and the test pins what we emit.

## R-11 Export configuration by standard OTel variables

**Decision**:
- **Variables.** `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`)
  enables an OTLP/HTTP exporter with a batch span processor. `OTEL_SERVICE_NAME` defaults
  to `tamiz-gateway`, and `OTEL_TRACES_SAMPLER` is honoured.
- **Default.** Without an endpoint, the no-op tracer is used.
- **Local stack.** Jaeger `jaegertracing/jaeger:2` in compose, UI on port 16686, OTLP on
  4318.

**Rationale**: FR-011. Standard variables mean no Tamiz-specific knobs to learn.

## R-12 Provider health from circuit state plus a recent window of the audit log

**Decision**:
- **Source.** `GET /v1/admin/providers` reads the circuit state port (feature 003) for
  each declared target, and queries the audit log for entries in the last window
  (`windowMinutes`, default 15, max 1 440).
- **Figures.** Per answering or abandoned target: request count, error rate and latency
  p50/p95. With PostgreSQL these use `percentile_cont`; the in-memory log computes them in
  process.
- **Coverage.** Targets with no traffic are listed with zeros.

**Rationale**: FR-013 without a separate metrics store (X).

**Alternatives**: an OTel metrics backend (not queryable by the dashboard without
Prometheus); a sliding window in memory (lost on restart, wrong with several instances).
