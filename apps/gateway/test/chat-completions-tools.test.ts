/**
 * Tool calling through `POST /v1/chat/completions`, not streamed (009 tool-calling US1,
 * US2, US3, US5, US6-1, tasks.md T012, T013, T014, T019, T020, T021): the contract fields
 * reach the provider port, the privacy step covers tool arguments, tool results and tool
 * definitions, anonymized values come back restored inside tool calls, and every attempt
 * of a chain gets the same tools.
 */
import { type ChatCompletionResponse, ChatCompletionResponseSchema } from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import type { ProviderCompletionInput } from "../src/application/ports/llm-provider.port.js";
import type { RoutingEvent } from "../src/application/ports/routing-events.port.js";
import type {
  DetectedEntity,
  EntityKind,
  Inspection,
  SensitivityLevel,
} from "../src/domain/model/sensitivity.js";
import { err, ok } from "../src/domain/result.js";
import { AUTH, type CompletionResult, createTestApp } from "./helpers/app.js";
import { inspectAs } from "./helpers/privacy.js";
import { failure, target } from "./resilience/helpers.js";

const NAME = "Ana Ruiz Gil";
const DNI = "12345678Z";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_patient",
      description: "Look up a patient by id",
      parameters: { type: "object", properties: { patientId: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "send_reminder",
      description: "Send a reminder",
      parameters: { type: "object", properties: { name: { type: "string" } } },
    },
  },
];

/** A follow-up after `get_patient` answered with `result`. */
function followUp(result: string, extra: Record<string, unknown> = {}) {
  return {
    model: "tamiz-auto",
    messages: [
      { role: "user", content: "Recuerda su cita al paciente 4411." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_a1",
            type: "function",
            function: { name: "get_patient", arguments: '{"patientId":"4411"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_a1", content: result },
    ],
    tools: TOOLS,
    tool_choice: "auto",
    ...extra,
  };
}

function post(body: unknown) {
  return {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** A detector that finds each value wherever it appears in the inspected texts. */
function finding(level: SensitivityLevel, values: ReadonlyArray<readonly [EntityKind, string]>) {
  return inspectAs((texts): Inspection => {
    const entities: DetectedEntity[] = [];
    texts.forEach((text, textIndex) => {
      for (const [kind, value] of values) {
        let start = text.indexOf(value);
        while (start >= 0) {
          entities.push({ textIndex, kind, start, end: start + value.length, score: 0.9 });
          start = text.indexOf(value, start + value.length);
        }
      }
    });
    return entities.length === 0
      ? { status: "ok", level: "none", entities: [] }
      : { status: "ok", level, entities };
  });
}

const callingReminder =
  (args: string) =>
  (input: ProviderCompletionInput): CompletionResult =>
    ok({
      text: "",
      toolCalls: [{ id: "call_b7", name: "send_reminder", arguments: args }],
      finishReason: "tool_calls",
      usage: { promptTokens: 40, completionTokens: 9 },
      modelName: input.target.model,
    });

const textAnswer = (input: ProviderCompletionInput): CompletionResult =>
  ok({
    text: "La cita es el 4 de noviembre.",
    finishReason: "stop",
    usage: { promptTokens: 40, completionTokens: 9 },
    modelName: input.target.model,
  });

describe("standard tool calling (US1)", () => {
  it("US1-1: a tool call answer has content null, tool_calls and finish_reason tool_calls", async () => {
    const { send } = await createTestApp({ script: callingReminder('{"name":"x"}') });

    const response = await send(
      "/v1/chat/completions",
      post({
        model: "tamiz-auto",
        messages: [{ role: "user", content: "Recuérdaselo." }],
        tools: TOOLS,
      }),
    );
    const json = (await response.json()) as ChatCompletionResponse;

    expect(response.status).toBe(200);
    expect(ChatCompletionResponseSchema.safeParse(json).success).toBe(true);
    expect(json.choices[0]).toEqual({
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_b7",
            type: "function",
            function: { name: "send_reminder", arguments: '{"name":"x"}' },
          },
        ],
      },
      finish_reason: "tool_calls",
    });
  });

  it("US1-2: the follow-up reaches the provider with the call and its result linked", async () => {
    const { send, provider } = await createTestApp({ script: textAnswer });

    const response = await send("/v1/chat/completions", post(followUp('{"next":"2026-11-04"}')));

    expect(response.status).toBe(200);
    expect(((await response.json()) as ChatCompletionResponse).choices[0]?.message.content).toBe(
      "La cita es el 4 de noviembre.",
    );
    const sent = provider.calls[0];
    expect(sent?.messages.slice(1)).toEqual([
      {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "call_a1", name: "get_patient", arguments: '{"patientId":"4411"}' }],
      },
      {
        role: "tool",
        toolCallId: "call_a1",
        toolName: "get_patient",
        content: '{"next":"2026-11-04"}',
      },
    ]);
    expect(sent?.tools?.map((tool) => tool.name)).toEqual(["get_patient", "send_reminder"]);
  });

  it.each([
    ["none", "none"],
    ["required", "required"],
    [{ type: "function", function: { name: "send_reminder" } }, { name: "send_reminder" }],
  ] as const)("US1-3: tool_choice %j reaches the provider", async (dto, domain) => {
    const { send, provider } = await createTestApp({ script: textAnswer });

    await send("/v1/chat/completions", post(followUp("{}", { tool_choice: dto })));

    expect(provider.calls[0]?.toolChoice).toEqual(domain);
  });

  it("US1-4: a request without tool fields reaches the provider without any", async () => {
    const { send, provider } = await createTestApp();

    const response = await send(
      "/v1/chat/completions",
      post({ model: "tamiz-auto", messages: [{ role: "user", content: "Hola" }] }),
    );
    const json = (await response.json()) as ChatCompletionResponse;

    expect(json.choices[0]?.message).toEqual({ role: "assistant", content: "Hola." });
    expect(json.choices[0]?.finish_reason).toBe("stop");
    expect(provider.calls[0]).not.toHaveProperty("tools");
    expect(provider.calls[0]).not.toHaveProperty("toolChoice");
  });

  it("rejects a tool message without its call, with a 400 that names the field", async () => {
    const { send, provider } = await createTestApp();
    const body = followUp("{}");
    body.messages.splice(1, 1);

    const response = await send("/v1/chat/completions", post(body));

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("tool_call_id");
    expect(provider.calls).toHaveLength(0);
  });
});

describe("personal data in tool messages is routed (US2)", () => {
  it("US2-1: a DNI only in a tool result keeps the request on the local model", async () => {
    const { send, provider } = await createTestApp({
      inspect: finding("critical", [["DNI", DNI]]),
      script: textAnswer,
    });

    const response = await send(
      "/v1/chat/completions",
      post(followUp(`{"dni":"${DNI}","next":"2026-11-04"}`)),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-tamiz-sensitivity")).toBe("critical");
    expect(response.headers.get("x-tamiz-privacy")).toBe("restrict_to_local");
    expect(provider.calls.map((call) => call.target.residency)).toEqual(["local"]);
  });

  it("US2-2: a name only in tool-call arguments is anonymized like one in a user message", async () => {
    const body = followUp("{}");
    body.messages[1] = {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_a1",
          type: "function",
          function: { name: "get_patient", arguments: `{"name":"${NAME}"}` },
        },
      ],
    };
    const { send, provider } = await createTestApp({
      inspect: finding("high", [["PERSON", NAME]]),
      script: textAnswer,
    });

    const response = await send("/v1/chat/completions", post(body));

    expect(response.headers.get("x-tamiz-privacy")).toBe("anonymize;notice=v2");
    const sent = provider.calls[0]?.messages[2];
    expect(sent?.role === "assistant" && sent.toolCalls[0]?.arguments).toBe(
      '{"name":"<PERSON_1>"}',
    );
  });

  it("US2-3: the detector reads tool definitions, and data there counts", async () => {
    const tools = [
      { type: "function", function: { name: "get_patient", description: `Only for ${DNI}` } },
    ];
    const inspect = finding("critical", [["DNI", DNI]]);
    const { send, provider } = await createTestApp({ inspect, script: textAnswer });

    const response = await send(
      "/v1/chat/completions",
      post({ model: "tamiz-auto", messages: [{ role: "user", content: "Hola" }], tools }),
    );

    expect(inspect.calls[0]).toEqual(["Hola", `Only for ${DNI}\n`]);
    expect(response.headers.get("x-tamiz-sensitivity")).toBe("critical");
    expect(provider.calls.map((call) => call.target.residency)).toEqual(["local"]);
  });

  it("US2-4: a failed inspection of a tool-calling request applies onDetectorError", async () => {
    const { send, provider } = await createTestApp({
      inspect: inspectAs({ status: "failed", reason: "unavailable" }),
      script: textAnswer,
    });

    const response = await send("/v1/chat/completions", post(followUp("{}")));

    expect(response.headers.get("x-tamiz-privacy")).toBe("restrict_to_local");
    expect(provider.calls.map((call) => call.target.residency)).toEqual(["local"]);
  });
});

describe("anonymized values come back restored inside tool calls (US3)", () => {
  it("US3-1, US3-2: placeholders in the tool result upstream; the client's arguments restored", async () => {
    const { send, provider } = await createTestApp({
      inspect: finding("high", [["PERSON", NAME]]),
      script: callingReminder('{"name":"<PERSON_1>"}'),
    });

    const response = await send(
      "/v1/chat/completions",
      post(followUp(`{"name":"${NAME}","next":"2026-11-04"}`)),
    );
    const json = (await response.json()) as ChatCompletionResponse;

    const upstream = JSON.stringify(provider.calls[0]?.messages);
    expect(upstream).not.toContain(NAME);
    expect(provider.calls[0]?.messages[3]).toMatchObject({
      role: "tool",
      content: '{"name":"<PERSON_1>","next":"2026-11-04"}',
    });
    expect(provider.calls[0]?.messages[0]?.content).toContain("tool arguments");
    expect(response.headers.get("x-tamiz-privacy")).toBe("anonymize;notice=v2");
    const args = json.choices[0]?.message.tool_calls?.[0]?.function.arguments ?? "";
    expect(JSON.parse(args)).toEqual({ name: NAME });
  });

  it("US3-3: a restored value with quotes and backslashes keeps the arguments valid JSON", async () => {
    const tricky = 'Ana "La" Ruiz\\Gil';
    const { send } = await createTestApp({
      inspect: finding("high", [["PERSON", tricky]]),
      script: callingReminder('{"name":"<PERSON_1>"}'),
    });

    const response = await send("/v1/chat/completions", post(followUp(`Paciente: ${tricky}`)));
    const json = (await response.json()) as ChatCompletionResponse;

    expect(JSON.parse(json.choices[0]?.message.tool_calls?.[0]?.function.arguments ?? "")).toEqual({
      name: tricky,
    });
  });

  it("US3-4, US3-5: anonymized client arguments still parse; a number becomes a string", async () => {
    const body = followUp("{}");
    body.messages[1] = {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_a1",
          type: "function",
          function: { name: "get_patient", arguments: `{"name":"${NAME}","phone":612345678}` },
        },
      ],
    };
    const { send, provider } = await createTestApp({
      inspect: finding("high", [
        ["PERSON", NAME],
        ["PHONE", "612345678"],
      ]),
      script: textAnswer,
    });

    await send("/v1/chat/completions", post(body));

    const sent = provider.calls[0]?.messages[2];
    const args = sent?.role === "assistant" ? sent.toolCalls[0]?.arguments : undefined;
    expect(JSON.parse(args ?? "")).toEqual({ name: "<PERSON_1>", phone: "<PHONE_1>" });
  });

  it("US3-6: a value that crosses JSON structure keeps the request local, with an event", async () => {
    const all: RoutingEvent[] = [];
    const body = followUp("{}");
    body.messages[1] = {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_a1",
          type: "function",
          function: { name: "get_patient", arguments: '{"first":"Ana","last":"Ruiz"}' },
        },
      ],
    };
    const { send, provider } = await createTestApp({
      inspect: finding("high", [["PERSON", 'Ana","last":"Ruiz']]),
      events: { emit: (event) => all.push(event) },
      script: textAnswer,
    });

    const response = await send("/v1/chat/completions", post(body));

    expect(response.headers.get("x-tamiz-privacy")).toBe("restrict_to_local");
    expect(provider.calls.map((call) => call.target.residency)).toEqual(["local"]);
    expect(all).toContainEqual(
      expect.objectContaining({ type: "privacy.not_anonymizable", reason: "json_structure" }),
    );
  });

  it("US3-6: personal data in a tool definition keeps an anonymize-level request local", async () => {
    const tools = [
      { type: "function", function: { name: "get_patient", description: `Only ${NAME}` } },
    ];
    const { send, provider } = await createTestApp({
      inspect: finding("high", [["PERSON", NAME]]),
      script: textAnswer,
    });

    const response = await send(
      "/v1/chat/completions",
      post({ model: "tamiz-auto", messages: [{ role: "user", content: "Hola" }], tools }),
    );

    expect(response.headers.get("x-tamiz-privacy")).toBe("restrict_to_local");
    expect(provider.calls.map((call) => call.target.residency)).toEqual(["local"]);
  });
});

describe("fallback keeps tools and guarantees (US5)", () => {
  it("US5-1: the next target gets the same tools, choice and messages", async () => {
    const { send, provider } = await createTestApp({
      script: (input) =>
        input.target.id === "mistral-small"
          ? err(failure("http_error", { status: 400, on: target("mistral-small") }))
          : textAnswer(input),
    });

    const response = await send("/v1/chat/completions", post(followUp("{}")));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-tamiz-fallback")).toContain("mistral-small");
    const [first, second] = provider.calls;
    expect(second?.target.id).not.toBe("mistral-small");
    expect(second?.tools).toEqual(first?.tools);
    expect(second?.toolChoice).toEqual(first?.toolChoice);
    expect(second?.messages).toEqual(first?.messages);
  });

  it("US5-2: a 4xx rejection of tools is not retried on the same target", async () => {
    const { send, provider } = await createTestApp({
      script: (input) =>
        input.target.id === "mistral-small"
          ? err(failure("http_error", { status: 400, on: target("mistral-small") }))
          : textAnswer(input),
    });

    await send("/v1/chat/completions", post(followUp("{}")));

    expect(provider.calls.filter((call) => call.target.id === "mistral-small")).toHaveLength(1);
  });

  it("US5-4: with critical data and every local target failing, nothing leaves the machine", async () => {
    const { send, provider } = await createTestApp({
      inspect: finding("critical", [["DNI", DNI]]),
      script: () => err(failure("network", { on: target("ollama-llama") })),
    });

    const response = await send("/v1/chat/completions", post(followUp(`DNI ${DNI}`)));

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(provider.calls.every((call) => call.target.residency === "local")).toBe(true);
  });
});

describe("audit (US6-1)", () => {
  it("records tool counts and the called names, nothing else about tools", async () => {
    const { send, audit } = await createTestApp({ script: callingReminder('{"name":"x"}') });

    await send("/v1/chat/completions", post(followUp('{"secret":"tool-result-marker"}')));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const [entry] = audit.entries();
    expect(entry?.tools).toEqual({ declared: 2, toolMessages: 1, called: ["send_reminder"] });
    expect(JSON.stringify(entry)).not.toMatch(/tool-result-marker|Look up|patientId/);
  });

  it("has no tools field for a request without tools", async () => {
    const { send, audit } = await createTestApp();

    await send(
      "/v1/chat/completions",
      post({ model: "tamiz-auto", messages: [{ role: "user", content: "Hola" }] }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(audit.entries()[0]).not.toHaveProperty("tools");
  });
});
