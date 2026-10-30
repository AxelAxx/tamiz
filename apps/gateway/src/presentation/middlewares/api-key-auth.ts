/**
 * API key authentication for `/v1/*` (spec 002 FR-029, research R-10).
 *
 * Reads `Authorization: Bearer <key>` and asks the injected `authenticate` function
 * (hash + constant-time compare, wired in `main.ts`) for the client id. On success the
 * id is stored as the context variable `clientId`; otherwise the request ends with the
 * 401 envelope. The key itself is never logged or stored.
 */
import type { MiddlewareHandler } from "hono";
import { httpStatusFor, toErrorEnvelope } from "../mappers/error-envelope.js";
import type { RequestIdVariables } from "./request-id.js";

/** Who owns `key` and with which role (spec 006 FR-008), or `undefined`. */
export type Authenticate = (
  key: string,
) =>
  | { readonly clientId: string; readonly role: "client" | "admin" }
  | undefined
  | Promise<{ readonly clientId: string; readonly role: "client" | "admin" } | undefined>;

export type ClientIdVariables = {
  clientId: string;
  role: "client" | "admin";
};

const BEARER = /^Bearer ([^\s]+)$/;

export function apiKeyAuth(
  authenticate: Authenticate,
): MiddlewareHandler<{ Variables: RequestIdVariables & ClientIdVariables }> {
  return async (c, next) => {
    const presented = BEARER.exec(c.req.header("authorization") ?? "")?.[1];
    const principal = presented === undefined ? undefined : await authenticate(presented);
    if (principal === undefined) {
      return c.json(
        toErrorEnvelope("unauthorized", "Missing or invalid API key", c.get("requestId")),
        httpStatusFor("unauthorized"),
      );
    }
    c.set("clientId", principal.clientId);
    c.set("role", principal.role);
    await next();
  };
}
