/**
 * `GET /v1/admin/cost` (spec 006 US3-1 … US3-3, FR-012): served-request cost against the
 * baseline target, grouped by UTC day, route or model.
 */
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { CostReportSchema } from "@tamiz/contracts";
import type { Schema } from "hono";
import type { CostReportUseCase } from "../../../application/use-cases/cost-report.js";
import { httpStatusFor, toErrorEnvelope } from "../../mappers/error-envelope.js";
import { CostQueryParams, CostReportBody, ErrorEnvelopeBody } from "../../openapi-schemas.js";
import type { ChatEnv } from "../chat-completions.js";

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorEnvelopeBody } },
});

export const costRoute = createRoute({
  method: "get",
  path: "/v1/admin/cost",
  summary: "Cost of served requests against the baseline target (admin)",
  security: [{ bearerAuth: [] }],
  request: { query: CostQueryParams },
  responses: {
    200: {
      description: "Cost rows, requests not served and totals",
      content: { "application/json": { schema: CostReportBody } },
    },
    400: errorResponse("Missing or malformed dates, an empty range or an unknown groupBy"),
    401: errorResponse("Missing or invalid API key"),
    403: errorResponse("The key is not an admin key"),
  },
});

export function registerAdminCost<S extends Schema, B extends string>(
  app: OpenAPIHono<ChatEnv, S, B>,
  report: CostReportUseCase,
) {
  return app.openapi(costRoute, async (c) => {
    const query = c.req.valid("query");
    if (Date.parse(query.from) >= Date.parse(query.to)) {
      return c.json(
        toErrorEnvelope("invalid_request", "from: must be before to", c.get("requestId")),
        httpStatusFor("invalid_request") as 400,
      );
    }
    return c.json(CostReportSchema.parse(await report(query)), 200);
  });
}
