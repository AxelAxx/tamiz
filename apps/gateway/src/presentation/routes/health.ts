/**
 * `GET /health` (spec FR-017, data-model section 4).
 *
 * Always `status: "ok"` in this feature; `checks` arrive with features 006 and OPS. The
 * body is validated against the contract before it is sent, so a drift between the
 * handler and `@tamiz/contracts` fails loudly instead of leaking an off-contract body.
 */
import { type HealthResponse, HealthResponseSchema, milliseconds } from "@tamiz/contracts";
import { Hono } from "hono";
import type { ClockPort } from "../../application/ports/clock.port.js";

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

export function healthRoutes(deps: HealthDeps): Hono {
  return new Hono().get("/health", (c) => c.json(buildHealthResponse(deps), 200));
}
