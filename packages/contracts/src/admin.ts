/**
 * Admin API contracts (spec 006 FR-007, FR-012 … FR-014, data-model section 1.2).
 *
 * `GET /v1/admin/audit` takes its filters from the query string (strings coerced here) and
 * answers a page of audit entries, newest first, with an opaque cursor.
 */
import { z } from "zod";
import { AuditEntrySchema, AuditOutcomeSchema } from "./audit.js";
import { PrivacyEntityKindSchema } from "./privacy-service.js";
import { PrivacyActionSchema, ProviderNameSchema, ResidencySchema } from "./routing-policy.js";

export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 200;

export const AuditQuerySchema = z.strictObject({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  route: z.string().min(1).optional(),
  rule: z.string().min(1).optional(),
  sensitivity: z.enum(["unknown", "none", "low", "high", "critical"]).optional(),
  action: PrivacyActionSchema.optional(),
  entity: PrivacyEntityKindSchema.optional(),
  outcome: AuditOutcomeSchema.optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).default(AUDIT_PAGE_DEFAULT),
});

export const AuditPageSchema = z.strictObject({
  entries: z.array(AuditEntrySchema),
  /** Pass back as `cursor` for the next (older) page; `null` on the last page. */
  nextCursor: z.string().nullable(),
});

export type AuditQueryDto = z.infer<typeof AuditQuerySchema>;
export type AuditPageDto = z.infer<typeof AuditPageSchema>;

/** `GET /v1/admin/cost` (spec 006 FR-012). Days are UTC. */
export const CostQuerySchema = z.strictObject({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  groupBy: z.enum(["day", "route", "model"]).default("day"),
});

export const CostRowSchema = z.strictObject({
  key: z.string(),
  requests: z.int().min(0),
  inputTokens: z.int().min(0),
  outputTokens: z.int().min(0),
  costUsd: z.number().min(0),
  baselineCostUsd: z.number().min(0),
});

export const CostReportSchema = z.strictObject({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  groupBy: z.enum(["day", "route", "model"]),
  /** The policy's most expensive target; `null` when no target is priced. */
  baseline: z
    .strictObject({
      targetId: z.string(),
      inputUsdPerMillion: z.number().min(0),
      outputUsdPerMillion: z.number().min(0),
    })
    .nullable(),
  rows: z.array(CostRowSchema),
  notServed: z.strictObject({
    requests: z.int().min(0),
    blocked: z.int().min(0),
    failed: z.int().min(0),
  }),
  totals: CostRowSchema,
});

/** `GET /v1/admin/providers` (spec 006 FR-013). */
export const ProvidersQuerySchema = z.strictObject({
  windowMinutes: z.coerce.number().int().min(1).max(1_440).default(15),
});

export const ProviderHealthSchema = z.strictObject({
  targetId: z.string(),
  provider: ProviderNameSchema,
  model: z.string(),
  residency: ResidencySchema,
  circuit: z.enum(["closed", "open", "half_open"]),
  cooldownRemainingMs: z.int().min(0).optional(),
  window: z.strictObject({
    requests: z.int().min(0),
    errors: z.int().min(0),
    errorRate: z.number().min(0).max(1),
    latencyP50Ms: z.number().min(0).nullable(),
    latencyP95Ms: z.number().min(0).nullable(),
  }),
});

export const ProvidersReportSchema = z.strictObject({
  windowMinutes: z.int().min(1),
  generatedAt: z.iso.datetime(),
  targets: z.array(ProviderHealthSchema),
});

export type CostQueryDto = z.infer<typeof CostQuerySchema>;
export type CostReportDto = z.infer<typeof CostReportSchema>;
export type ProvidersReportDto = z.infer<typeof ProvidersReportSchema>;
