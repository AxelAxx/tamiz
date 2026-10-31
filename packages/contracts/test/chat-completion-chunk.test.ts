import { describe, expect, it } from "vitest";
import { ChatCompletionChunkSchema, StreamErrorEventSchema } from "../src/index.js";

// Spec 003 FR-021, FR-024, FR-026, research R-10 (tasks.md T041): the streaming chunk in
// the OpenAI format, the usage chunk and the mid-stream error event.

const base = {
  id: "chatcmpl-req-1",
  object: "chat.completion.chunk",
  created: 1_793_350_800,
  model: "mistral-small-latest",
} as const;

describe("ChatCompletionChunkSchema", () => {
  it("accepts a first delta with the role, a content delta and a finish chunk", () => {
    const chunks = [
      {
        ...base,
        choices: [{ index: 0, delta: { role: "assistant", content: "Hola" }, finish_reason: null }],
      },
      { ...base, choices: [{ index: 0, delta: { content: ", ¿qué tal?" }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];

    for (const chunk of chunks)
      expect(ChatCompletionChunkSchema.safeParse(chunk).success).toBe(true);
  });

  it("accepts the usage chunk: no choices, usage with cost and estimated", () => {
    const usageChunk = {
      ...base,
      choices: [],
      usage: {
        prompt_tokens: 9,
        completion_tokens: 4,
        total_tokens: 13,
        cost_usd: 0.0000021,
        estimated: false,
      },
    };

    expect(ChatCompletionChunkSchema.safeParse(usageChunk).success).toBe(true);
  });

  it.each([
    ["another object", { ...base, object: "chat.completion", choices: [] }, ["object"]],
    [
      "an unknown finish reason",
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "function_call" }] },
      ["choices", 0, "finish_reason"],
    ],
    [
      "a delta role other than assistant",
      { ...base, choices: [{ index: 0, delta: { role: "user" }, finish_reason: null }] },
      ["choices", 0, "delta", "role"],
    ],
    ["an unknown field", { ...base, choices: [], system_fingerprint: "fp" }, []],
  ])("rejects %s", (_name, chunk, path) => {
    const result = ChatCompletionChunkSchema.safeParse(chunk);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(path);
  });
});

describe("StreamErrorEventSchema (FR-024)", () => {
  it("accepts an error envelope body", () => {
    expect(
      StreamErrorEventSchema.safeParse({
        error: { type: "provider_error", message: "provider stream failed", requestId: "req-1" },
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown error type and extra fields", () => {
    expect(
      StreamErrorEventSchema.safeParse({ error: { type: "teapot", message: "x" } }).success,
    ).toBe(false);
    expect(
      StreamErrorEventSchema.safeParse({
        error: { type: "provider_error", message: "x" },
        done: true,
      }).success,
    ).toBe(false);
  });
});
