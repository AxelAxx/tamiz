import { AuditPageSchema, QueryAuditLogInputSchema } from "@tamiz/contracts";
import { defineTool } from "./definition.js";

/** `query_audit_log` → `GET /v1/admin/audit` (spec 009 FR-010, contracts/tools.md). */
export const queryAuditLog = defineTool({
  name: "query_audit_log",
  title: "Query audit log",
  description:
    "Search Tamiz routing decisions, newest first. Filters: from/to (ISO date-time), route " +
    "(target id), rule, sensitivity, action, entity (kind, e.g. DNI), outcome. Entries hold " +
    "metadata only: kinds and counts, never message text. Use `nextCursor` as `cursor` for " +
    "the next page. Page size 1–50, default 20.",
  inputSchema: QueryAuditLogInputSchema,
  outputSchema: AuditPageSchema,
  gatewayCall: { method: "GET", path: "/v1/admin/audit" },
  // The validated input is the query: the gateway client drops the fields left out.
  run: (input, { gateway }) => gateway.audit(input),
});
