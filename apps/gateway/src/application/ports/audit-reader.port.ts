/**
 * Reading the audit log (spec 006 FR-007, research R-05).
 *
 * Entries come newest first by `(startedAt, id)`; `after` is the last entry of the previous
 * page, so concurrent inserts (always newer) never shift a page. Implemented by the
 * in-memory log and by PostgreSQL.
 */
import type { AuditEntry, AuditOutcome } from "../../domain/model/audit-entry.js";
import type { PrivacyAction } from "../../domain/model/privacy-policy.js";
import type { EntityKind, Sensitivity } from "../../domain/model/sensitivity.js";

export interface AuditFilters {
  /** Inclusive, on `startedAt` (ISO). */
  readonly from?: string;
  /** Exclusive, on `startedAt` (ISO). */
  readonly to?: string;
  /** The answering (or last reached) target. */
  readonly route?: string;
  readonly rule?: string;
  readonly sensitivity?: Sensitivity;
  readonly action?: PrivacyAction;
  readonly entity?: EntityKind;
  readonly outcome?: AuditOutcome;
}

export interface AuditPosition {
  readonly startedAt: string;
  readonly id: string;
}

export interface AuditReaderPort {
  /** Up to `limit` entries matching `filters`, strictly older than `after`. */
  page(
    filters: AuditFilters,
    after: AuditPosition | undefined,
    limit: number,
  ): Promise<ReadonlyArray<AuditEntry>>;
}

/** Newest first; ties broken by id (descending). */
export function compareNewestFirst(a: AuditPosition, b: AuditPosition): number {
  const time = Date.parse(b.startedAt) - Date.parse(a.startedAt);
  if (time !== 0) return time;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** True when `entry` matches every present filter and comes after `after`. */
export function matchesFilters(
  entry: AuditEntry,
  filters: AuditFilters,
  after: AuditPosition | undefined,
): boolean {
  const started = Date.parse(entry.startedAt);
  if (filters.from !== undefined && started < Date.parse(filters.from)) return false;
  if (filters.to !== undefined && started >= Date.parse(filters.to)) return false;
  if (filters.route !== undefined && entry.target?.id !== filters.route) return false;
  if (filters.rule !== undefined && entry.ruleId !== filters.rule) return false;
  if (filters.sensitivity !== undefined && entry.sensitivity !== filters.sensitivity) return false;
  if (filters.action !== undefined && entry.privacyAction !== filters.action) return false;
  if (filters.entity !== undefined && (entry.entities[filters.entity] ?? 0) === 0) return false;
  if (filters.outcome !== undefined && entry.outcome !== filters.outcome) return false;
  // In newest-first order, `after` sorts before every entry of the next page.
  return after === undefined || compareNewestFirst(after, entry) < 0;
}
