import {
  ChatCompletionChunkSchema,
  ErrorEnvelopeSchema,
  StreamErrorEventSchema,
} from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import type {
  ProviderCompletionInput,
  StartedStream,
  StreamPart,
} from "../src/application/ports/llm-provider.port.js";
import type { ProviderError } from "../src/domain/errors.js";
import { err, ok, type Result } from "../src/domain/result.js";
import { AUTH, createTestApp } from "./helpers/app.js";
import { failure } from "./resilience/helpers.js";

// Spec 003 US6-1, US6-2, US6-4, US6-6, US6-7, FR-021 … FR-027, SC-007 (tasks.md T044).
// In-process with the default policy; the body is parsed as server-sent events.

const STREAM = {
  model: "tamiz-auto",
  stream: true,
  messages: [{ role: "user", content: "Hola, ¿qué tal?" }],
} as const;

function post(body: unknown, init: { signal?: AbortSignal } = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...AUTH },
    body: JSON.stringify(body),
    ...init,
  };
}

/** The `data:` payloads of an event stream, in order. */
async function dataLines(response: Response): Promise<string[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
}

async function* parts(...items: StreamPart[]): AsyncGenerator<StreamPart> {
  for (const item of items) yield item;
}

type Script = (input: ProviderCompletionInput) => Promise<Result<StartedStream, ProviderError>>;

const healthy: Script = async (input) =>
  ok({
    first: "Hola",
    modelName: input.target.model,
    rest: parts(
      { type: "delta", text: ", ¿qué tal?" },
      { type: "finish", finishReason: "stop", usage: { promptTokens: 9, completionTokens: 4 } },
    ),
  });

describe("POST /v1/chat/completions with stream: true", () => {
  it("US6-1: OpenAI chunks, a finish chunk, a usage chunk with cost, then [DONE]", async () => {
    const { send } = await createTestApp({ streamScript: healthy });

    const response = await send("/v1/chat/completions", post(STREAM));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
    const lines = await dataLines(response);
    expect(lines.at(-1)).toBe("[DONE]");
    const chunks = lines
      .slice(0, -1)
      .map((line) => ChatCompletionChunkSchema.parse(JSON.parse(line)));
    expect(new Set(chunks.map((chunk) => `${chunk.id}|${chunk.created}|${chunk.model}`)).size).toBe(
      1,
    );
    expect(chunks[0]?.model).toBe("mistral-small-latest");
    expect(chunks.map((chunk) => chunk.choices[0]?.delta)).toEqual([
      { role: "assistant", content: "Hola" },
      { content: ", ¿qué tal?" },
      {},
      undefined,
    ]);
    expect(chunks[2]?.choices[0]?.finish_reason).toBe("stop");
    const usage = chunks[3]?.usage;
    expect(chunks[3]?.choices).toEqual([]);
    expect(usage).toMatchObject({
      prompt_tokens: 9,
      completion_tokens: 4,
      total_tokens: 13,
      estimated: false,
    });
    expect(usage?.cost_usd).toBeCloseTo((9 * 0.1 + 4 * 0.3) / 1e6, 12);
  });

  it("US6-2: the routing headers are final when the stream starts, fallback included", async () => {
    const { send } = await createTestApp({
      streamScript: async (input) =>
        input.target.id === "mistral-small"
          ? err(failure("http_error", { status: 503, on: input.target }))
          : healthy(input),
    });

    const response = await send("/v1/chat/completions", post(STREAM, {}));

    expect(response.headers.get("x-tamiz-route")).toBe("openai-mini");
    expect(response.headers.get("x-tamiz-rule")).toBe("default");
    expect(response.headers.get("x-tamiz-fallback")).toBe("mistral-small:http_error");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect((await dataLines(response)).at(-1)).toBe("[DONE]");
  });

  it("US6-4: a failure after the first token ends with one error event and no [DONE]", async () => {
    const { send } = await createTestApp({
      streamScript: async (input) =>
        ok({
          first: "Hola",
          modelName: input.target.model,
          rest: parts(
            { type: "delta", text: " a" },
            { type: "error", error: failure("network", { on: input.target }) },
          ),
        }),
    });

    const response = await send("/v1/chat/completions", post(STREAM));
    const lines = await dataLines(response);

    expect(response.status).toBe(200);
    expect(lines).not.toContain("[DONE]");
    const last = StreamErrorEventSchema.parse(JSON.parse(lines.at(-1) ?? "null"));
    expect(last.error.type).toBe("provider_error");
    expect(last.error.requestId).toBeTruthy();
    expect(JSON.stringify(last)).not.toMatch(/at .*\.ts/);
    expect(lines.filter((line) => line.includes('"error"'))).toHaveLength(1);
  });

  it.each([
    ["http_error", 502, "provider_error"],
    ["timeout", 504, "provider_timeout"],
  ] as const)(
    "US6-7: every target failing with %s before a token → JSON %i %s, no event stream",
    async (cause, status, type) => {
      const { send } = await createTestApp({
        streamScript: async (input) => err(failure(cause, { status: 503, on: input.target })),
      });

      const response = await send("/v1/chat/completions", post(STREAM));

      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toMatch(/application\/json/);
      expect(ErrorEnvelopeSchema.parse(await response.json()).error.type).toBe(type);
      expect(response.headers.get("x-tamiz-route")).toBe("ollama-llama");
    },
  );

  it("US6-6: a client disconnect reaches the provider's signal", async () => {
    let providerSignal: AbortSignal | undefined;
    let release: (() => void) | undefined;
    const { app } = await createTestApp({
      streamScript: async (input) => {
        providerSignal = input.signal;
        async function* slow(): AsyncGenerator<StreamPart> {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          yield { type: "finish", finishReason: "stop" };
        }
        return ok({ first: "Hola", modelName: input.target.model, rest: slow() });
      },
    });
    const controller = new AbortController();

    const response = await app.request(
      "/v1/chat/completions",
      post(STREAM, { signal: controller.signal }),
    );
    expect(response.status).toBe(200);
    controller.abort();
    release?.();

    expect(providerSignal?.aborted).toBe(true);
  });

  it("SC-007: the first chunk is forwarded within 20 ms (p95) of the provider's first token", async () => {
    const { app } = await createTestApp({ streamScript: healthy });
    const durations: number[] = [];

    for (let i = 0; i < 100; i += 1) {
      const started = performance.now();
      const response = await app.request("/v1/chat/completions", post(STREAM));
      const reader = response.body?.getReader();
      await reader?.read();
      durations.push(performance.now() - started);
      await reader?.cancel();
    }

    durations.sort((a, b) => a - b);
    expect(durations[Math.floor(durations.length * 0.95)]).toBeLessThan(20);
  });
});
