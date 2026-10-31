/**
 * The audit entry: what was decided for one request and what it cost, never what was said
 * (spec 006 FR-001 … FR-003, data-model section 1.1).
 *
 * There is no field for message text, detected values, mappings or answer text: the
 * request is identified by a keyed hash of its messages, and detection by kinds and counts.
 */
import { z } from "zod";
import { ToolNameSchema } from "./chat-completion.js";
import { ErrorTypeSchema } from "./error.js";
import { PrivacyEntityKindSchema } from "./privacy-service.js";
import {
  PrivacyActionSchema,
  ProviderNameSchema,
  ResidencySchema,
  TaskSizeSchema,
  TaskTypeSchema,
} from "./routing-policy.js";

export const AuditOutcomeSchema = z.enum(["answered", "failed", "blocked", "cancelled"]);

export const AuditTargetSchema = z.strictObject({
  id: z.string(),
  provider: ProviderNameSchema,
  model: z.string(),
  residency: ResidencySchema,
});

export const AuditAbandonedSchema = z.strictObject({
  targetId: z.string(),
  reason: z.enum([
    "rate_limited",
    "http_error",
    "timeout",
    "network",
    "malformed_response",
    "authentication",
    "circuit_open",
  ]),
});

/** How many called tool names an entry keeps (009 tool-calling research T-R11). */
export const AUDIT_TOOL_CALLS_MAX = 32;

/**
 * Tool use of a request (009 tool-calling FR-018): counts and the names the model called,
 * never arguments, results, descriptions or schemas. Absent without tools and tool messages.
 */
export const AuditToolsSchema = z.strictObject({
  declared: z.int().min(0),
  toolMessages: z.int().min(0),
  called: z.array(ToolNameSchema).max(AUDIT_TOOL_CALLS_MAX),
});

export const AuditEntrySchema = z.strictObject({
  id: z.uuid(),
  requestId: z.string().min(1),
  clientId: z.string().min(1),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  latencyMs: z.int().min(0),
  /** HMAC-SHA-256 of the messages: correlates identical requests, never readable. */
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
  policyId: z.string(),
  policyVersion: z.int().min(1),
  ruleId: z.string(),
  taskType: TaskTypeSchema,
  size: TaskSizeSchema,
  sensitivity: z.enum(["unknown", "none", "low", "high", "critical"]),
  /** Counts per detected kind; never values or positions. */
  entities: z.partialRecord(PrivacyEntityKindSchema, z.int().min(1)),
  privacyAction: PrivacyActionSchema,
  noticeVersion: z.string().optional(),
  blockReason: z.enum(["action", "no_target", "detector_unavailable", "residency"]).optional(),
  outcome: AuditOutcomeSchema,
  errorType: ErrorTypeSchema.optional(),
  streamed: z.boolean(),
  tools: AuditToolsSchema.optional(),
  /** The target that answered, or the last one reached. */
  target: AuditTargetSchema.optional(),
  abandoned: z.array(AuditAbandonedSchema),
  usage: z
    .strictObject({
      inputTokens: z.int().min(0),
      outputTokens: z.int().min(0),
      estimated: z.boolean(),
    })
    .optional(),
  costUsd: z.number().finite().min(0),
  baselineCostUsd: z.number().finite().min(0).optional(),
  baselineTargetId: z.string().optional(),
});

export type AuditEntryDto = z.infer<typeof AuditEntrySchema>;
export type AuditToolsDto = z.infer<typeof AuditToolsSchema>;
export type AuditOutcomeDto = z.infer<typeof AuditOutcomeSchema>;
