import {
  AuditQuerySchema,
  ChatCompletionRequestSchema,
  CostQuerySchema,
  ProvidersQuerySchema,
} from "@tamiz/contracts";
import { type Context, Hono } from "hono";
import { AUDIT_PAGES, COST_REPORT, PROVIDERS, SIMULATE_DNI } from "./fixtures.js";

/**
 * A fake Tamiz gateway (research R-12): the simulate and admin routes, with the gateway's
 * key roles and the real contracts on both sides. Every request is recorded; a scripted
 * failure replaces the next answers until it is cleared.
 */

export const ADMIN_KEY = "tamiz_test_admin_7c1f9e2a4b";
export const CLIENT_KEY = "tamiz_test_client_3d8e6a0b5f";

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  /** The `Authorization` header, as the gateway received it. */
  authorization: string | undefined;
  body?: unknown;
}

export type ScriptedFailure =
  | { kind: "status"; status: 400 | 401 | 403 | 404 | 500 | 502 | 503; message?: string }
  | { kind: "delay"; ms: number }
  | { kind: "body"; body: unknown };

export interface FakeGateway {
  app: Hono;
  /** A `fetch` that calls the app in process, as the gateway client expects. */
  fetch: typeof fetch;
  requests: RecordedRequest[];
  fail(failure: ScriptedFailure | undefined): void;
}

const STATUS_TYPE = {
  400: "invalid_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  500: "internal",
  502: "provider_error",
  503: "provider_unavailable",
} as const;

function envelope(status: keyof typeof STATUS_TYPE, message: string) {
  return { error: { type: STATUS_TYPE[status], message, requestId: "req-fake" } };
}

export function createFakeGateway(): FakeGateway {
  const requests: RecordedRequest[] = [];
  let failure: ScriptedFailure | undefined;
  const app = new Hono();

  app.use("*", async (c, next) => {
    const raw = c.req.raw.clone();
    const text = await raw.text();
    const recorded: RecordedRequest = {
      method: c.req.method,
      path: c.req.path,
      query: c.req.query(),
      headers: Object.fromEntries(c.req.raw.headers.entries()),
      authorization: c.req.header("authorization"),
    };
    if (text !== "") recorded.body = JSON.parse(text);
    requests.push(recorded);

    const auth = recorded.authorization;
    const key = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined;
    if (key !== ADMIN_KEY && key !== CLIENT_KEY) {
      return c.json(envelope(401, "missing or invalid API key"), 401);
    }
    if (c.req.path.startsWith("/v1/admin/") && key !== ADMIN_KEY) {
      return c.json(envelope(403, "this endpoint needs an admin key"), 403);
    }
    if (failure !== undefined) {
      const answer = await scripted(c, failure);
      if (answer !== undefined) return answer;
    }
    return next();
  });

  app.post("/v1/simulate", async (c) => {
    const parsed = ChatCompletionRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json(envelope(400, "invalid simulate body"), 400);
    return c.json(SIMULATE_DNI);
  });

  app.get("/v1/admin/providers", (c) => {
    const parsed = ProvidersQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json(envelope(400, "invalid providers query"), 400);
    return c.json({ ...PROVIDERS, windowMinutes: parsed.data.windowMinutes });
  });

  app.get("/v1/admin/audit", (c) => {
    const parsed = AuditQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json(envelope(400, "invalid audit query"), 400);
    return c.json(parsed.data.cursor === "page-2" ? AUDIT_PAGES.second : AUDIT_PAGES.first);
  });

  app.get("/v1/admin/cost", (c) => {
    const parsed = CostQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json(envelope(400, "invalid cost query"), 400);
    if (Date.parse(parsed.data.from) >= Date.parse(parsed.data.to)) {
      return c.json(envelope(400, "from must be before to"), 400);
    }
    return c.json({ ...COST_REPORT, ...parsed.data });
  });

  return {
    app,
    fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
    requests,
    fail(next) {
      failure = next;
    },
  };
}

async function scripted(c: Context, failure: ScriptedFailure): Promise<Response | undefined> {
  switch (failure.kind) {
    case "status":
      return c.json(
        envelope(failure.status, failure.message ?? "scripted failure"),
        failure.status,
      );
    case "delay":
      await new Promise((resolve) => setTimeout(resolve, failure.ms));
      return undefined;
    case "body":
      return c.json(failure.body as object);
  }
}
