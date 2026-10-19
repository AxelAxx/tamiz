/**
 * The Hono application (research R-08).
 *
 * `createApp(deps)` returns an app that tests drive in-process with `app.request()`; it
 * never binds a port itself (that is `main.ts`). Every response carries `x-request-id`;
 * unknown routes and unhandled errors answer with the `ErrorEnvelope` contract; one
 * structured log line per request records method, path, status and duration, never the
 * body.
 */
import { Hono } from "hono";
import type { ClockPort } from "../application/ports/clock.port.js";
import type { LoggerPort } from "../application/ports/logger.port.js";
import { httpStatusFor, toErrorEnvelope } from "./mappers/error-envelope.js";
import { type RequestIdVariables, requestId } from "./middlewares/request-id.js";
import { healthRoutes } from "./routes/health.js";

export interface AppDeps {
  readonly clock: ClockPort;
  readonly version: string;
  readonly startedAt: Date;
  readonly logger: LoggerPort;
}

export type AppEnv = { Variables: RequestIdVariables };

export type GatewayApp = Hono<AppEnv>;

/**
 * Request headers worth a log line. `authorization` is listed on purpose: the logger
 * redacts it, and seeing `"[REDACTED]"` proves the redaction path works end to end.
 */
const LOGGED_HEADERS: ReadonlyArray<string> = ["authorization", "user-agent", "content-type"];

/** Picks the listed headers that are actually present, so absent ones never appear redacted. */
function presentHeaders(
  headers: Readonly<Record<string, string>>,
  names: ReadonlyArray<string>,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of names) {
    const value = headers[name];
    if (value !== undefined) picked[name] = value;
  }
  return picked;
}

export function createApp(deps: AppDeps): GatewayApp {
  const app = new Hono<AppEnv>();

  app.use(requestId());

  app.use(async (c, next) => {
    const started = deps.clock.now().getTime();
    await next();
    deps.logger.info(
      {
        requestId: c.get("requestId"),
        req: {
          method: c.req.method,
          path: c.req.path,
          headers: presentHeaders(c.req.header(), LOGGED_HEADERS),
        },
        status: c.res.status,
        durationMs: Math.max(0, deps.clock.now().getTime() - started),
      },
      "request completed",
    );
  });

  app.route("/", healthRoutes(deps));

  app.notFound((c) =>
    c.json(
      toErrorEnvelope("not_found", "Route not found", c.get("requestId")),
      httpStatusFor("not_found"),
    ),
  );

  app.onError((error, c) => {
    deps.logger.error(
      { requestId: c.get("requestId"), err: error, path: c.req.path },
      "unhandled error",
    );
    return c.json(
      toErrorEnvelope("internal", "Internal server error", c.get("requestId")),
      httpStatusFor("internal"),
    );
  });

  return app;
}
