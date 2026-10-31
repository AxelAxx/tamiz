// @vitest-environment node
import { HealthResponseSchema } from "@tamiz/contracts";
import { describe, expect, it, vi } from "vitest";
import { BffErrorSchema } from "../src/lib/schemas";
import {
  callGateway,
  createGatewayClient,
  type GatewayAnswer,
  type GatewayCallLog,
} from "../src/lib/server/gateway";

// Spec 008 FR-002, FR-006, contracts/dashboard-bff.md (tasks.md T012).

const KEY = "tmz_dashboard-admin-key-test-value-0000000000";

function answer(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): GatewayAnswer {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    json: async () => body,
  };
}

async function call(result: GatewayAnswer | Error) {
  const lines: GatewayCallLog[] = [];
  const response = await callGateway({
    endpoint: "/health",
    schema: HealthResponseSchema,
    call: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
    log: (line) => lines.push(line),
    now: () => 0,
  });
  const body: unknown = await response.json();
  return { response, body, lines };
}

const HEALTH = { status: "ok", version: "0.1.0", uptimeMs: 12 };

describe("gateway client", () => {
  it("US1-3: calls the gateway with the admin key as a bearer token and a timeout", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json(HEALTH),
    );
    const client = createGatewayClient({ baseUrl: "http://gateway.test", adminKey: KEY, fetch });
    await client.health.$get();
    const [input, init] = fetch.mock.calls[0] ?? [];
    expect(String(input instanceof Request ? input.url : input)).toBe("http://gateway.test/health");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("callGateway", () => {
  it("FR-006: a valid answer is passed on, parsed by its contract", async () => {
    const { response, body, lines } = await call(answer(200, HEALTH, { "x-request-id": "r-1" }));
    expect(response.status).toBe(200);
    expect(body).toEqual(HEALTH);
    expect(lines).toEqual([
      { endpoint: "/health", status: 200, durationMs: 0, gatewayRequestId: "r-1" },
    ]);
  });

  it("FR-006: an answer that breaks the contract is a 502 contract error with paths only", async () => {
    const { response, body } = await call(
      answer(200, { status: "ok", version: "secret-looking-value" }),
    );
    expect(response.status).toBe(502);
    expect(BffErrorSchema.parse(body).error).toMatchObject({
      type: "contract",
      endpoint: "/health",
      issues: ["uptimeMs"],
    });
    expect(JSON.stringify(body)).not.toContain("secret-looking-value");
  });

  it("a network error or timeout is a 504 gateway_unreachable", async () => {
    const { response, body, lines } = await call(new DOMException("timed out", "TimeoutError"));
    expect(response.status).toBe(504);
    expect(BffErrorSchema.parse(body).error.type).toBe("gateway_unreachable");
    expect(lines[0]?.status).toBe("unreachable");
  });

  it.each([401, 403])("a gateway %i is a 502 gateway_credentials", async (status) => {
    const envelope = { error: { type: "unauthorized", message: "no", requestId: "r" } };
    const { response, body } = await call(answer(status, envelope));
    expect(response.status).toBe(502);
    expect(BffErrorSchema.parse(body).error.type).toBe("gateway_credentials");
  });

  it("a gateway error envelope is passed through with its status", async () => {
    const envelope = {
      error: { type: "invalid_request", message: "from: must be before to", requestId: "r-2" },
    };
    const { response, body } = await call(answer(400, envelope));
    expect(response.status).toBe(400);
    expect(BffErrorSchema.parse(body).error).toEqual({
      type: "gateway",
      message: "from: must be before to",
      endpoint: "/health",
      gatewayError: envelope.error,
    });
  });

  it("an error that is not an envelope is a 502 contract error", async () => {
    const { response, body } = await call(answer(500, { oops: true }));
    expect(response.status).toBe(502);
    expect(BffErrorSchema.parse(body).error.type).toBe("contract");
  });
});
