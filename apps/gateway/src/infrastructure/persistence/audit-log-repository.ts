/**
 * Audit entries in PostgreSQL (spec 006 FR-005, data-model section 6).
 *
 * `toRow` and `fromRow` map the domain entry to the table and back; there is no column
 * for content, so nothing else can be stored. `insertBatch` writes many entries in one
 * statement (the async writer batches them, research R-02).
 */
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
