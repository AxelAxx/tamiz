/**
 * Request id middleware (spec FR-018, research R-08).
 *
 * Echoes a client-supplied `x-request-id` when it satisfies the `RequestId` contract
 * (1-128 characters of `[A-Za-z0-9_-]`); otherwise generates a UUID. The id is stored in
 * the context variable `requestId` and always set on the response header. Hono's bundled
 * `requestId()` accepts `=` and up to 255 characters, so this is a stricter replacement
 * with the same shape.
 */
import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export const REQUEST_ID_HEADER = "x-request-id";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type RequestIdVariables = {
  requestId: string;
};

export function isWellFormedRequestId(value: string | undefined): value is string {
  return value !== undefined && REQUEST_ID_PATTERN.test(value);
}

export function requestId(): MiddlewareHandler<{ Variables: RequestIdVariables }> {
  return async (c, next) => {
    const supplied = c.req.header(REQUEST_ID_HEADER);
    const id = isWellFormedRequestId(supplied) ? supplied : randomUUID();
    c.set("requestId", id);
    c.header(REQUEST_ID_HEADER, id);
    await next();
  };
}
