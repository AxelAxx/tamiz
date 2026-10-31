import { ProvidersReportSchema, SimulateResponseSchema } from "@tamiz/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { DNI_TEXT, SIMULATE_DNI } from "./support/fixtures.js";
import { connect, type Session, SIMULATE_MODEL, textJson } from "./support/mcp-harness.js";

// Spec 009 US1-1 … US1-5 (tasks.md T003).

let session: Session | undefined;

afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe("US1 simulate_routing and get_provider_health", () => {
  it("US1-1 lists the four tools with a description, input and output schemas, read-only", async () => {
    session = await connect();
    const { tools } = await session.client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "get_cost_report",
      "get_provider_health",
      "query_audit_log",
      "simulate_routing",
    ]);
    for (const tool of tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(20);
      expect(tool.title?.length ?? 0).toBeGreaterThan(0);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.outputSchema).toMatchObject({ type: "object" });
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("US1-2 simulates a text with a DNI and returns the contract-valid simulation", async () => {
    session = await connect();
    const result = await session.client.callTool({
      name: "simulate_routing",
      arguments: { text: DNI_TEXT },
    });

    expect(result.isError).not.toBe(true);
    const simulation = SimulateResponseSchema.parse(result.structuredContent);
    expect(simulation).toEqual(SIMULATE_DNI);
    expect(simulation.entities.map((entity) => entity.kind)).toEqual(["DNI"]);
    expect(textJson(result)).toEqual(result.structuredContent);
  });

  it("US1-3 sends a text as one user message, or the given messages, with the model", async () => {
    session = await connect();
    await session.client.callTool({ name: "simulate_routing", arguments: { text: DNI_TEXT } });
    const messages = [
      { role: "system", content: "Eres un asistente." },
      { role: "user", content: "Hola" },
    ];
    await session.client.callTool({
      name: "simulate_routing",
      arguments: { messages, model: "tamiz-local" },
    });

    const bodies = session.fake.requests.map((request) => request.body);
    expect(bodies).toEqual([
      { model: SIMULATE_MODEL, messages: [{ role: "user", content: DNI_TEXT }] },
      { model: "tamiz-local", messages },
    ]);
    expect(session.fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /v1/simulate",
      "POST /v1/simulate",
    ]);
  });

  it("US1-4 reports provider health with a 15-minute default window", async () => {
    session = await connect();
    const byDefault = await session.client.callTool({
      name: "get_provider_health",
      arguments: {},
    });
    const hourly = await session.client.callTool({
      name: "get_provider_health",
      arguments: { windowMinutes: 60 },
    });

    expect(session.fake.requests.map((request) => request.query)).toEqual([
      { windowMinutes: "15" },
      { windowMinutes: "60" },
    ]);
    const report = ProvidersReportSchema.parse(byDefault.structuredContent);
    expect(report.windowMinutes).toBe(15);
    expect(report.targets.map((target) => target.targetId)).toEqual([
      "ollama-llama",
      "mistral-small",
    ]);
    expect(ProvidersReportSchema.parse(hourly.structuredContent).windowMinutes).toBe(60);
  });

  it.each([
    ["simulate_routing", { text: "" }],
    ["simulate_routing", { text: "x", messages: [{ role: "user", content: "x" }] }],
    ["simulate_routing", {}],
    ["get_provider_health", { windowMinutes: 0 }],
    ["get_provider_health", { windowMinutes: "15" }],
  ])("US1-5 rejects %s %j as invalid input without calling the gateway", async (name, args) => {
    session = await connect();
    const result = await session.client.callTool({ name, arguments: args });

    // SDK 2.4.0 answers an input that fails the schema with an `isError` result.
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result.content)).toContain("Input validation error");
    expect(session.fake.requests).toEqual([]);
  });
});
