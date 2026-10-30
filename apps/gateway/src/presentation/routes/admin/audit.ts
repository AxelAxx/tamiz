/**
 * `GET /v1/admin/audit` (spec 006 US2-2 … US2-4, FR-007): audit entries newest first,
 * filtered and paginated with an opaque cursor. Entries carry no content by contract.
 */
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { AuditEntrySchema } from "@tamiz/contracts";
import type { AuditQuery, QueryAuditLog } from "../../../application/use-cases/query-audit-log.js";
import { httpStatusFor, toErrorEnvelope } from "../../mappers/error-envelope.js";
import { AuditPageBody, AuditQueryParams, ErrorEnvelopeBody } from "../../openapi-schemas.js";
import type { ChatEnv } from "../chat-completions.js";

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorEnvelopeBody } },
});

export const auditRoute = createRoute({
  method: "get",
  path: "/v1/admin/audit",
  summary: "Audit entries, newest first, filtered and paginated (admin)",
  security: [{ bearerAuth: [] }],
  request: { query: AuditQueryParams },
  responses: {
    200: {
      description: "A page of audit entries and the cursor of the next one",
      content: { "application/json": { schema: AuditPageBody } },
    },
    400: errorResponse("An unknown filter value, a limit out of range or a malformed cursor"),
    401: errorResponse("Missing or invalid API key"),
    403: errorResponse("The key is not an admin key"),
  },
});

export function registerAdminAudit(app: OpenAPIHono<ChatEnv>, query: QueryAuditLog): void {
  app.openapi(auditRoute, async (c) => {
    const params = c.req.valid("query");
    // `exactOptionalPropertyTypes`: pass only the filters that are present.
    const filters = Object.fromEntries(
      Object.entries(params).filter(([, value]) => value !== undefined),
    ) as unknown as AuditQuery;
    const result = await query(filters);
    if (!result.ok) {
      return c.json(
        toErrorEnvelope(
          "invalid_request",
          "cursor: expected a cursor from a previous page",
          c.get("requestId"),
        ),
        httpStatusFor("invalid_request") as 400,
      );
    }
    // Parsing with the contract both checks the entries and gives the response's own types.
    const entries = result.value.entries.map((entry) => AuditEntrySchema.parse(entry));
    return c.json({ entries, nextCursor: result.value.nextCursor }, 200);
  });
}
