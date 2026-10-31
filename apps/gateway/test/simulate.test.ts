import { SimulateResponseSchema } from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import type { RoutingEvent } from "../src/application/ports/routing-events.port.js";
import type { Inspection } from "../src/domain/model/sensitivity.js";
import { AUTH, createTestApp, defaultPolicy } from "./helpers/app.js";
import { inspectAs } from "./helpers/privacy.js";

// Spec 005 US5-1 … US5-4, FR-018, FR-019 (tasks.md T045, T046). Every provider call fails
// the test: a simulation never reaches one.

const DNI_TEXT = "Mi DNI es 12345678Z.";
const NAMES_TEXT = "Resume el informe de Lucía Fernández Ruiz (lucia@example.com).";

const CRITICAL: Inspection = {
  status: "ok",
  level: "critical",
  entities: [{ textIndex: 0, kind: "DNI", start: 10, end: 19, score: 1 }],
};
const HIGH: Inspection = {
  status: "ok",
  level: "high",
  entities: [
    { textIndex: 0, kind: "PERSON", start: 21, end: 41, score: 0.85 },
    { textIndex: 0, kind: "EMAIL", start: 43, end: 60, score: 1 },
  ],
};

const noProvider = () => {
  throw new Error("a simulation must never call a provider");
};

function post(content: string, auth: Record<string, string> = AUTH) {
  return {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ model: "tamiz-auto", messages: [{ role: "user", content }] }),
  };
}

async function simulate(inspection: Inspection, text: string, options = {}) {
  const events: RoutingEvent[] = [];
  const { send } = await createTestApp({
    inspect: inspectAs(inspection),
    script: noProvider,
    streamScript: noProvider,
    events: { emit: (event) => void events.push(event) },
    ...options,
  });
  const response = await send("/v1/simulate", post(text));
  return { response, json: (await response.json()) as Record<string, unknown>, events };
}

describe("POST /v1/simulate", () => {
  it("US5-1: a DNI → critical, restrict_to_local, local chain, no provider call", async () => {
    const { response, json } = await simulate(CRITICAL, DNI_TEXT);

    expect(response.status).toBe(200);
    expect(SimulateResponseSchema.safeParse(json).success).toBe(true);
    expect(json).toMatchObject({
      sensitivity: "critical",
      detector: "ok",
      entities: [
        {
          messageIndex: 0,
          location: { kind: "content", messageIndex: 0 },
          kind: "DNI",
          start: 10,
          end: 19,
          score: 1,
        },
      ],
      decision: "route",
      privacyAction: "restrict_to_local",
      chain: [{ id: "ollama-llama", provider: "ollama", residency: "local" }],
      allowedResidencies: ["local"],
    });
    expect(DNI_TEXT.slice(10, 19)).toBe("12345678Z");
  });

  it("spec 007 FR-010: the classification the rule matched on is part of the answer", async () => {
    const { json } = await simulate(HIGH, NAMES_TEXT);
    expect(json).toMatchObject({
      taskType: "summarize",
      size: "short",
      ruleId: "cheap-short-tasks",
    });
  });

  it("US5-2: `anonymize` shows exactly what the provider would receive", async () => {
    const { json } = await simulate(HIGH, NAMES_TEXT);

    expect(json).toMatchObject({ privacyAction: "anonymize", notice: "v1" });
    expect(json["providerMessages"]).toEqual([
      { role: "system", content: "Keep every <KIND_n> placeholder exactly as written." },
      { role: "user", content: "Resume el informe de <PERSON_1> (<EMAIL_1>)." },
    ]);
    expect(
      (json["chain"] as Array<{ residency: string }>).every((t) =>
        ["local", "eu"].includes(t.residency),
      ),
    ).toBe(true);
  });

  it("US5-3: the answer has no values, and no attempt or fallback is recorded", async () => {
    const { json, events } = await simulate(CRITICAL, DNI_TEXT);

    expect(JSON.stringify(json)).not.toContain("12345678Z");
    expect(events.map((e) => e.type).filter((t) => !t.startsWith("privacy."))).toEqual([]);
  });

  it("a blocking policy is shown as a block with its reason and an empty chain", async () => {
    const base = await defaultPolicy();
    const policy = {
      ...base,
      privacy: {
        ...base.privacy,
        levels: { ...base.privacy.levels, critical: { action: "block" as const } },
      },
    };
    const { json } = await simulate(CRITICAL, DNI_TEXT, { policy });

    expect(json).toMatchObject({
      decision: "block",
      privacyAction: "block",
      blockReason: "action",
      chain: [],
    });
  });

  it("a failed inspection is reported in `detector` and `sensitivity`, not as an error", async () => {
    const { response, json } = await simulate({ status: "failed", reason: "timeout" }, "Hola");

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ detector: "timeout", sensitivity: "unknown", entities: [] });
  });

  it("US5-4: without a valid API key the simulation is refused", async () => {
    const { send } = await createTestApp({ script: noProvider });

    const response = await send("/v1/simulate", post("Hola", {}));

    expect(response.status).toBe(401);
  });

  it("an invalid body is a 400", async () => {
    const { send } = await createTestApp({ script: noProvider });

    const response = await send("/v1/simulate", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ model: "x", messages: [] }),
    });

    expect(response.status).toBe(400);
  });

  it("FR-019: /openapi.json documents /v1/simulate and the SimulateResponse component", async () => {
    const { send } = await createTestApp();

    const doc = (await (await send("/openapi.json")).json()) as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };

    expect(doc.paths["/v1/simulate"]).toBeDefined();
    expect(doc.components.schemas["SimulateResponse"]).toBeDefined();
  });
});

// 009 tool-calling FR-015, US2-1, US3-1, US3-6 (tasks.md T024): tool-calling requests in
// the simulator, with each entity's location and the messages a provider would receive.
describe("POST /v1/simulate with tools", () => {
  const ARGS = '{"name":"Ana Ruiz Gil"}';
  const body = (result: string, args = ARGS) => ({
    model: "tamiz-auto",
    messages: [
      { role: "user", content: "Recuérdaselo." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "send_reminder", arguments: args } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: result },
    ],
    tools: [{ type: "function", function: { name: "send_reminder", description: "Send" } }],
  });
  const run = async (inspection: Inspection, payload: unknown) => {
    const { send } = await createTestApp({
      inspect: inspectAs(inspection),
      script: noProvider,
      streamScript: noProvider,
    });
    const response = await send("/v1/simulate", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await response.json()) as Record<string, unknown>;
    expect(SimulateResponseSchema.safeParse(json).success).toBe(true);
    return json;
  };

  it("a DNI in a tool result: located in that message, critical, local chain", async () => {
    // Inspected texts: 0 user, 1 arguments, 2 tool result, 3 tool definition.
    const json = await run(
      {
        status: "ok",
        level: "critical",
        entities: [{ textIndex: 2, kind: "DNI", start: 4, end: 13, score: 1 }],
      },
      body("DNI 12345678Z"),
    );
    expect(json).toMatchObject({
      entities: [{ messageIndex: 2, location: { kind: "content", messageIndex: 2 }, kind: "DNI" }],
      sensitivity: "critical",
      privacyAction: "restrict_to_local",
      chain: [{ id: "ollama-llama" }],
    });
  });

  it("a name in arguments and a result: providerMessages hold placeholders in both", async () => {
    const json = await run(
      {
        status: "ok",
        level: "high",
        entities: [
          { textIndex: 1, kind: "PERSON", start: 9, end: 21, score: 0.9 },
          { textIndex: 2, kind: "PERSON", start: 0, end: 12, score: 0.9 },
        ],
      },
      body("Ana Ruiz Gil confirmada"),
    );
    expect(json["entities"]).toMatchObject([
      { messageIndex: 1, location: { kind: "arguments", messageIndex: 1, toolCallIndex: 0 } },
      { messageIndex: 2, location: { kind: "content", messageIndex: 2 } },
    ]);
    expect(json["notice"]).toBe("v2");
    const messages = json["providerMessages"] as Array<Record<string, unknown>>;
    expect(messages.slice(2)).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "send_reminder", arguments: '{"name":"<PERSON_1>"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "<PERSON_1> confirmada" },
    ]);
    expect(JSON.stringify(json)).not.toContain("Ana Ruiz Gil");
  });

  it("a name in a tool definition: located there, kept local, notAnonymizable", async () => {
    const json = await run(
      {
        status: "ok",
        level: "high",
        entities: [{ textIndex: 3, kind: "PERSON", start: 0, end: 4, score: 0.9 }],
      },
      body("ok"),
    );
    expect(json).toMatchObject({
      entities: [{ location: { kind: "tool_definition", toolIndex: 0 }, kind: "PERSON" }],
      privacyAction: "restrict_to_local",
      notAnonymizable: "tool_definition",
    });
    expect((json["entities"] as unknown[])[0]).not.toHaveProperty("messageIndex");
  });
});
