/**
 * Where audit entries go (spec 006 FR-001, FR-004, data-model section 3).
 *
 * `append` is fire-and-forget: it never throws into the request and the caller never
 * waits for it. Adapters that can lose entries (a database writer under pressure) report
 * every loss as an `audit.dropped` routing event (spec 006 research R-02).
 */
import type { AuditEntry } from "../../domain/model/audit-entry.js";

export interface AuditLogPort {
  append(entry: AuditEntry): void;
}
