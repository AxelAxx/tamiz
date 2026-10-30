/**
 * Admin API contracts (spec 006 FR-007, FR-012 … FR-014, data-model section 1.2).
 *
 * `GET /v1/admin/audit` takes its filters from the query string (strings coerced here) and
 * answers a page of audit entries, newest first, with an opaque cursor.
 */
import { z } from "zod";
import { AuditEntrySchema, AuditOutcomeSchema } from "./audit.js";
import { PrivacyEntityKindSchema } from "./privacy-service.js";
import { PrivacyActionSchema } from "./routing-policy.js";

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
