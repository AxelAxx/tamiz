/**
 * The gateway's simulate and admin endpoints, as the tools call them (spec 009 FR-002,
 * FR-007, research R-07).
 *
 * One function per endpoint. Each sets the bearer key and an `x-request-id`, applies the
 * timeout, parses the body with its contract and maps every failure to a tool error code.
 * Messages are built from codes, statuses and the gateway's error message, never from
 * request headers, so the key cannot reach a tool result (FR-005).
 */
import { randomUUID } from "node:crypto";
import {
  type AuditPageDto,
  AuditPageSchema,
  type ChatMessage,
  type CostReportDto,
  CostReportSchema,
  ErrorEnvelopeSchema,
  type McpToolErrorCode,
  type ProvidersReportDto,
  ProvidersReportSchema,
  type SimulateResponse,
  SimulateResponseSchema,
} from "@tamiz/contracts";
import type { z } from "zod";
import { err, ok, type Result } from "./result.js";

export interface ToolError {
  code: McpToolErrorCode;
  message: string;
}

export type GatewayResult<T> = Promise<Result<T, ToolError>>;

/** A query string's values; `undefined` entries are dropped (`exactOptionalPropertyTypes`). */
export type QueryValues = Readonly<Record<string, string | number | undefined>>;

export interface GatewayClient {
  simulate(body: { model: string; messages: ChatMessage[] }): GatewayResult<SimulateResponse>;
  providers(query: { windowMinutes: number }): GatewayResult<ProvidersReportDto>;
  audit(query: QueryValues): GatewayResult<AuditPageDto>;
  cost(query: QueryValues): GatewayResult<CostReportDto>;
}

export interface GatewayClientOptions {
  baseUrl: string;
  key: string;
  timeoutMs: number;
  fetch: typeof fetch;
}

const MESSAGE_MAX = 500;

class Timeout extends Error {}

export function createGatewayClient(options: GatewayClientOptions): GatewayClient {
  async function call<T>(
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType<T>,
    payload: { query?: QueryValues; body?: unknown },
  ): GatewayResult<T> {
    const url = new URL(`${options.baseUrl}${path}`);
    for (const [name, value] of Object.entries(payload.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${options.key}`,
      "x-request-id": `mcp-${randomUUID()}`,
      accept: "application/json",
    };
    const init: RequestInit = { method, headers };
    if (payload.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(payload.body);
    }

    let response: Response;
    let body: unknown;
    try {
      ({ response, body } = await withTimeout(options.timeoutMs, async (signal) => {
        const answer = await options.fetch(url, { ...init, signal });
        return { response: answer, body: await readJson(answer) };
      }));
    } catch (error) {
      if (error instanceof Timeout) {
        return err({
          code: "gateway_timeout",
          message: `the gateway did not answer within ${options.timeoutMs} ms`,
        });
      }
      return err({ code: "gateway_unreachable", message: "the gateway could not be reached" });
    }

    if (!response.ok) return err(statusError(response.status, body));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where =
        issue === undefined || issue.path.length === 0 ? "(root)" : issue.path.join(".");
      return err({
        code: "gateway_contract",
        message: truncate(`the gateway answer does not match the contract at ${where}`),
      });
    }
    return ok(parsed.data);
  }

  return {
    simulate: (body) => call("POST", "/v1/simulate", SimulateResponseSchema, { body }),
    providers: (query) => call("GET", "/v1/admin/providers", ProvidersReportSchema, { query }),
    audit: (query) => call("GET", "/v1/admin/audit", AuditPageSchema, { query }),
    cost: (query) => call("GET", "/v1/admin/cost", CostReportSchema, { query }),
  };
}

/**
 * Runs `work` with an abort signal and a deadline. The race does not rely on `fetch`
 * honouring the signal (an in-process `fetch` may not), and covers reading the body too.
 */
async function withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Timeout());
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function statusError(status: number, body: unknown): ToolError {
  if (status === 401)
    return { code: "gateway_unauthorized", message: "the gateway key is missing or invalid" };
  if (status === 403)
    return { code: "gateway_forbidden", message: "the gateway key lacks the admin role" };
  if (status >= 500)
    return { code: "gateway_error", message: `the gateway failed with status ${status}` };
  const envelope = ErrorEnvelopeSchema.safeParse(body);
  return {
    code: "gateway_rejected",
    message: envelope.success
      ? truncate(envelope.data.error.message)
      : `the gateway rejected the request with status ${status}`,
  };
}

function truncate(message: string): string {
  return message.length <= MESSAGE_MAX ? message : `${message.slice(0, MESSAGE_MAX - 1)}…`;
}
