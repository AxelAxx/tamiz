/**
 * `/v1/admin/*` is for admin keys only (spec 006 FR-008, research R-07). Runs after
 * `apiKeyAuth`, which has already answered 401 for a missing or invalid key; a valid client
 * key gets `403 forbidden`.
 */
import type { MiddlewareHandler } from "hono";
import { httpStatusFor, toErrorEnvelope } from "../mappers/error-envelope.js";
import type { ClientIdVariables } from "./api-key-auth.js";
import type { RequestIdVariables } from "./request-id.js";

export function adminOnly(): MiddlewareHandler<{
  Variables: RequestIdVariables & ClientIdVariables;
}> {
  return async (c, next) => {
    if (c.get("role") !== "admin") {
      return c.json(
        toErrorEnvelope("forbidden", "This endpoint requires an admin API key", c.get("requestId")),
        httpStatusFor("forbidden"),
      );
    }
    await next();
  };
}
