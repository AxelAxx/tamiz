/**
 * Tool calling through the four adapters (009 tool-calling FR-006, FR-016, FR-017, US1-3,
 * US1-5, US4-4, US5-2, US5-3, tasks.md T010, T015): tools, tool choice, tool-call history
 * and tool results reach each upstream API in its own format; the answer's tool calls come
 * back normalized, completed and streamed. Upstreams are MSW handlers.
 */
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type {
  LlmProviderPort,
  ProviderCompletionInput,
  StreamPart,
} from "../../src/application/ports/llm-provider.port.js";
import type { Message } from "../../src/domain/model/inference-request.js";
import type { ModelTarget, ProviderName } from "../../src/domain/model/model-target.js";
import {
  millisecondsUnchecked,
  targetIdUnchecked,
  usdUnchecked,
} from "../../src/domain/model/units.js";
import { createAnthropicAdapter } from "../../src/infrastructure/llm/anthropic.js";
import { createMistralAdapter } from "../../src/infrastructure/llm/mistral.js";
import { createOllamaAdapter } from "../../src/infrastructure/llm/ollama.js";
import { createOpenAiAdapter } from "../../src/infrastructure/llm/openai.js";
import { nineCharAlias } from "../../src/infrastructure/llm/tool-call-ids.js";
import { SECRET_API_KEY } from "./adapter-scenarios.js";
import { useMswServer } from "./msw.js";

const server = useMswServer();

const PARAMETERS = {
  type: "object",
  properties: { patientId: { type: "string" } },
  required: ["patientId"],
};

const HISTORY: ReadonlyArray<Message> = [
  { role: "user", content: "When is the next appointment of patient 4411?" },
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
];

function target(provider: ProviderName, model: string): ModelTarget {
  return {
    id: targetIdUnchecked("target-under-test"),
    provider,
    model,
    region: "test",
    residency: "local",
    pricing: { inputUsdPerMillion: usdUnchecked(0), outputUsdPerMillion: usdUnchecked(0) },
  };
}

function input(config: ProviderConfig, overrides: Partial<ProviderCompletionInput> = {}) {
  return {
    target: target(config.provider, config.model),
    messages: HISTORY,
    tools: [{ name: "get_patient", description: "Look up a patient", parameters: PARAMETERS }],
    toolChoice: "auto",
    timeoutMs: millisecondsUnchecked(5_000),
    ...overrides,
  } satisfies ProviderCompletionInput;
}

type JsonBody = Record<string, unknown>;

interface ProviderConfig {
  readonly provider: ProviderName;
  readonly model: string;
  readonly url: string;
  readonly createAdapter: () => LlmProviderPort;
  /** A completion whose answer is two tool calls. */
  readonly toolCallAnswer: (calls: ReadonlyArray<{ id: string; args: string }>) => JsonBody;
  /** The upstream tools field, the tool choice field for each choice, and the history. */
  readonly expectTools: (body: JsonBody) => void;
  readonly expectChoice: (body: JsonBody, choice: ProviderCompletionInput["toolChoice"]) => void;
  readonly expectHistory: (body: JsonBody, ids: { readonly call: string }) => void;
  /** Stream events for one call whose arguments arrive in `pieces`. */
  readonly toolCallStream: (id: string, pieces: ReadonlyArray<string>) => string[];
}

function openAiStyle(
  provider: ProviderName,
  model: string,
  url: string,
  createAdapter: () => LlmProviderPort,
): ProviderConfig {
  const chunk = (delta: unknown, finish: string | null = null) =>
    `data: ${JSON.stringify({
      id: "chatcmpl-stream",
      object: "chat.completion.chunk",
      created: 1_793_350_800,
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  return {
    provider,
    model,
    url,
    createAdapter,
    toolCallAnswer: (calls) => ({
      id: "chatcmpl-tools",
      object: "chat.completion",
      created: 1_793_350_800,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: "get_patient", arguments: call.args },
            })),
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    }),
    expectTools: (body) => {
      expect(body["tools"]).toEqual([
        {
          type: "function",
          function: expect.objectContaining({
            name: "get_patient",
            description: "Look up a patient",
            parameters: expect.objectContaining({ properties: PARAMETERS.properties }),
          }),
        },
      ]);
    },
    expectChoice: (body, choice) => {
      const expected =
        typeof choice === "object" ? { type: "function", function: { name: choice.name } } : choice;
      if (provider === "mistral" && choice === "required") {
        expect(body["tool_choice"]).toBe("any");
      } else if (provider === "mistral" && typeof choice === "object") {
        // Mistral has no named choice: the SDK sends only that tool and requires a call.
        expect(body["tool_choice"]).toBe("any");
      } else {
        expect(body["tool_choice"]).toEqual(expected);
      }
    },
    expectHistory: (body, ids) => {
      const messages = body["messages"] as JsonBody[];
      expect(messages[1]).toMatchObject({
        role: "assistant",
        tool_calls: [
          {
            id: ids.call,
            type: "function",
            function: { name: "get_patient", arguments: '{"patientId":"4411"}' },
          },
        ],
      });
      expect(messages[2]).toMatchObject({
        role: "tool",
        tool_call_id: ids.call,
        content: '{"next":"2026-11-04"}',
      });
    },
    toolCallStream: (id, pieces) => [
      chunk({
        role: "assistant",
        tool_calls: [
          { index: 0, id, type: "function", function: { name: "get_patient", arguments: "" } },
        ],
      }),
      ...pieces.map((piece) =>
        chunk({ tool_calls: [{ index: 0, function: { arguments: piece } }] }),
      ),
      chunk({}, "tool_calls"),
      "data: [DONE]\n\n",
    ],
  };
}

const anthropicEvent = (name: string, data: JsonBody) =>
  `event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`;

const anthropic: ProviderConfig = {
  provider: "anthropic",
  model: "claude-haiku-4-5",
  url: "https://api.anthropic.com/v1/messages",
  createAdapter: () => createAnthropicAdapter({ apiKey: SECRET_API_KEY }),
  toolCallAnswer: (calls) => ({
    id: "msg_tools",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: calls.map((call) => ({
      type: "tool_use",
      id: call.id,
      name: "get_patient",
      input: JSON.parse(call.args) as unknown,
    })),
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 8 },
  }),
  expectTools: (body) => {
    expect(body["tools"]).toEqual([
      expect.objectContaining({
        name: "get_patient",
        description: "Look up a patient",
        input_schema: expect.objectContaining({ properties: PARAMETERS.properties }),
      }),
    ]);
  },
  expectChoice: (body, choice) => {
    const expected =
      choice === "none"
        ? { type: "none" }
        : choice === "required"
          ? { type: "any" }
          : typeof choice === "object"
            ? { type: "tool", name: choice.name }
            : { type: "auto" };
    expect(body["tool_choice"]).toEqual(expected);
  },
  expectHistory: (body, ids) => {
    const messages = body["messages"] as JsonBody[];
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: [
        { type: "tool_use", id: ids.call, name: "get_patient", input: { patientId: "4411" } },
      ],
    });
    expect(messages[2]).toMatchObject({
      role: "user",
      content: [
        expect.objectContaining({
          type: "tool_result",
          tool_use_id: ids.call,
          content: '{"next":"2026-11-04"}',
        }),
      ],
    });
  },
  toolCallStream: (id, pieces) => [
    anthropicEvent("message_start", {
      message: {
        id: "msg_stream",
        type: "message",
        role: "assistant",
        model: "claude-haiku-4-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 1 },
      },
    }),
    anthropicEvent("content_block_start", {
      index: 0,
      content_block: { type: "tool_use", id, name: "get_patient", input: {} },
    }),
    ...pieces.map((piece) =>
      anthropicEvent("content_block_delta", {
        index: 0,
        delta: { type: "input_json_delta", partial_json: piece },
      }),
    ),
    anthropicEvent("content_block_stop", { index: 0 }),
    anthropicEvent("message_delta", {
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 8 },
    }),
    anthropicEvent("message_stop", {}),
  ],
};

const PROVIDERS: ReadonlyArray<ProviderConfig> = [
  openAiStyle("openai", "gpt-4o-mini", "https://api.openai.com/v1/chat/completions", () =>
    createOpenAiAdapter({ apiKey: SECRET_API_KEY }),
  ),
  openAiStyle("ollama", "llama3.1:8b", "http://localhost:11434/v1/chat/completions", () =>
    createOllamaAdapter({ baseUrl: "http://localhost:11434/v1" }),
  ),
  openAiStyle("mistral", "mistral-small-latest", "https://api.mistral.ai/v1/chat/completions", () =>
    createMistralAdapter({ apiKey: SECRET_API_KEY }),
  ),
  anthropic,
];

/** Answers every call with `respond` and records the upstream bodies. */
function answer(config: ProviderConfig, respond: () => Response): JsonBody[] {
  const bodies: JsonBody[] = [];
  server.use(
    http.post(config.url, async ({ request }) => {
      bodies.push((await request.json()) as JsonBody);
      return respond();
    }),
  );
  return bodies;
}

function sse(events: ReadonlyArray<string>): Response {
  return new HttpResponse(events.join(""), { headers: { "content-type": "text/event-stream" } });
}

/** The id the upstream must see for the client's `call_a1`. */
const upstreamId = (config: ProviderConfig) =>
  config.provider === "mistral" ? nineCharAlias("call_a1") : "call_a1";

describe.each(PROVIDERS)("$provider adapter with tools", (config) => {
  it("US1-5: sends tools and the tool-call history in the provider's format", async () => {
    const bodies = answer(config, () =>
      HttpResponse.json(config.toolCallAnswer([{ id: "call12345", args: '{"patientId":"1"}' }])),
    );

    await config.createAdapter().complete(input(config));

    const body = bodies[0] ?? {};
    config.expectTools(body);
    config.expectHistory(body, { call: upstreamId(config) });
  });

  it.each(["auto", "none", "required", { name: "get_patient" }] as const)(
    "US1-3: passes tool_choice %j",
    async (toolChoice) => {
      const bodies = answer(config, () =>
        HttpResponse.json(config.toolCallAnswer([{ id: "call12345", args: "{}" }])),
      );

      await config.createAdapter().complete(input(config, { toolChoice }));

      config.expectChoice(bodies[0] ?? {}, toolChoice);
    },
  );

  it("US1-1: returns two tool calls with ids, names and arguments as JSON text", async () => {
    answer(config, () =>
      HttpResponse.json(
        config.toolCallAnswer([
          { id: "callA0001", args: '{"patientId":"4411"}' },
          { id: "callB0002", args: '{"patientId":"5522"}' },
        ]),
      ),
    );

    const result = await config.createAdapter().complete(input(config));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.finishReason).toBe("tool_calls");
    expect(result.value.text).toBe("");
    expect(result.value.toolCalls).toEqual([
      { id: "callA0001", name: "get_patient", arguments: '{"patientId":"4411"}' },
      { id: "callB0002", name: "get_patient", arguments: '{"patientId":"5522"}' },
    ]);
  });

  it("US4-1, US4-4: streams a call that starts the answer: start, argument pieces, finish", async () => {
    answer(config, () => sse(config.toolCallStream("callS0001", ['{"patient', 'Id":"4411"}'])));

    const started = await config.createAdapter().stream(input(config));

    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.first).toBe("");
    const parts: StreamPart[] = [];
    for await (const part of started.value.rest) parts.push(part);
    expect(parts[0]).toEqual({
      type: "tool-call-start",
      index: 0,
      id: "callS0001",
      name: "get_patient",
    });
    const args = parts
      .flatMap((part) => (part.type === "tool-call-delta" ? [part.arguments] : []))
      .join("");
    expect(JSON.parse(args)).toEqual({ patientId: "4411" });
    expect(parts.at(-1)).toMatchObject({ type: "finish", finishReason: "tool_calls" });
  });

  it("US5-2: a provider that rejects tools is a non-retryable provider error", async () => {
    answer(config, () =>
      HttpResponse.json({ error: { message: "tools are not supported" } }, { status: 400 }),
    );

    const result = await config.createAdapter().complete(input(config));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ cause: "http_error", retryable: false, status: 400 });
  });
});

describe("mistral tool-call ids (FR-016, US5-3)", () => {
  const mistral = PROVIDERS.find((config) => config.provider === "mistral");

  it("aliases foreign ids upstream and gives the client its own ids back", async () => {
    if (mistral === undefined) throw new Error("mistral config");
    const alias = nineCharAlias("call_a1");
    expect(alias).toMatch(/^[a-zA-Z0-9]{9}$/);
    answer(mistral, () =>
      HttpResponse.json(mistral.toolCallAnswer([{ id: alias, args: '{"patientId":"4411"}' }])),
    );

    const result = await mistral.createAdapter().complete(input(mistral));

    expect(result.ok && result.value.toolCalls?.[0]?.id).toBe("call_a1");
  });
});
