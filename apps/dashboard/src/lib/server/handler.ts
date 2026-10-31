/**
 * Route handlers are composed from small wrappers (spec 008 research R-01, constitution
 * IX): `withNoStore`, `withOrigin`, `withSession`. Each refuses with the BFF error shape
 * before the wrapped handler runs, so a refused request never reads its body or calls the
 * gateway.
 */
import "server-only";
import type { z } from "zod";
import type { BffError, BffErrorType } from "../schemas";
import { isSameOrigin } from "./origin";

export type RouteHandler = (request: Request) => Promise<Response>;
export type Wrapper = (handler: RouteHandler) => RouteHandler;

export function bffError(
  status: number,
  type: BffErrorType,
  message: string,
  extra: Omit<BffError["error"], "type" | "message"> = {},
  headers: HeadersInit = {},
): Response {
  const body: BffError = { error: { type, message, ...extra } };
  return Response.json(body, { status, headers });
}

/** Wrappers apply outermost first: `compose(a, b)(h)` is `a(b(h))`. */
export function compose(...wrappers: ReadonlyArray<Wrapper>): Wrapper {
  return (handler) => wrappers.reduceRight((inner, wrap) => wrap(inner), handler);
}

export const withNoStore: Wrapper = (handler) => async (request) => {
  const response = await handler(request);
  response.headers.set("cache-control", "no-store");
  return response;
};

export function withOrigin(allowedOrigin: () => string): Wrapper {
  return (handler) => async (request) =>
    isSameOrigin(request, allowedOrigin())
      ? handler(request)
      : bffError(403, "forbidden_origin", "Cross-origin request refused");
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (header === null) return undefined;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function withSession(cookieName: string, isValid: (cookie: string) => boolean): Wrapper {
  return (handler) => async (request) => {
    const cookie = readCookie(request, cookieName);
    return cookie !== undefined && isValid(cookie)
      ? handler(request)
      : bffError(401, "unauthenticated", "Sign in to continue");
  };
}

/** Issue paths in dot form (`messages.0.content`), `(root)` for the root; never values. */
export function issuePaths(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.path.join(".") || "(root)");
}

/** The JSON body parsed with `schema`, or a `400 invalid_request` with the issue paths. */
export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: bffError(400, "invalid_request", "Expected a JSON body"),
    };
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    response: bffError(400, "invalid_request", "The request fails its contract", {
      issues: issuePaths(parsed.error),
    }),
  };
}

/** The query string parsed with `schema`, or a `400 invalid_request` with the issue paths. */
export function readQuery<T>(
  request: Request,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false; response: Response } {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = schema.safeParse(params);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    response: bffError(400, "invalid_request", "The query fails its contract", {
      issues: issuePaths(parsed.error),
    }),
  };
}
