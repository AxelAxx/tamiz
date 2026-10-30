/**
 * `QueryAuditLog` (spec 006 US2-2 … US2-4, FR-007, research R-05).
 *
 * Reads one page more than asked to know whether another page exists; the cursor is the
 * position of the page's last entry, encoded as opaque base64url JSON. A malformed cursor
 * is a client error, never a silent first page.
 */
import type { AuditEntry } from "../../domain/model/audit-entry.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { AuditFilters, AuditPosition, AuditReaderPort } from "../ports/audit-reader.port.js";

export interface AuditQuery extends AuditFilters {
  readonly cursor?: string;
  readonly limit: number;
}

export interface AuditPage {
  readonly entries: ReadonlyArray<AuditEntry>;
  readonly nextCursor: string | null;
}

export type QueryAuditLog = (query: AuditQuery) => Promise<Result<AuditPage, "invalid_cursor">>;

function toBase64Url(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

export function encodeCursor(position: AuditPosition): string {
  return toBase64Url(JSON.stringify({ t: position.startedAt, id: position.id }));
}

export function decodeCursor(cursor: string): AuditPosition | undefined {
  try {
    const value: unknown = JSON.parse(fromBase64Url(cursor));
    if (typeof value !== "object" || value === null) return undefined;
    const { t, id } = value as { t?: unknown; id?: unknown };
    if (typeof t !== "string" || typeof id !== "string" || Number.isNaN(Date.parse(t))) {
      return undefined;
    }
    return { startedAt: t, id };
  } catch {
    return undefined;
  }
}

export function queryAuditLog(reader: AuditReaderPort): QueryAuditLog {
  return async ({ cursor, limit, ...filters }) => {
    const after = cursor === undefined ? undefined : decodeCursor(cursor);
    if (cursor !== undefined && after === undefined) return err("invalid_cursor");
    const found = await reader.page(filters, after, limit + 1);
    const entries = found.slice(0, limit);
    const last = entries.at(-1);
    return ok({
      entries,
      nextCursor:
        found.length > limit && last !== undefined
          ? encodeCursor({ startedAt: last.startedAt, id: last.id })
          : null,
    });
  };
}
