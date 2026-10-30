# Data Model: Audit and Telemetry

**Feature**: `006-audit-and-telemetry` · **Date**: 2026-10-30 · **Plan**: [plan.md](plan.md)

## 1. Contracts (`packages/contracts/src`)

### 1.1 `audit.ts`

```ts
AuditOutcomeSchema   = z.enum(["answered", "failed", "blocked", "cancelled"])
AuditTargetSchema    = z.strictObject({ id, provider, model, residency })
AuditAbandonedSchema = z.strictObject({ targetId, reason: FallbackReason })
AuditEntrySchema = z.strictObject({
  id: z.uuid(),
  requestId, clientId,
  startedAt: z.iso.datetime(), endedAt: z.iso.datetime(), latencyMs: z.int().min(0),
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),          // HMAC-SHA-256, never content
  policyId, policyVersion: z.int(), ruleId: z.string(),
  taskType, size,
  sensitivity: z.enum(["unknown","none","low","high","critical"]),
  entities: z.partialRecord(PrivacyEntityKindSchema, z.int().min(1)),   // counts only
  privacyAction: PrivacyActionSchema, noticeVersion: z.string().optional(),
  blockReason: z.enum(["action","no_target","detector_unavailable","residency"]).optional(),
  outcome: AuditOutcomeSchema, errorType: ErrorTypeSchema.optional(),
  streamed: z.boolean(),
  target: AuditTargetSchema.optional(),                       // the one that answered (or failed last)
  abandoned: z.array(AuditAbandonedSchema),
  usage: z.strictObject({ inputTokens, outputTokens, estimated: z.boolean() }).optional(),
  costUsd: UsdSchema, baselineCostUsd: UsdSchema.optional(), baselineTargetId: z.string().optional(),
})
```

### 1.2 `admin.ts`

```ts
AuditQuerySchema = z.strictObject({                     // query string, coerced
  from?: datetime, to?: datetime, route?: targetId, rule?: string,
  sensitivity?: enum, action?: enum, entity?: PrivacyEntityKind, outcome?: enum,
  cursor?: string, limit?: int 1..200 (default 50) })
AuditPageSchema = z.strictObject({ entries: AuditEntry[], nextCursor: z.string().nullable() })

CostQuerySchema  = z.strictObject({ from: datetime, to: datetime, groupBy: enum(["day","route","model"]).default("day") })
CostRowSchema    = z.strictObject({ key: z.string(), requests, inputTokens, outputTokens, costUsd, baselineCostUsd })
CostReportSchema = z.strictObject({
  from, to, groupBy,
  baseline: z.strictObject({ targetId, inputUsdPerMillion, outputUsdPerMillion }).nullable(),
  rows: CostRow[], notServed: z.strictObject({ requests, blocked, failed }), totals: CostRow })

ProvidersQuerySchema  = z.strictObject({ windowMinutes: int 1..1440 (default 15) })
ProviderHealthSchema  = z.strictObject({
  targetId, provider, model, residency,
  circuit: z.enum(["closed","open","half_open"]), cooldownRemainingMs: z.int().min(0).optional(),
  window: z.strictObject({ requests, errors, errorRate: z.number().min(0).max(1),
                           latencyP50Ms: z.number().nullable(), latencyP95Ms: z.number().nullable() }) })
ProvidersReportSchema = z.strictObject({ windowMinutes, generatedAt, targets: ProviderHealth[] })
```

`ErrorTypeSchema` gains `forbidden` (403).

## 2. Domain

- `model/audit-entry.ts`:
  - `auditEntry(input: AuditInput): AuditEntry` is pure. Its input includes the clock
    times, the decision (route or block), the inspection counts, the served or failed
    result, the cost, the baseline and `requestHash`.
  - `entityCounts(inspection)` returns counts per kind from an inspection.
- `model/baseline.ts`: `baselineTarget(policy): ModelTarget | undefined` and
  `baselineCost(usage, target): Usd`.

## 3. Application

```ts
interface AuditLogPort {
  append(entry: AuditEntry): void                                   // never throws, never awaits
  query(query: AuditQuery): Promise<AuditPage>
  costReport(query: CostQuery, baseline): Promise<CostReport>
  window(sinceIso: string): Promise<ReadonlyArray<TargetWindowStats>>
}
interface ApiKeyRepositoryPort { findByHash(hash: string): Promise<{ clientId; role: "client"|"admin"; revokedAt?: Date } | undefined> }
interface TracerPort {
  request<T>(attrs, fn: (span: SpanHandle) => Promise<T>): Promise<T>
  attempt<T>(target, attrs, fn: (span: SpanHandle) => Promise<T>): Promise<T>
}
interface SpanHandle { set(attrs: Record<string, string | number | boolean>): void; event(name, attrs?): void; fail(errorType: string): void }
```

- `audit/with-audit.ts`: `withAudit(routeInference, deps)` and
  `withAuditStream(streamInference, deps)`.
- `use-cases/query-audit-log.ts`, `cost-report.ts`, `provider-health.ts`.
- `RoutingEvent` gains `audit.dropped { count, reason: "queue_full" | "store_error" }`.

## 4. Infrastructure

| Module | Shape |
|---|---|
| `cache/in-memory-audit-log.ts` | ring buffer (`maxEntries`, default 10 000); query, cost and window in process |
| `persistence/schema.ts` | Drizzle tables `audit_entries`, `api_keys` (research R-04) |
| `persistence/db.ts`, `migrate.ts` | postgres.js client from `DATABASE_URL`; `migrate()` at boot |
| `persistence/audit-log-repository.ts` | insert batch, keyset query with filters, aggregates (`date_trunc`, `percentile_cont`) |
| `persistence/async-writer.ts` | bounded queue, batches, one retry, drop events (research R-02) |
| `persistence/api-key-repository.ts` | lookup by hash; insert for the CLI |
| `telemetry/otel-setup.ts` | provider + OTLP exporter from env; no-op without endpoint |
| `telemetry/otel-tracer.ts` | `TracerPort` over `@opentelemetry/api` |
| `telemetry/otel-routing-events.ts`, `fan-out.ts` | events → span events; several sinks |
| `config/env.ts` | `DATABASE_URL?`, `TAMIZ_AUDIT_HASH_KEY` (≥ 32 chars, required with `DATABASE_URL`), `TAMIZ_ADMIN_API_KEYS?`, `TAMIZ_AUDIT_MEMORY_ENTRIES` (10 000), `OTEL_*` (read by the SDK) |

## 5. Presentation

- `middlewares/admin-only.ts`: `403 forbidden` for client keys.
- `routes/admin/audit.ts`: `GET /v1/admin/audit`.
- `routes/admin/cost.ts`: `GET /v1/admin/cost`.
- `routes/admin/providers.ts`: `GET /v1/admin/providers`.

## 6. Tables (PostgreSQL)

```sql
audit_entries(
  id uuid primary key, request_id text not null, client_id text not null,
  created_at timestamptz not null, ended_at timestamptz not null, latency_ms integer not null,
  request_hash char(64) not null, policy_id text not null, policy_version integer not null,
  rule_id text not null, task_type text not null, size text not null,
  sensitivity text not null, entities jsonb not null, privacy_action text not null,
  notice_version text, block_reason text, outcome text not null, error_type text,
  streamed boolean not null, target_id text, target_provider text, target_model text,
  target_residency text, abandoned jsonb not null, input_tokens integer, output_tokens integer,
  usage_estimated boolean, cost_usd numeric(14,8) not null, baseline_cost_usd numeric(14,8),
  baseline_target_id text)
index (created_at desc, id desc); index (target_id); index (rule_id); index (outcome);
gin index (entities)

api_keys(id uuid pk, client_id text not null, key_hash char(64) unique not null,
         role text not null check (role in ('client','admin')),
         created_at timestamptz not null default now(), revoked_at timestamptz)
```

`created_at` is the request start time (`startedAt`).
