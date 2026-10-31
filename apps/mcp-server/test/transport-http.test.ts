import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { MCP_TOOL_NAMES, McpToolErrorSchema } from "@tamiz/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpApp, type McpHttpApp } from "../src/transports/http.js";
import {
  ADMIN_KEY,
  CLIENT_KEY,
  createFakeGateway,
  type FakeGateway,
} from "./support/fake-gateway.js";
import { DNI_TEXT } from "./support/fixtures.js";
import { captureLogs, GATEWAY_URL, textJson } from "./support/mcp-harness.js";
import { expectNoKey } from "./support/no-key.js";

// Spec 009 US4-2 … US4-5 (tasks.md T006). The Hono app is called in process: no socket.

const MCP_URL = "http://127.0.0.1:3100/mcp";

function setup(): { app: McpHttpApp; fake: FakeGateway; logs: string[] } {
  const fake = createFakeGateway();
  const { logger, lines } = captureLogs();
  const app = createHttpApp({
    host: "127.0.0.1",
    gatewayUrl: GATEWAY_URL,
    timeoutMs: 2_000,
    simulateModel: "auto",
    tools: MCP_TOOL_NAMES,
    logger,
    fetch: fake.fetch,
  });
  return { app, fake, logs: lines };
}

/** A `fetch` that hands each request to the app, with the `Host` a socket would carry. */
function inProcess(app: McpHttpApp): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    if (!headers.has("host")) headers.set("host", url.host);
    return app.fetch(new Request(url, { ...init, headers }));
  };
}

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function client(app: McpHttpApp, key: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: inProcess(app),
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  const connected = new Client({ name: "tamiz-http-test", version: "0.0.0" });
  await connected.connect(transport);
  clients.push(connected);
  return connected;
}

function rawPost(app: McpHttpApp, headers: Record<string, string>): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          host: "127.0.0.1:3100",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
    ),
  );
}

describe("US4 streamable HTTP transport", () => {
  it("US4-2 forwards each request's bearer key to the gateway and stores none", async () => {
    const { app, fake, logs } = setup();
    const admin = await client(app, ADMIN_KEY);

    const { tools } = await admin.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "get_provider_health",
      "simulate_routing",
    ]);
    const health = await admin.callTool({ name: "get_provider_health", arguments: {} });
    expect(health.isError).not.toBe(true);
    expect(fake.requests.at(-1)?.authorization).toBe(`Bearer ${ADMIN_KEY}`);

    // A later caller with a wrong key does not inherit the admin key.
    const wrong = await client(app, "tamiz_test_wrong_1a2b3c");
    const denied = await wrong.callTool({ name: "get_provider_health", arguments: {} });
    expect(McpToolErrorSchema.parse(textJson(denied)).error.code).toBe("gateway_unauthorized");
    expect(fake.requests.at(-1)?.authorization).toBe("Bearer tamiz_test_wrong_1a2b3c");
    expectNoKey(ADMIN_KEY, tools, health, denied, logs);
  });

  it("US4-3 answers 401 without a bearer token, before any tool runs", async () => {
    const { app, fake } = setup();
    const response = await rawPost(app, {});

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(fake.requests).toEqual([]);
    expect((await rawPost(app, { authorization: "Basic abc" })).status).toBe(401);
  });

  it.each([[{ host: "evil.example" }], [{ origin: "https://evil.example" }]])(
    "US4-4 answers 403 to a foreign %j",
    async (headers) => {
      const { app, fake } = setup();
      const response = await rawPost(app, { authorization: `Bearer ${ADMIN_KEY}`, ...headers });

      expect(response.status).toBe(403);
      expect(fake.requests).toEqual([]);
    },
  );

  it("US4-5 keeps the keys of concurrent clients apart", async () => {
    const { app, fake } = setup();
    const [admin, user] = await Promise.all([client(app, ADMIN_KEY), client(app, CLIENT_KEY)]);

    await Promise.all(
      Array.from({ length: 5 }, (_, index) => [
        admin.callTool({ name: "get_provider_health", arguments: { windowMinutes: index + 1 } }),
        user.callTool({ name: "simulate_routing", arguments: { text: DNI_TEXT } }),
      ]).flat(),
    );

    const providers = fake.requests.filter((r) => r.path === "/v1/admin/providers");
    const simulations = fake.requests.filter((r) => r.path === "/v1/simulate");
    expect(providers).toHaveLength(5);
    expect(simulations).toHaveLength(5);
    for (const request of providers) {
      expect(request.authorization).toBe(`Bearer ${ADMIN_KEY}`);
    }
    for (const request of simulations) {
      expect(request.authorization).toBe(`Bearer ${CLIENT_KEY}`);
    }
  });

  it.each(["GET", "DELETE"])("answers 405 to %s in stateless mode", async (method) => {
    const { app } = setup();
    const response = await app.fetch(
      new Request(MCP_URL, {
        method,
        headers: { host: "127.0.0.1:3100", authorization: `Bearer ${ADMIN_KEY}` },
      }),
    );
    expect(response.status).toBe(405);
  });
});
