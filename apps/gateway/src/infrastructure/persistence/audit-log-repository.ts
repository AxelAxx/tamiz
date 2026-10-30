/**
 * Audit entries in PostgreSQL (spec 006 FR-005, data-model section 6).
 *
 * `toRow` and `fromRow` map the domain entry to the table and back; there is no column
 * for content, so nothing else can be stored. `insertBatch` writes many entries in one
 * statement (the async writer batches them, research R-02).
 */
import { and, desc, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import type { CostAggregate } from "../../application/audit/aggregates.js";
import type {
  AuditFilters,
  AuditPosition,
  AuditReaderPort,
} from "../../application/ports/audit-reader.port.js";
import type {
  AuditBlockReason,
  AuditEntry,
  AuditErrorType,
  AuditOutcome,
} from "../../domain/model/audit-entry.js";
import type { FallbackReason } from "../../domain/model/fallback.js";
import type { ProviderName, Residency } from "../../domain/model/model-target.js";
import type { PrivacyAction } from "../../domain/model/privacy-policy.js";
import type { EntityKind, Sensitivity } from "../../domain/model/sensitivity.js";
import type { TaskSize, TaskType } from "../../domain/model/task-classifier.js";
import type { Database } from "./db.js";
import { auditEntries } from "./schema.js";

export type AuditRow = typeof auditEntries.$inferSelect;
type AuditInsert = typeof auditEntries.$inferInsert;

export interface AuditStore {
  insertBatch(entries: ReadonlyArray<AuditEntry>): Promise<void>;
}

export function toRow(entry: AuditEntry): AuditInsert {
  return {
    id: entry.id,
    requestId: entry.requestId,
    clientId: entry.clientId,
    createdAt: entry.startedAt,
    endedAt: entry.endedAt,
    latencyMs: entry.latencyMs,
    requestHash: entry.requestHash,
    policyId: entry.policyId,
    policyVersion: entry.policyVersion,
    ruleId: entry.ruleId,
    taskType: entry.taskType,
    size: entry.size,
    sensitivity: entry.sensitivity,
    entities: { ...entry.entities } as Record<string, number>,
    privacyAction: entry.privacyAction,
    noticeVersion: entry.noticeVersion ?? null,
    blockReason: entry.blockReason ?? null,
    outcome: entry.outcome,
    errorType: entry.errorType ?? null,
    streamed: entry.streamed,
    targetId: entry.target?.id ?? null,
    targetProvider: entry.target?.provider ?? null,
    targetModel: entry.target?.model ?? null,
    targetResidency: entry.target?.residency ?? null,
    abandoned: entry.abandoned.map((a) => ({ targetId: a.targetId, reason: a.reason })),
    inputTokens: entry.usage?.inputTokens ?? null,
    outputTokens: entry.usage?.outputTokens ?? null,
    usageEstimated: entry.usage?.estimated ?? null,
    costUsd: entry.costUsd.toFixed(8),
    baselineCostUsd: entry.baselineCostUsd === undefined ? null : entry.baselineCostUsd.toFixed(8),
    baselineTargetId: entry.baselineTargetId ?? null,
  };
}

export function fromRow(row: AuditRow): AuditEntry {
  const iso = (value: string) => new Date(value).toISOString();
  return {
    id: row.id,
    requestId: row.requestId,
    clientId: row.clientId,
    startedAt: iso(row.createdAt),
    endedAt: iso(row.endedAt),
    latencyMs: row.latencyMs,
    requestHash: row.requestHash,
    policyId: row.policyId,
    policyVersion: row.policyVersion,
    ruleId: row.ruleId,
    taskType: row.taskType as TaskType,
    size: row.size as TaskSize,
    sensitivity: row.sensitivity as Sensitivity,
    entities: row.entities as Partial<Record<EntityKind, number>>,
    privacyAction: row.privacyAction as PrivacyAction,
    ...(row.noticeVersion === null ? {} : { noticeVersion: row.noticeVersion }),
    ...(row.blockReason === null ? {} : { blockReason: row.blockReason as AuditBlockReason }),
    outcome: row.outcome as AuditOutcome,
    ...(row.errorType === null ? {} : { errorType: row.errorType as AuditErrorType }),
    streamed: row.streamed,
    ...(row.targetId === null
      ? {}
      : {
          target: {
            id: row.targetId,
            provider: row.targetProvider as ProviderName,
            model: row.targetModel ?? "",
            residency: row.targetResidency as Residency,
          },
        }),
    abandoned: row.abandoned.map((a) => ({
      targetId: a.targetId,
      reason: a.reason as FallbackReason,
    })),
    ...(row.inputTokens === null
      ? {}
      : {
          usage: {
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens ?? 0,
            estimated: row.usageEstimated ?? false,
          },
        }),
    costUsd: Number(row.costUsd),
    ...(row.baselineCostUsd === null ? {} : { baselineCostUsd: Number(row.baselineCostUsd) }),
    ...(row.baselineTargetId === null ? {} : { baselineTargetId: row.baselineTargetId }),
  };
}

export function createPostgresAuditStore(db: Database): AuditStore {
  return {
    async insertBatch(entries) {
      if (entries.length === 0) return;
      await db.insert(auditEntries).values(entries.map(toRow)).onConflictDoNothing();
    },
  };
}

function conditions(filters: AuditFilters, after: AuditPosition | undefined): SQL | undefined {
  const parts: SQL[] = [];
  if (filters.from !== undefined) parts.push(gte(auditEntries.createdAt, filters.from));
  if (filters.to !== undefined) parts.push(lt(auditEntries.createdAt, filters.to));
  if (filters.route !== undefined) parts.push(eq(auditEntries.targetId, filters.route));
  if (filters.rule !== undefined) parts.push(eq(auditEntries.ruleId, filters.rule));
  if (filters.sensitivity !== undefined)
    parts.push(eq(auditEntries.sensitivity, filters.sensitivity));
  if (filters.action !== undefined) parts.push(eq(auditEntries.privacyAction, filters.action));
  if (filters.outcome !== undefined) parts.push(eq(auditEntries.outcome, filters.outcome));
  // `?` is jsonb key existence, served by the GIN index on `entities`.
  if (filters.entity !== undefined) parts.push(sql`${auditEntries.entities} ? ${filters.entity}`);
  if (after !== undefined) {
    parts.push(
      sql`(${auditEntries.createdAt}, ${auditEntries.id}) < (${after.startedAt}::timestamptz, ${after.id}::uuid)`,
    );
  }
  return parts.length === 0 ? undefined : and(...parts);
}

/** Keyset pages over `audit_entries` (spec 006 FR-007, research R-05). */
export function createPostgresAuditReader(db: Database): AuditReaderPort {
  return {
    async page(filters, after, limit) {
      const rows = await db
        .select()
        .from(auditEntries)
        .where(conditions(filters, after))
        .orderBy(desc(auditEntries.createdAt), desc(auditEntries.id))
        .limit(limit);
      return rows.map(fromRow);
    },

    async cost(range, groupBy) {
      const key =
        groupBy === "day"
          ? sql`to_char(${auditEntries.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`
          : groupBy === "route"
            ? sql`${auditEntries.targetId}`
            : sql`${auditEntries.targetModel}`;
      const inRange = and(
        gte(auditEntries.createdAt, range.from),
        lt(auditEntries.createdAt, range.to),
      );
      const rows = await db.execute<Record<string, string | number | null>>(sql`
        select ${key} as key, count(*) as requests,
               coalesce(sum(${auditEntries.inputTokens}), 0) as input_tokens,
               coalesce(sum(${auditEntries.outputTokens}), 0) as output_tokens,
               coalesce(sum(${auditEntries.costUsd}), 0) as cost_usd,
               coalesce(sum(${auditEntries.baselineCostUsd}), 0) as baseline_cost_usd
        from ${auditEntries}
        where ${inRange} and ${auditEntries.outcome} in ('answered', 'cancelled')
          and ${auditEntries.targetId} is not null
        group by 1 order by 1`);
      const [counts] = await db.execute<Record<string, string | number>>(sql`
        select count(*) filter (where ${auditEntries.outcome} = 'blocked') as blocked,
               count(*) filter (where ${auditEntries.outcome} = 'failed') as failed
        from ${auditEntries} where ${inRange}`);
      return {
        rows: rows.map(
          (row): CostAggregate => ({
            key: String(row["key"]),
            requests: Number(row["requests"]),
            inputTokens: Number(row["input_tokens"]),
            outputTokens: Number(row["output_tokens"]),
            costUsd: Number(row["cost_usd"]),
            baselineCostUsd: Number(row["baseline_cost_usd"]),
          }),
        ),
        blocked: Number(counts?.["blocked"] ?? 0),
        failed: Number(counts?.["failed"] ?? 0),
      };
    },

    async window(since) {
      const rows = await db.execute<Record<string, string | number | null>>(sql`
        with attempts as (
          select ${auditEntries.targetId} as target_id, ${auditEntries.outcome} as outcome,
                 ${auditEntries.latencyMs} as latency_ms
          from ${auditEntries}
          where ${auditEntries.createdAt} >= ${since} and ${auditEntries.targetId} is not null
            and ${auditEntries.outcome} <> 'blocked'
          union all
          select a ->> 'targetId', 'abandoned', null
          from ${auditEntries}, jsonb_array_elements(${auditEntries.abandoned}) as a
          where ${auditEntries.createdAt} >= ${since}
        )
        select target_id, count(*) as requests,
               count(*) filter (where outcome in ('failed', 'abandoned')) as errors,
               percentile_cont(0.5) within group (order by latency_ms)
                 filter (where outcome = 'answered') as p50,
               percentile_cont(0.95) within group (order by latency_ms)
                 filter (where outcome = 'answered') as p95
        from attempts group by target_id`);
      return rows.map((row) => ({
        targetId: String(row["target_id"]),
        requests: Number(row["requests"]),
        errors: Number(row["errors"]),
        latencyP50Ms: row["p50"] === null ? null : Number(row["p50"]),
        latencyP95Ms: row["p95"] === null ? null : Number(row["p95"]),
      }));
    },
  };
}
