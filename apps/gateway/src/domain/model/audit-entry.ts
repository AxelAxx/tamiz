/**
 * The audit entry of one request (spec 006 FR-001 … FR-003, data-model section 1.1).
 *
 * Built once, at the end of the request, from the decision and the outcome. It has no field
 * for content: the request is identified by a keyed hash of its messages (computed outside
 * the domain), detection by kinds and counts only. Mirrored by `AuditEntrySchema` in
 * `@tamiz/contracts`.
 */
import { baselineCost } from "./baseline.js";
import type { Usage } from "./cost.js";
import type { Abandoned } from "./fallback.js";
import type { ModelTarget, ProviderName, Residency } from "./model-target.js";
import type { BlockReason, PrivacyAction } from "./privacy-policy.js";
import type { Decision } from "./routing-decision.js";
import type { EntityKind, Sensitivity } from "./sensitivity.js";
import type { TaskSize, TaskType } from "./task-classifier.js";

export const AUDIT_OUTCOMES = ["answered", "failed", "blocked", "cancelled"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** Why a request was refused: a privacy reason (spec 005) or the residency guard (003). */
export type AuditBlockReason = BlockReason | "residency";

/** The error types an audited failure can have (a subset of the API's error types). */
export type AuditErrorType =
  | "provider_error"
  | "provider_timeout"
  | "provider_unavailable"
  | "privacy_unavailable"
  | "policy_blocked";

export interface AuditTarget {
  readonly id: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly residency: Residency;
}

export interface AuditEntry {
  readonly id: string;
  readonly requestId: string;
  readonly clientId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly latencyMs: number;
  readonly requestHash: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly ruleId: string;
  readonly taskType: TaskType;
  readonly size: TaskSize;
  readonly sensitivity: Sensitivity;
  readonly entities: Readonly<Partial<Record<EntityKind, number>>>;
  readonly privacyAction: PrivacyAction;
  readonly noticeVersion?: string;
  readonly blockReason?: AuditBlockReason;
  readonly outcome: AuditOutcome;
  readonly errorType?: AuditErrorType;
  readonly streamed: boolean;
  readonly target?: AuditTarget;
  readonly abandoned: ReadonlyArray<{
    readonly targetId: string;
    readonly reason: Abandoned["reason"];
  }>;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimated: boolean;
  };
  readonly costUsd: number;
  readonly baselineCostUsd?: number;
  readonly baselineTargetId?: string;
}

/** How the request ended, as the use case saw it. */
export type AuditResult =
  | {
      readonly kind: "answered" | "cancelled";
      readonly target: ModelTarget;
      readonly abandoned: ReadonlyArray<Abandoned>;
      readonly usage?: Usage;
      readonly cost?: number;
      readonly noticeVersion?: string;
    }
  | {
      readonly kind: "failed";
      readonly target: ModelTarget;
      readonly abandoned: ReadonlyArray<Abandoned>;
      readonly errorType: AuditErrorType;
      readonly usage?: Usage;
      readonly cost?: number;
      readonly noticeVersion?: string;
    }
  | {
      readonly kind: "blocked";
      readonly reason: AuditBlockReason;
      readonly errorType: AuditErrorType;
      readonly target?: ModelTarget;
      readonly abandoned: ReadonlyArray<Abandoned>;
    };

export interface AuditInput {
  readonly id: string;
  readonly requestId: string;
  readonly clientId: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly requestHash: string;
  readonly decision: Decision;
  readonly streamed: boolean;
  readonly result: AuditResult;
  /** The policy's baseline target, when it has a priced one. */
  readonly baseline?: ModelTarget;
}

function toTarget(target: ModelTarget): AuditTarget {
  return {
    id: target.id,
    provider: target.provider,
    model: target.model,
    residency: target.residency,
  };
}

export function auditEntry(input: AuditInput): AuditEntry {
  const { decision, result } = input;
  const usage = result.kind === "blocked" ? undefined : result.usage;
  const blocked = result.kind === "blocked";
  return {
    id: input.id,
    requestId: input.requestId,
    clientId: input.clientId,
    startedAt: input.startedAt.toISOString(),
    endedAt: input.endedAt.toISOString(),
    latencyMs: Math.max(0, input.endedAt.getTime() - input.startedAt.getTime()),
    requestHash: input.requestHash,
    policyId: decision.policyId,
    policyVersion: decision.policyVersion,
    ruleId: decision.ruleId,
    taskType: decision.taskType,
    size: decision.size,
    sensitivity: decision.sensitivity,
    entities: decision.entityCounts,
    privacyAction: decision.privacyAction,
    ...(!blocked && result.noticeVersion !== undefined
      ? { noticeVersion: result.noticeVersion }
      : {}),
    ...(blocked ? { blockReason: result.reason } : {}),
    outcome: result.kind,
    ...("errorType" in result ? { errorType: result.errorType } : {}),
    streamed: input.streamed,
    ...(result.target === undefined ? {} : { target: toTarget(result.target) }),
    abandoned: result.abandoned.map((a) => ({ targetId: a.targetId, reason: a.reason })),
    ...(usage === undefined
      ? {}
      : {
          usage: {
            inputTokens: usage.promptTokens,
            outputTokens: usage.completionTokens,
            estimated: usage.estimated,
          },
        }),
    costUsd: blocked ? 0 : (result.cost ?? 0),
    ...(usage === undefined || input.baseline === undefined
      ? {}
      : {
          baselineCostUsd: baselineCost(usage, input.baseline),
          baselineTargetId: input.baseline.id,
        }),
  };
}
