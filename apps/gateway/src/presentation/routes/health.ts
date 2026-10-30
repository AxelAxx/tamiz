/**
 * `GET /health` (spec FR-017, data-model section 4).
 *
 * Always `status: "ok"` in this feature; `checks` arrive with features 006 and OPS. The
 * body is validated against the contract before it is sent, so a drift between the
 * handler and `@tamiz/contracts` fails loudly instead of leaking an off-contract body.
 * Declared with `createRoute` so the OpenAPI document lists it (spec 002 FR-031).
 */
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { type HealthResponse, HealthResponseSchema, milliseconds } from "@tamiz/contracts";
import type { Env } from "hono";
import type { ClockPort } from "../../application/ports/clock.port.js";
import { HealthResponseBody } from "../openapi-schemas.js";

export interface HealthDeps {
  readonly clock: ClockPort;
  readonly version: string;
  readonly startedAt: Date;
}

export function buildHealthResponse(deps: HealthDeps): HealthResponse {
  const elapsed = deps.clock.now().getTime() - deps.startedAt.getTime();
  const uptimeMs = milliseconds(Math.max(0, Math.round(elapsed)));
  return HealthResponseSchema.parse({ status: "ok", version: deps.version, uptimeMs });
}

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  summary: "Liveness and version; needs no API key",
  responses: {
    200: {
      description: "The gateway is up",
      content: { "application/json": { schema: HealthResponseBody } },
    },
  },
});

export function registerHealth<E extends Env>(app: OpenAPIHono<E>, deps: HealthDeps): void {
  app.openapi(healthRoute, (c) => c.json(buildHealthResponse(deps), 200));
}
