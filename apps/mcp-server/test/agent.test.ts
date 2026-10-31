import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import {
  ChatCompletionRequestSchema,
  type CostQueryDto,
  type CostReportDto,
  CostReportSchema,
  MCP_TOOL_NAMES,
} from "@tamiz/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createGatewayModel } from "../src/agent/gateway-model.js";
import { MAX_STEPS, runAgent } from "../src/agent/run-agent.js";
import { createGatewayClient } from "../src/gateway-client.js";
import { createMcpServer } from "../src/server.js";
import { selectTools } from "../src/tools/registry.js";
import {
  ADMIN_KEY,
  CLIENT_KEY,
  createFakeGateway,
  type FakeGateway,
  type FakeGatewayOptions,
} from "./support/fake-gateway.js";
import { captureLogs, GATEWAY_URL } from "./support/mcp-harness.js";

// Spec 009 US5-1 … US5-5 (tasks.md T023): the agent against the in-process MCP server, with
// the fake gateway serving both the admin data and the scripted model replies.

const NOW = new Date("2026-10-31T09:00:00Z");
const DAY_BEFORE = "2026-10-29T00:00:00Z";
const YESTERDAY = "2026-10-30T00:00:00Z";
const TODAY = "2026-10-31T00:00:00Z";
const QUESTION = "why did spend rise yesterday?";

function row(key: string, requests: number, costUsd: number) {
  return {
    key,
    requests,
    inputTokens: requests * 400,
    outputTokens: requests * 100,
    costUsd,
    baselineCostUsd: costUsd * 3,
  };
}

/** Yesterday's spend is twice the day before's, because `anthropic-sonnet` grew. */
function spendScenario(query: CostQueryDto): CostReportDto {
  const byDay: Record<string, ReturnType<typeof row>[]> = {
    [DAY_BEFORE]: [
      row("ollama-llama", 300, 0),
      row("anthropic-sonnet", 20, 0.31),
      row("mistral-small", 40, 0.11),
    ],
    [YESTERDAY]: [
      row("ollama-llama", 310, 0),
      row("anthropic-sonnet", 48, 0.73),
      row("mistral-small", 41, 0.11),
    ],
  };
  const rows =
    query.groupBy === "day"
      ? [row("2026-10-29", 360, 0.42), row("2026-10-30", 399, 0.84)]
      : (byDay[query.from] ?? []);
  const total = rows.reduce((sum, r) => sum + r.costUsd, 0);
  return CostReportSchema.parse({
    from: query.from,
    to: query.to,
    groupBy: query.groupBy,
    baseline: { targetId: "anthropic-sonnet", inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    rows,
    notServed: { requests: 0, blocked: 0, failed: 0 },
    totals: {
      ...row(
        "total",
        rows.reduce((sum, r) => sum + r.requests, 0),
        total,
      ),
      key: "total",
    },
  });
}

function call(tool: string, args: Record<string, unknown>): string {
  return JSON.stringify({ tool, arguments: args });
}

const ANSWER =
  "Spend rose from $0.42 on 2026-10-29 to $0.84 on 2026-10-30. Almost all of the increase is " +
  "route anthropic-sonnet: $0.31 → $0.73.";

const SPEND_SCRIPT = [
  call("get_cost_report", { from: DAY_BEFORE, to: TODAY, groupBy: "day" }),
  `Yesterday doubled. Now by route:\n\`\`\`json\n${call("get_cost_report", { from: YESTERDAY, to: TODAY, groupBy: "route" })}\n\`\`\``,
  call("get_cost_report", { from: DAY_BEFORE, to: YESTERDAY, groupBy: "route" }),
  JSON.stringify({ answer: ANSWER }),
];

interface Harness {
  fake: FakeGateway;
  mcp: MCPClient;
  /** Every URL the agent's model and the server fetched. */
  fetched: string[];
  /** The only `fetch` either side may use: it refuses any host but the fake gateway. */
  spy: typeof fetch;
}

const open: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((close) => close()));
});

async function setup(options: FakeGatewayOptions = {}): Promise<Harness> {
  const fake = createFakeGateway(options);
  const fetched: string[] = [];
  const spy: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    fetched.push(url);
    if (!url.startsWith(`${GATEWAY_URL}/`)) throw new Error(`unexpected host: ${url}`);
    return fake.fetch(input, init);
  };
  const server = createMcpServer({
    tools: selectTools(MCP_TOOL_NAMES),
    context: {
      gateway: createGatewayClient({
        baseUrl: GATEWAY_URL,
        key: ADMIN_KEY,
        timeoutMs: 2_000,
        fetch: spy,
      }),
      simulateModel: "auto",
    },
    logger: captureLogs().logger,
  });
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  await server.connect(serverEnd);
  const mcp = await createMCPClient({ transport: clientEnd });
  open.push(async () => {
    await mcp.close();
    await server.close();
  });
  return { fake, mcp, fetched, spy };
}

function model(harness: Harness) {
  return createGatewayModel({
    gatewayUrl: GATEWAY_URL,
    apiKey: CLIENT_KEY,
    model: "tamiz-local",
    fetch: harness.spy,
  });
}

function chatRequests(fake: FakeGateway) {
  return fake.requests.filter((r) => r.path === "/v1/chat/completions");
}

/** The messages the model received on its n-th call (1-based). */
function messagesOf(fake: FakeGateway, n: number): { role: string; content: string }[] {
  return ChatCompletionRequestSchema.parse(chatRequests(fake)[n - 1]?.body).messages.map(
    (message) => ({ role: message.role, content: message.content ?? "" }),
  );
}

describe("US5 the agent answers through Tamiz", () => {
  it("US5-1 compares daily and per-route cost and names the route and both amounts", async () => {
    const harness = await setup({ cost: spendScenario });
    harness.fake.script(SPEND_SCRIPT);

    const run = await runAgent({
      protocol: "text",
      question: QUESTION,
      model: model(harness),
      mcp: harness.mcp,
      now: () => NOW,
    });

    expect(run.stopReason).toBe("answered");
    const costCalls = harness.fake.requests.filter((r) => r.path === "/v1/admin/cost");
    expect(costCalls.map((r) => r.query)).toEqual([
      { from: DAY_BEFORE, to: TODAY, groupBy: "day" },
      { from: YESTERDAY, to: TODAY, groupBy: "route" },
      { from: DAY_BEFORE, to: YESTERDAY, groupBy: "route" },
    ]);
    expect(run.answer).toContain("anthropic-sonnet");
    expect(run.answer).toContain("0.31");
    expect(run.answer).toContain("0.73");
    // The amounts reached the model as tool results, not from the script alone.
    const lastPrompt = messagesOf(harness.fake, 4);
    const observations = lastPrompt.filter(
      (m) => m.role === "user" && m.content.startsWith("Observation"),
    );
    expect(observations).toHaveLength(3);
    expect(observations[1]?.content).toMatch(/^Observation \(get_cost_report\): \{/);
    expect(observations[1]?.content).toContain('"costUsd":0.73');
    expect(observations[2]?.content).toContain('"costUsd":0.31');
    expect(lastPrompt.filter((m) => m.role === "assistant").map((m) => m.content)).toEqual(
      SPEND_SCRIPT.slice(0, 3),
    );
  });

  it("US5-2 makes every model call to the gateway with the client key, tamiz-local and a valid body", async () => {
    const harness = await setup({ cost: spendScenario });
    harness.fake.script(SPEND_SCRIPT);
    await runAgent({
      protocol: "text",
      question: QUESTION,
      model: model(harness),
      mcp: harness.mcp,
      now: () => NOW,
    });

    const chats = chatRequests(harness.fake);
    expect(chats).toHaveLength(4);
    for (const request of chats) {
      expect(request.method).toBe("POST");
      expect(request.authorization).toBe(`Bearer ${CLIENT_KEY}`);
      const body = ChatCompletionRequestSchema.parse(request.body);
      expect(body.model).toBe("tamiz-local");
      expect(body.temperature).toBe(0);
    }
    expect(harness.fetched.every((url) => url.startsWith(`${GATEWAY_URL}/v1/`))).toBe(true);
    // The admin key stays with the MCP server; the model calls never carry it.
    expect(chats.some((r) => JSON.stringify(r).includes(ADMIN_KEY))).toBe(false);
  });

  it("US5-3 sends bad tools, bad arguments and bad formats back as observations, then stops at 6 calls", async () => {
    const harness = await setup();
    harness.fake.script([
      call("delete_everything", {}),
      call("get_cost_report", { from: DAY_BEFORE, to: TODAY, groupBy: "week" }),
      "Spend probably rose because of the frontier route.",
      "Still thinking.",
      "[]",
      '{"answer": ""}',
    ]);

    const run = await runAgent({
      protocol: "text",
      question: QUESTION,
      model: model(harness),
      mcp: harness.mcp,
      now: () => NOW,
    });

    expect(run.stopReason).toBe("step_limit");
    expect(run.answer).toBe("I could not answer within 6 steps");
    expect(chatRequests(harness.fake)).toHaveLength(6);
    const last = (n: number) => messagesOf(harness.fake, n).at(-1)?.content;
    expect(last(2)).toBe(
      'Observation error: unknown tool "delete_everything"; available: simulate_routing, query_audit_log, get_cost_report, get_provider_health',
    );
    expect(last(3)).toMatch(/^Observation \(get_cost_report\) error: Input validation error/);
    const formatError =
      'Observation error: answer with exactly one JSON object, {"tool": …, "arguments": …} or {"answer": …}';
    expect(last(4)).toBe(formatError);
    expect(last(6)).toBe(formatError);
    expect(harness.fake.requests.filter((r) => r.path.startsWith("/v1/admin/"))).toEqual([]);
    expect(run.steps.map((step) => step.kind)).toEqual([
      "observation_error",
      "tool",
      "observation_error",
      "observation_error",
      "observation_error",
      "observation_error",
    ]);
    expect(run.steps[1]).toMatchObject({
      kind: "tool",
      tool: "get_cost_report",
      ok: false,
      errorCode: "invalid_arguments",
    });
  });

  it("US5-3 cuts long observations and says how much was omitted", async () => {
    const harness = await setup({ cost: spendScenario });
    harness.fake.script([
      call("get_cost_report", { from: DAY_BEFORE, to: TODAY }),
      JSON.stringify({ answer: "ok" }),
    ]);
    await runAgent({
      protocol: "text",
      question: QUESTION,
      model: model(harness),
      mcp: harness.mcp,
      now: () => NOW,
      observationLimit: 100,
    });
    const observation = messagesOf(harness.fake, 2).at(-1)?.content ?? "";
    expect(observation).toMatch(/… \(truncated, \d+ characters omitted\)$/);
    // The prefix, the 100 kept characters and the note.
    expect(observation.length).toBeLessThan(200);
  });

  it.each([
    [{ status: 451, type: "policy_blocked" }],
    [{ status: 502, type: "provider_error" }],
  ] as const)("US5-4 stops on a gateway error %j with its type and request id", async (failure) => {
    const harness = await setup({ cost: spendScenario });
    harness.fake.script([
      call("get_cost_report", { from: DAY_BEFORE, to: TODAY }),
      failure,
      JSON.stringify({ answer: "never" }),
    ]);

    const run = await runAgent({
      protocol: "text",
      question: QUESTION,
      model: model(harness),
      mcp: harness.mcp,
      now: () => NOW,
    });

    expect(run.stopReason).toBe("gateway_error");
    expect(run.gatewayError).toEqual({ type: failure.type, requestId: "req-2" });
    expect(run.answer).toBeUndefined();
    expect(chatRequests(harness.fake)).toHaveLength(2);
    expect(run.requestIds).toEqual(["req-1", "req-2"]);
  });

  it("US5-5 records the prompt version, the UTC date, the steps and the request ids", async () => {
    const harness = await setup({ cost: spendScenario });
    harness.fake.script(SPEND_SCRIPT);

    const run = await runAgent({
      protocol: "text",
      question: QUESTION,
      model: model(harness),
      mcp: harness.mcp,
      now: () => NOW,
    });

    expect(run).toEqual({
      question: QUESTION,
      protocol: "text",
      promptVersion: "system.v1",
      model: "tamiz-local",
      today: "2026-10-31",
      steps: [
        {
          kind: "tool",
          tool: "get_cost_report",
          arguments: { from: DAY_BEFORE, to: TODAY, groupBy: "day" },
          requestId: "req-1",
          ok: true,
        },
        {
          kind: "tool",
          tool: "get_cost_report",
          arguments: { from: YESTERDAY, to: TODAY, groupBy: "route" },
          requestId: "req-2",
          ok: true,
        },
        {
          kind: "tool",
          tool: "get_cost_report",
          arguments: { from: DAY_BEFORE, to: YESTERDAY, groupBy: "route" },
          requestId: "req-3",
          ok: true,
        },
        { kind: "answer", requestId: "req-4" },
      ],
      requestIds: harness.fake.chatRequestIds,
      stopReason: "answered",
      answer: ANSWER,
    });
    expect(run.requestIds).toEqual(["req-1", "req-2", "req-3", "req-4"]);

    const [system, user] = messagesOf(harness.fake, 1);
    expect(system?.role).toBe("system");
    expect(system?.content).toContain("2026-10-31");
    expect(system?.content).not.toContain("{{");
    for (const name of MCP_TOOL_NAMES) expect(system?.content).toContain(`- ${name}: `);
    expect(user).toEqual({ role: "user", content: QUESTION });
  });
});

// 009 tool-calling US8-1 … US8-3 (tasks.md T028): native tool calls through the gateway.
describe("US8 the agent with native tools", () => {
  const costCall = (from: string, to: string, groupBy: "day" | "route") => ({
    name: "get_cost_report",
    arguments: { from, to, groupBy },
  });

  it("US8-1 declares the MCP tools, sends results as tool messages, and answers", async () => {
    const harness = await setup({ cost: spendScenario });
    harness.fake.script([
      { toolCalls: [costCall(DAY_BEFORE, TODAY, "day")] },
      { toolCalls: [costCall(YESTERDAY, TODAY, "route")] },
      { toolCalls: [costCall(DAY_BEFORE, YESTERDAY, "route")] },
      ANSWER,
    ]);

    const run = await runAgent({
      question: QUESTION,
      model: model(harness),
      mcp: harness.mcp,
      now: () => NOW,
    });

    expect(run).toMatchObject({
      protocol: "native",
      promptVersion: "system.v2",
      stopReason: "answered",
      answer: ANSWER,
      requestIds: ["req-1", "req-2", "req-3", "req-4"],
    });
    expect(run.steps.map((s) => s.kind)).toEqual(["tool", "tool", "tool", "answer"]);
    expect(run.steps[0]).toMatchObject({
      tool: "get_cost_report",
      ok: true,
      callId: "call_req-1_1",
    });
    const chats = chatRequests(harness.fake).map((r) => ChatCompletionRequestSchema.parse(r.body));
    for (const body of chats) {
      expect(body.tools?.map((t) => t.function.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
      expect(body.messages.every((m) => !m.content?.includes("input JSON Schema"))).toBe(true);
    }
    const last = chats[3]?.messages ?? [];
    const results = last.filter((m) => m.role === "tool");
    expect(results.map((m) => m.tool_call_id)).toEqual([
      "call_req-1_1",
      "call_req-2_1",
      "call_req-3_1",
    ]);
    expect(results[1]?.content).toContain('"costUsd":0.73');
    expect(
      last.filter((m) => m.role === "assistant").every((m) => m.tool_calls?.length === 1),
    ).toBe(true);
  });

  it("US8-2 runs two calls of one answer in order, both results before the next model call", async () => {
    const harness = await setup({ cost: spendScenario });
    harness.fake.script([
      {
        toolCalls: [costCall(YESTERDAY, TODAY, "route"), costCall(DAY_BEFORE, YESTERDAY, "route")],
      },
      ANSWER,
    ]);

    const run = await runAgent({
      question: QUESTION,
      model: model(harness),
      mcp: harness.mcp,
      now: () => NOW,
    });

    expect(run.stopReason).toBe("answered");
    const costCalls = harness.fake.requests.filter((r) => r.path === "/v1/admin/cost");
    expect(costCalls.map((r) => r.query["from"])).toEqual([YESTERDAY, DAY_BEFORE]);
    const second = ChatCompletionRequestSchema.parse(chatRequests(harness.fake)[1]?.body);
    expect(second.messages.filter((m) => m.role === "tool")).toHaveLength(2);
    expect(run.requestIds).toHaveLength(2);
  });

  it("US8-2 an unknown tool goes back as an error result, and the step limit counts model calls", async () => {
    const harness = await setup();
    harness.fake.script(
      Array.from({ length: 7 }, () => ({
        toolCalls: [{ name: "delete_everything", arguments: {} }],
      })),
    );

    const run = await runAgent({
      question: QUESTION,
      model: model(harness),
      mcp: harness.mcp,
      now: () => NOW,
    });

    expect(run.stopReason).toBe("step_limit");
    expect(run.requestIds).toHaveLength(MAX_STEPS);
    expect(run.steps.every((s) => s.kind === "observation_error")).toBe(true);
    const sixth = ChatCompletionRequestSchema.parse(chatRequests(harness.fake)[5]?.body);
    expect(sixth.messages.filter((m) => m.role === "tool")[0]?.content).toContain(
      "unavailable tool",
    );
  });
});
