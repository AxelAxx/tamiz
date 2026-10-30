/**
 * The Hono application (research R-08; spec 002 research R-11).
 *
 * `createApp(deps)` returns an app that tests drive in-process with `app.request()`; it
 * never binds a port itself (that is `main.ts`). Every response carries `x-request-id`;
 * unknown routes, invalid bodies and unhandled errors answer with the `ErrorEnvelope`
 * contract; one structured log line per request records method, path, status, duration,
 * client and route, never the body. Routes are declared with `createRoute`, and the
 * OpenAPI 3.1 document derived from the contract schemas is served at `/openapi.json`.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { ClockPort } from "../application/ports/clock.port.js";
import type { LoggerPort } from "../application/ports/logger.port.js";
import type { QueryAuditLog } from "../application/use-cases/query-audit-log.js";
import type { RouteInference } from "../application/use-cases/route-inference.js";
import type { SimulatePolicy } from "../application/use-cases/simulate-policy.js";
import type { StreamInference } from "../application/use-cases/stream-inference.js";
import { fromZodIssues, httpStatusFor, toErrorEnvelope } from "./mappers/error-envelope.js";
import { adminOnly } from "./middlewares/admin-only.js";
import { type Authenticate, apiKeyAuth } from "./middlewares/api-key-auth.js";
import { requestId } from "./middlewares/request-id.js";
import { registerAdminAudit } from "./routes/admin/audit.js";
import { type ChatEnv, ROUTE_HEADER, registerChatCompletions } from "./routes/chat-completions.js";
import { registerHealth } from "./routes/health.js";
import { registerSimulate } from "./routes/simulate.js";

export interface AppDeps {
  readonly clock: ClockPort;
  readonly version: string;
  readonly startedAt: Date;
  readonly logger: LoggerPort;
  readonly routeInference: RouteInference;
  readonly streamInference: StreamInference;
  /** `POST /v1/simulate` (spec 005 FR-018). */
  readonly simulatePolicy: SimulatePolicy;
  /** `GET /v1/admin/audit` (spec 006 FR-007). */
  readonly queryAuditLog: QueryAuditLog;
  /** Maps a presented API key to its client id (hash + constant-time compare). */
  readonly authenticate: Authenticate;
}

export type AppEnv = ChatEnv;

export type GatewayApp = OpenAPIHono<AppEnv>;

/** FR-032: request bodies above 1 MiB are refused before parsing. */
export const MAX_BODY_BYTES = 1_048_576;

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
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (result.success) return;
      return c.json(
        toErrorEnvelope("invalid_request", fromZodIssues(result.error.issues), c.get("requestId")),
        httpStatusFor("invalid_request"),
      );
    },
  });

  app.use(requestId());

  app.use(async (c, next) => {
    const started = deps.clock.now().getTime();
    await next();
    const clientId: string | undefined = c.get("clientId");
    const route = c.res.headers.get(ROUTE_HEADER);
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
        ...(clientId !== undefined && { clientId }),
        ...(route !== null && { route }),
      },
      "request completed",
    );
  });

  app.use(
    "/v1/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json(
          toErrorEnvelope(
            "invalid_request",
            `body: expected at most ${MAX_BODY_BYTES} bytes`,
            c.get("requestId"),
          ),
          httpStatusFor("invalid_request"),
        ),
    }),
  );
  app.use("/v1/*", apiKeyAuth(deps.authenticate));
  app.use("/v1/admin/*", adminOnly());
  // The JSON validator skips bodies of another media type; refuse them explicitly.
  app.use("/v1/*", async (c, next) => {
    const contentType = c.req.header("content-type")?.toLowerCase() ?? "";
    if (c.req.method === "POST" && !contentType.startsWith("application/json")) {
      return c.json(
        toErrorEnvelope(
          "invalid_request",
          "body: expected content-type application/json",
          c.get("requestId"),
        ),
        httpStatusFor("invalid_request"),
      );
    }
    await next();
  });

  registerHealth(app, deps);
  registerChatCompletions(app, deps.routeInference, deps.streamInference);
  registerSimulate(app, deps.simulatePolicy);
  registerAdminAudit(app, deps.queryAuditLog);

  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
  });
  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Tamiz gateway",
      version: deps.version,
      description: "Privacy-aware LLM gateway: OpenAI-compatible, policy-routed.",
    },
  });

  app.notFound((c) =>
    c.json(
      toErrorEnvelope("not_found", "Route not found", c.get("requestId")),
      httpStatusFor("not_found"),
    ),
  );

  app.onError((error, c) => {
    // The JSON validator throws a 400 for a body that is not JSON.
    if (error instanceof HTTPException && error.status === 400) {
      return c.json(
        toErrorEnvelope("invalid_request", "body: expected a JSON object", c.get("requestId")),
        httpStatusFor("invalid_request"),
      );
    }
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
