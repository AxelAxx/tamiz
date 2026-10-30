/**
 * In-process `AuditLogPort` (spec 006 FR-005, US2-6): a bounded ring buffer of the most
 * recent entries, used when no database is configured. Older entries are overwritten,
 * which is retention, not loss: the gateway announces at start that the audit log is
 * in memory. Feature 006's admin API reads it the same way it reads PostgreSQL.
 */
import type { AuditLogPort } from "../../application/ports/audit-log.port.js";
import type { AuditEntry } from "../../domain/model/audit-entry.js";

export interface InMemoryAuditLog extends AuditLogPort {
  /** Entries, newest first. */
  readonly entries: () => ReadonlyArray<AuditEntry>;
  readonly size: () => number;
}

export function createInMemoryAuditLog(maxEntries = 10_000): InMemoryAuditLog {
  const buffer: AuditEntry[] = [];
  return {
    append(entry) {
      buffer.push(entry);
      if (buffer.length > maxEntries) buffer.splice(0, buffer.length - maxEntries);
    },
    entries: () => [...buffer].reverse(),
    size: () => buffer.length,
  };
}
