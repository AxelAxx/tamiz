# Feature Specification: Audit and Telemetry

**Feature Branch**: `006-audit-and-telemetry`

**Created**: 2026-10-30

**Status**: Approved (reviewed by Alex on 2026-10-30)

**Input**: User description: "006-audit-and-telemetry: every request leaves one audit entry with what was decided and what it cost, never what was said; entries are stored in PostgreSQL and queryable through an admin API with filters and pagination; admin aggregates for cost (against an 'everything to frontier' baseline) and provider health; OpenTelemetry traces with the GenAI semantic conventions and routing/privacy events, visible in Jaeger. Privacy acceptance: no prompt content in logs, traces or the database. Backlog T-006-02 … T-006-06."

**Backlog**: `T-006-01` (this spec), `T-006-02` … `T-006-06` (implementation). See
`docs/tasks/BACKLOG.md`, section "Day 7".

**Builds on**: features 002 (routing, cost), 003 (resilience, routing events, circuit
state), 005 (sensitivity, privacy actions). **Feeds**: `008-dashboard` (live traffic, audit
log, cost analytics), `009-mcp-agent` (`query_audit_log`, `get_cost_report`,
`get_provider_health`), `T-OPS-01` (Postgres and Jaeger in the stack).

## Purpose

The project's fourth promise is "audits every decision without ever storing prompt
content". Today the gateway logs routing events line by line, but nothing records, per
request, what was detected, which rule and action applied, where it went, what it cost and
how long it took, and nothing can be queried afterwards. A regulated team needs exactly
that to answer "where did patient data go last week?" and "why did spend rise yesterday?",
and an operator needs traces to see where time goes. This feature adds a durable,
content-free audit log with a query API and aggregates, and OpenTelemetry traces that follow
the industry's GenAI conventions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every request leaves exactly one audit entry, without content (Priority: P1)

A compliance officer wants proof of what happened to each request. Every chat completion,
streamed or not, answered, failed or blocked, produces exactly one audit entry with the
decision and its outcome: the detected entity kinds and counts, the sensitivity, the rule,
the privacy action, the target that answered and the ones abandoned, tokens, cost and
latency. No entry contains message text, detected values or anonymization mappings.

**Why this priority**: It is the product promise and the data source of every admin screen.

**Independent Test**: Run requests of every kind through the gateway with an in-memory
audit log; count entries per request and search their serialized form for the test texts.

**Acceptance Scenarios**:

1. **Given** a successful non-streaming request, **When** it completes, **Then** exactly one
   entry exists with outcome `answered`, the answering target, its provider, model and
   residency, the rule, the sensitivity, the entity kinds and counts, the privacy action,
   tokens, cost and latency.
2. **Given** a streamed request, **When** the stream ends (finish, mid-stream error or client
   disconnect), **Then** exactly one entry exists, written at the end, with the outcome
   `answered`, `failed` or `cancelled` and the usage known at that point.
3. **Given** a request blocked by the privacy action or the residency guard, **When** it is
   refused, **Then** one entry exists with outcome `blocked`, the reason, and no target.
4. **Given** a request whose whole chain failed, **When** it is answered with an error,
   **Then** one entry exists with outcome `failed`, the error type, and every abandoned target
   with its reason.
5. **Given** any entry, **When** it is serialized, **Then** it contains none of the request's
   message texts, detected values, placeholders' values or the answer text; it carries a
   keyed hash of the messages instead, so identical requests can be correlated without
   being readable.
6. **Given** the audit store is unavailable, **When** requests arrive, **Then** they are still
   served, each lost entry is reported as an observable event and metric, and the gateway
   never blocks a request on the audit write.

---

### User Story 2 - Audit entries survive restarts and can be searched (Priority: P1)

An operator deploys the gateway with PostgreSQL. Entries are stored durably; an admin
lists them newest first, filtered by date range, route, rule, sensitivity, privacy action,
entity kind and outcome, page by page, with a stable cursor.

**Why this priority**: An audit log that disappears on restart, or that cannot be searched,
does not answer a compliance question.

**Independent Test**: Against a real PostgreSQL (Testcontainers), write entries, restart the
repository, query with each filter, and page through results.

**Acceptance Scenarios**:

1. **Given** an empty database, **When** the gateway starts, **Then** the schema is created by
   versioned migrations, and starting again changes nothing.
2. **Given** stored entries, **When** an admin calls `GET /v1/admin/audit` with a date range
   and a route, **Then** only matching entries come back, newest first, with at most the
   requested page size (default 50, maximum 200) and a cursor for the next page.
3. **Given** a cursor from the previous page, **When** the next page is requested while new
   entries keep arriving, **Then** no entry is repeated or skipped.
4. **Given** a filter by entity kind (for example `DNI`), **When** it is applied, **Then** only
   entries where that kind was detected are returned.
5. **Given** a client API key (not admin), **When** it calls any `/v1/admin/*` endpoint,
   **Then** it is refused with `403`.
6. **Given** no database is configured, **When** the gateway starts, **Then** it keeps a
   bounded in-memory audit log (most recent entries, default 10 000) and says so at start;
   the admin API works over it.

---

### User Story 3 - Spend can be compared with "everything to the frontier model" (Priority: P2)

A team lead asks how much the routing saves. An admin endpoint returns, for a date range,
the actual cost and the cost the same traffic would have had on the policy's most expensive
target, grouped by day, route or model.

**Why this priority**: Cost is the second reason teams adopt the gateway; the baseline makes
the saving visible (the README and the dashboard show it).

**Independent Test**: Insert entries with known tokens and costs; check the aggregates and
the baseline arithmetic.

**Acceptance Scenarios**:

1. **Given** entries over three days, **When** `GET /v1/admin/cost?groupBy=day` is called for
   that range, **Then** one row per day returns the request count, input and output tokens,
   actual cost and baseline cost, plus totals.
2. **Given** a request answered by a local target with zero price, **When** it is aggregated,
   **Then** its actual cost is zero and its baseline cost is its tokens priced at the
   baseline target's prices.
3. **Given** `groupBy=route` or `groupBy=model`, **When** called, **Then** rows are grouped by
   the answering target or its model; blocked and failed requests count in a separate line
   with zero cost.
4. **Given** the baseline target, **When** the response is returned, **Then** it names which
   target and prices the baseline used.

---

### User Story 4 - An operator sees provider health at a glance (Priority: P2)

Before a demo, an operator checks every target: whether its circuit is open, its recent
error rate and latency.

**Why this priority**: The resilience of feature 003 is invisible without it; the MCP tool
`get_provider_health` and the dashboard rely on it.

**Independent Test**: Open a target's circuit and record failures; call the endpoint.

**Acceptance Scenarios**:

1. **Given** a target whose circuit is open, **When** `GET /v1/admin/providers` is called,
   **Then** that target shows `open` and the remaining cool-down.
2. **Given** recent requests, **When** it is called, **Then** each target shows its request
   count, error rate and latency p50 and p95 over the last 15 minutes (configurable window).
3. **Given** a target that served nothing in the window, **When** it is called, **Then** it is
   listed with zero counts and no latency, never omitted.

---

### User Story 5 - Traces show where time goes, following the GenAI conventions (Priority: P2)

An operator opens Jaeger and sees, per request, a span for the whole request and one per
provider attempt, with the provider, model, tokens and duration in the OpenTelemetry GenAI
attribute names, plus Tamiz's decision (rule, route, sensitivity, action) and events for
the decision, each fallback and each privacy step. No span or event carries message content.

**Why this priority**: Observability is part of "production-ready"; using the standard names
lets any OTel backend read it.

**Independent Test**: Run requests with an in-memory span exporter; inspect spans,
attributes and events; search them for the test texts.

**Acceptance Scenarios**:

1. **Given** a request answered after one fallback, **When** its trace is exported, **Then** it
   has one request span with two child attempt spans, the first with an error status, and a
   `routing.fallback` event naming the abandoned target and the reason.
2. **Given** an attempt span, **When** it is inspected, **Then** it carries
   `gen_ai.operation.name`, `gen_ai.system`, `gen_ai.request.model`,
   `gen_ai.response.model`, `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`.
3. **Given** the request span, **When** it is inspected, **Then** it carries
   `tamiz.route`, `tamiz.rule`, `tamiz.sensitivity`, `tamiz.privacy.action`, the entity
   counts and a `routing.decision` event.
4. **Given** every span and event of the test suite, **When** searched, **Then** no message
   text, detected value or answer text is present; the GenAI content attributes
   (`gen_ai.prompt`, `gen_ai.completion` and their successors) are never set.
5. **Given** no OTLP endpoint is configured, **When** the gateway runs, **Then** tracing is off
   with no cost beyond a no-op; with `OTEL_EXPORTER_OTLP_ENDPOINT` set, spans reach the
   collector (Jaeger in the local stack).

### Edge Cases

- **Client disconnects mid-stream**: one entry with outcome `cancelled` and the usage seen so far.
- **Request rejected before routing** (invalid body, bad API key): no audit entry; those are
  access-log lines (feature 001), not routing decisions.
- **Simulations** (`/v1/simulate`): not audited; they are not requests.
- **Clock skew between instances**: entries use the writing instance's clock; ordering ties
  are broken by entry id.
- **Very long fallback chains**: every abandoned target is recorded; the list is bounded by
  the policy's chain length.
- **Unknown model in the baseline**: when the policy has no priced target, the baseline is
  omitted, not guessed.
- **Audit write slower than the request**: writes are queued and flushed asynchronously with
  a bounded queue; overflow drops the oldest pending entry and reports it.
- **Database migration on a running cluster**: migrations are additive in this feature.

## Requirements *(mandatory)*

### Functional Requirements

Audit entry and port (backlog `T-006-02`):

- **FR-001**: Every chat completion that reaches the routing decision MUST produce exactly one
  audit entry, for every outcome (`answered`, `failed`, `blocked`, `cancelled`), streamed or
  not.
- **FR-002**: An entry MUST hold: id, request id, client id, timestamps (start, end), keyed
  hash of the messages, policy id and version, rule, task type and size, sensitivity, entity
  kinds and counts, privacy action (and notice version), block reason, answering target
  (id, provider, model, residency), abandoned targets with reasons, outcome and error type,
  streamed flag, input and output tokens (and whether estimated), cost, baseline cost and
  latency.
- **FR-003**: An entry MUST NOT contain message text, detected values, mappings or answer
  text; the messages' hash MUST be keyed (HMAC with a secret from the environment) so short
  texts cannot be recovered by guessing.
- **FR-004**: Writing an entry MUST NOT delay or fail the request; failures and drops MUST be
  observable (event and log line), never silent.

Persistence (backlog `T-006-03`):

- **FR-005**: With a database configured, entries MUST be stored in PostgreSQL through
  versioned migrations applied at start; without one, a bounded in-memory log MUST be used and
  announced at start.
- **FR-006**: API keys MUST be storable hashed in the database with a role (`client`,
  `admin`) and a revocation time; keys from the environment keep working; a revoked key is
  refused.

Query API (backlog `T-006-04`):

- **FR-007**: `GET /v1/admin/audit` MUST return entries newest first, filtered by date range,
  route, rule, sensitivity, privacy action, entity kind and outcome, with opaque cursor
  pagination (default 50, maximum 200) that neither repeats nor skips entries under
  concurrent writes.
- **FR-008**: `/v1/admin/*` MUST require an admin key; client keys get `403`, missing or
  invalid keys `401`.

Telemetry (backlog `T-006-05`):

- **FR-009**: The gateway MUST emit a request span and one child span per provider attempt,
  using the OpenTelemetry GenAI semantic conventions for model, provider and usage, and
  `tamiz.*` attributes for the decision; routing, fallback and privacy steps MUST be span
  events.
- **FR-010**: No span, attribute or event MUST carry message content, detected values or
  answer text; GenAI content attributes MUST never be set.
- **FR-011**: Export MUST be configured by the standard OTel environment variables; without
  an endpoint, tracing MUST be a no-op. The local stack MUST include Jaeger.

Aggregates (backlog `T-006-06`):

- **FR-012**: `GET /v1/admin/cost` MUST return actual and baseline cost, request counts and
  tokens for a date range, grouped by day, route or model, with totals; the baseline is the
  policy's most expensive target (by input + output price) and is named in the response.
- **FR-013**: `GET /v1/admin/providers` MUST return, for every declared target, circuit
  state (and remaining cool-down), and over a recent window (default 15 minutes) request
  count, error rate and latency p50/p95.

Cross-cutting:

- **FR-014**: Every admin request and response MUST be a Zod schema in `packages/contracts`
  and appear in `/openapi.json`.
- **FR-015**: The no-content guarantee MUST be enforced by a test that runs the gateway's
  request scenarios and searches logs, routing events, audit entries (in memory and as
  database rows) and exported spans for the test texts.

### Key Entities

- **AuditEntry**: the record of one request's decision and outcome (FR-002); no content.
- **AuditQuery**: filters, page size and cursor.
- **CostReport**: rows (group key, requests, tokens, actual cost, baseline cost) and totals,
  plus the baseline target.
- **ProviderHealth**: per target: circuit state, cool-down, window counts, error rate,
  latency percentiles.
- **ApiKey**: client id, key hash, role, created and revoked times.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the gateway test suite, 100 % of requests that reach the decision produce
  exactly one audit entry, across all outcomes and both endpoints' modes.
- **SC-002**: 0 occurrences of test message texts, detected values or answer texts in
  captured logs, routing events, audit entries, database rows and exported spans (FR-015).
- **SC-003**: The audit write adds less than 2 ms at the 95th percentile to request latency,
  measured in-process with the in-memory log and with the asynchronous database writer.
- **SC-004**: `GET /v1/admin/audit` answers a filtered page in under 200 ms at the 95th
  percentile over 100 000 stored entries, in the Testcontainers integration test.
- **SC-005**: Cost aggregates equal the sum of the stored entries' costs to the cent, and
  baseline costs equal tokens × baseline prices, in integration tests.
- **SC-006**: 100 % of the acceptance scenarios have a matching automated test.

## Assumptions

- **Admin keys** are a role on API keys (environment variable `TAMIZ_ADMIN_API_KEYS` with the
  same `client:sha256` format, and the database table). There is no user login in this
  feature; the dashboard (008) holds an admin key server-side.
- **The messages' hash** is HMAC-SHA-256 with `TAMIZ_AUDIT_HASH_KEY` (required when a
  database is configured). Rotating the key breaks correlation with older entries, which is
  acceptable.
- **Asynchronous writes**: availability wins over completeness when the database is down
  (FR-004); losses are counted and visible. A compliance deployment that needs "no answer
  without audit" is a later option (a policy flag), not this feature.
- **Retention** is the operator's (a SQL job or partition drop); the feature documents it but
  does not schedule deletion.
- **OTel metrics** (counters, histograms) are limited to what the spec names (audit drops,
  request duration); a full metrics dashboard is out of scope.
- **Baseline** uses the active policy's prices at query time for entries whose baseline was
  not stored; entries store their own baseline cost at write time so later price changes do
  not rewrite history.
- **Simulations are not audited**; their privacy events remain in the logs.
