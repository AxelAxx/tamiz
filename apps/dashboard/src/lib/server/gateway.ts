/**
 * The gateway client (spec 008 FR-002, FR-006, research R-01, R-02).
 *
 * `hc` typed by the gateway's own route table, holding the admin key, with a 10-second
 * timeout. Every answer is still parsed with the contract before it leaves the dashboard,
 * and errors are mapped as `contracts/dashboard-bff.md` lists. One log line per call with
 * endpoint, status, duration and the gateway's `x-request-id`; never a body.
 */
import "server-only";
import { ErrorEnvelopeSchema } from "@tamiz/contracts";
import type { GatewayRoutes } from "@tamiz/gateway/routes";
import { hc } from "hono/client";
import type { z } from "zod";
import { bffError, issuePaths } from "./handler";

export const GATEWAY_TIMEOUT_MS = 10_000;

export function createGatewayClient(options: {
  readonly baseUrl: string;
  readonly adminKey: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}) {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? GATEWAY_TIMEOUT_MS;
  return hc<GatewayRoutes>(options.baseUrl, {
    headers: { authorization: `Bearer ${options.adminKey}` },
    fetch: (input: string | URL | Request, init?: RequestInit) =>
      fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
  });
}

export type GatewayClient = ReturnType<typeof createGatewayClient>;

/** What `callGateway` needs from an `hc` response. */
export interface GatewayAnswer {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  json(): Promise<unknown>;
}

export interface GatewayCallLog {
  readonly endpoint: string;
  readonly status: number | "unreachable";
  readonly durationMs: number;
  readonly gatewayRequestId?: string;
}

export async function callGateway<T>(options: {
  readonly endpoint: string;
  readonly schema: z.ZodType<T>;
  readonly call: () => Promise<GatewayAnswer>;
  readonly log: (line: GatewayCallLog) => void;
  readonly now?: () => number;
}): Promise<Response> {
  const now = options.now ?? Date.now;
  const { endpoint } = options;
  const started = now();
  let answer: GatewayAnswer;
  try {
    answer = await options.call();
  } catch {
    options.log({ endpoint, status: "unreachable", durationMs: now() - started });
    return bffError(504, "gateway_unreachable", "The gateway did not answer", { endpoint });
  }
  const requestId = answer.headers.get("x-request-id");
  options.log({
    endpoint,
    status: answer.status,
    durationMs: now() - started,
    ...(requestId === null ? {} : { gatewayRequestId: requestId }),
  });

  if (answer.status === 401 || answer.status === 403) {
    return bffError(502, "gateway_credentials", "The gateway refused the dashboard's key", {
      endpoint,
    });
  }

  let body: unknown;
  try {
    body = await answer.json();
  } catch {
    return bffError(502, "contract", "The gateway answer is not JSON", { endpoint });
  }

  if (!answer.ok) {
    const envelope = ErrorEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      return bffError(502, "contract", "The gateway error breaks the contract", {
        endpoint,
        issues: issuePaths(envelope.error),
      });
    }
    return bffError(answer.status, "gateway", envelope.data.error.message, {
      endpoint,
      gatewayError: envelope.data.error,
    });
  }

  const parsed = options.schema.safeParse(body);
  if (!parsed.success) {
    return bffError(502, "contract", "The gateway answer breaks the contract", {
      endpoint,
      issues: issuePaths(parsed.error),
    });
  }
  return Response.json(parsed.data);
}
