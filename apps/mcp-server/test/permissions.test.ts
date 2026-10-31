import { MCP_TOOL_NAMES } from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { ALL_TOOLS } from "../src/tools/registry.js";
import { ADMIN_KEY, createFakeGateway } from "./support/fake-gateway.js";
import { DNI_TEXT } from "./support/fixtures.js";
import { connect } from "./support/mcp-harness.js";
import { expectNoKey } from "./support/no-key.js";

// Spec 009 US2-1 … US2-5 (tasks.md T005).

/** A valid argument set per tool, for the tests that call every tool. */
const ARGUMENTS = {
  simulate_routing: { text: DNI_TEXT },
  query_audit_log: { entity: "DNI", limit: 10 },
  get_cost_report: { from: "2026-10-30T00:00:00Z", to: "2026-10-31T00:00:00Z" },
  get_provider_health: { windowMinutes: 30 },
} satisfies Record<string, Record<string, unknown>>;

describe("US2 permissions and the key", () => {
  it("US2-1 lists only the allowed tools; a disabled one is unknown and calls nothing", async () => {
    const session = await connect({ tools: ["simulate_routing", "get_provider_health"] });
    try {
      const { tools } = await session.client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(["simulate_routing", "get_provider_health"]);

      for (const name of ["query_audit_log", "get_cost_report"]) {
        await expect(session.client.callTool({ name, arguments: {} })).rejects.toThrow(/not found/);
      }
      expect(session.fake.requests).toEqual([]);
    } finally {
      await session.close();
    }
  });

  it("US2-2 refuses a configuration that names an unknown tool, and names it", () => {
    const config = loadConfig(
      { TAMIZ_MCP_GATEWAY_KEY: ADMIN_KEY, TAMIZ_MCP_TOOLS: "simulate_routing,nope" },
      [],
    );
    expect(config.ok).toBe(false);
    if (!config.ok) {
      expect(config.error).toContain("TAMIZ_MCP_TOOLS");
      expect(config.error).toContain('"nope"');
    }
  });

  it("US2-3 makes only read calls, and every tool is annotated read-only and idempotent", async () => {
    const session = await connect();
    try {
      const { tools } = await session.client.listTools();
      for (const tool of tools) {
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        });
        const before = session.fake.requests.length;
        const result = await session.client.callTool({
          name: tool.name,
          arguments: (ARGUMENTS as Record<string, Record<string, unknown>>)[tool.name] ?? {},
        });
        expect(result.isError).not.toBe(true);

        const made = session.fake.requests.slice(before);
        const declared = ALL_TOOLS.find((definition) => definition.name === tool.name)?.gatewayCall;
        expect(made.map((r) => ({ method: r.method, path: r.path }))).toEqual([declared]);
      }
      for (const request of session.fake.requests) {
        expect(`${request.method} ${request.path}`).toMatch(
          /^(GET \/v1\/admin\/[a-z]+|POST \/v1\/simulate)$/,
        );
      }
    } finally {
      await session.close();
    }
  });

  it("US2-4 keeps the key out of tool lists, inputs, results, errors and logs", async () => {
    const fake = createFakeGateway();
    const session = await connect({ fake });
    try {
      const seen: unknown[] = [await session.client.listTools()];
      for (const [name, args] of Object.entries(ARGUMENTS)) {
        seen.push(await session.client.callTool({ name, arguments: args }));
      }
      fake.fail({ kind: "status", status: 500 });
      seen.push(await session.client.callTool({ name: "get_provider_health", arguments: {} }));
      fake.fail({ kind: "body", body: { nope: true } });
      seen.push(
        await session.client.callTool({
          name: "simulate_routing",
          arguments: ARGUMENTS.simulate_routing,
        }),
      );
      seen.push(
        await session.client.callTool({ name: "simulate_routing", arguments: { text: "" } }),
      );

      expect(session.logs.length).toBeGreaterThan(0);
      expectNoKey(ADMIN_KEY, ...seen, ...session.logs);
      // The key did reach the gateway, as a bearer token and nowhere else.
      expect(fake.requests[0]?.authorization).toBe(`Bearer ${ADMIN_KEY}`);
    } finally {
      await session.close();
    }
  });

  it("US2-5 refuses to start on stdio without a key, and names the variable", () => {
    const stdio = loadConfig({}, []);
    expect(stdio.ok).toBe(false);
    if (!stdio.ok) expect(stdio.error).toContain("TAMIZ_MCP_GATEWAY_KEY");

    // HTTP holds no key: each request brings its own.
    expect(loadConfig({}, ["--transport", "http"]).ok).toBe(true);
  });
});

describe("registry", () => {
  it("implements every tool name of the contract, once", () => {
    expect(ALL_TOOLS.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
  });
});

describe("loadConfig", () => {
  it("applies the documented defaults", () => {
    const config = loadConfig({ TAMIZ_MCP_GATEWAY_KEY: ADMIN_KEY }, []);
    expect(config).toEqual({
      ok: true,
      value: {
        gatewayUrl: "http://localhost:3000",
        gatewayKey: ADMIN_KEY,
        tools: ["simulate_routing", "query_audit_log", "get_cost_report", "get_provider_health"],
        timeoutMs: 10_000,
        simulateModel: "auto",
        transport: "stdio",
        http: { host: "127.0.0.1", port: 3100 },
        logLevel: "info",
      },
    });
  });

  it("lets the --transport flag win over the variable", () => {
    const config = loadConfig({ TAMIZ_MCP_TRANSPORT: "stdio" }, ["--transport", "http"]);
    expect(config.ok && config.value.transport).toBe("http");
  });

  it.each([
    [{ TAMIZ_MCP_TIMEOUT_MS: "50" }, "TAMIZ_MCP_TIMEOUT_MS"],
    [{ TAMIZ_MCP_GATEWAY_URL: "not a url" }, "TAMIZ_MCP_GATEWAY_URL"],
    [{ TAMIZ_MCP_HTTP_PORT: "70000" }, "TAMIZ_MCP_HTTP_PORT"],
    [{ TAMIZ_MCP_TOOLS: "" }, "TAMIZ_MCP_TOOLS"],
    [{ TAMIZ_MCP_TRANSPORT: "sse" }, "TAMIZ_MCP_TRANSPORT"],
    [{ TAMIZ_MCP_HTTP_HOST: "0.0.0.0" }, "TAMIZ_MCP_ALLOWED_HOSTS"],
  ])("rejects %j naming %s", (env, variable) => {
    const config = loadConfig({ TAMIZ_MCP_GATEWAY_KEY: ADMIN_KEY, ...env }, []);
    expect(config.ok).toBe(false);
    if (!config.ok) expect(config.error).toContain(variable);
  });

  it("accepts a non-local bind with allowed hosts", () => {
    const config = loadConfig(
      { TAMIZ_MCP_HTTP_HOST: "0.0.0.0", TAMIZ_MCP_ALLOWED_HOSTS: "mcp.internal, tamiz.lan" },
      ["--transport", "http"],
    );
    expect(config.ok && config.value.http).toEqual({
      host: "0.0.0.0",
      port: 3100,
      allowedHosts: ["mcp.internal", "tamiz.lan"],
    });
  });
});
