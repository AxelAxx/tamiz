/**
 * `GET /v1/admin/providers` (spec 006 US4-1 … US4-3, FR-013): every declared target with
 * its circuit state and its recent error rate and latency.
 */
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { ProvidersReportSchema } from "@tamiz/contracts";
import type { ProviderHealthUseCase } from "../../../application/use-cases/provider-health.js";
import {
  ErrorEnvelopeBody,
  ProvidersQueryParams,
  ProvidersReportBody,
} from "../../openapi-schemas.js";
import type { ChatEnv } from "../chat-completions.js";

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorEnvelopeBody } },
});

export const providersRoute = createRoute({
  method: "get",
  path: "/v1/admin/providers",
  summary: "Circuit state, error rate and latency per target (admin)",
  security: [{ bearerAuth: [] }],
  request: { query: ProvidersQueryParams },
  responses: {
    200: {
      description: "Every declared target, idle ones included",
      content: { "application/json": { schema: ProvidersReportBody } },
    },
    400: errorResponse("windowMinutes out of range"),
    401: errorResponse("Missing or invalid API key"),
    403: errorResponse("The key is not an admin key"),
  },
});

export function registerAdminProviders(
  app: OpenAPIHono<ChatEnv>,
  health: ProviderHealthUseCase,
): void {
  app.openapi(providersRoute, async (c) => {
    const { windowMinutes } = c.req.valid("query");
    return c.json(ProvidersReportSchema.parse(await health({ windowMinutes })), 200);
  });
}
