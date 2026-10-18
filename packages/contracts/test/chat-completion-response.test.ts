import { describe, expect, expectTypeOf, it } from "vitest";
import { type ChatCompletionResponse, ChatCompletionResponseSchema } from "../src/index.js";
import { invalidResponses, validResponse } from "./fixtures/chat-completion.js";

describe("ChatCompletionResponseSchema (spec US2-5, SC-004)", () => {
  it("US2-5: accepts a valid response and types it", () => {
    const result = ChatCompletionResponseSchema.safeParse(validResponse);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(validResponse);
    expectTypeOf(result.data).toEqualTypeOf<ChatCompletionResponse>();
    expectTypeOf(result.data.object).toEqualTypeOf<"chat.completion">();
    expectTypeOf(result.data.choices[0]?.finish_reason).toEqualTypeOf<
      "stop" | "length" | "content_filter" | undefined
    >();
    expectTypeOf(result.data.usage.total_tokens).toEqualTypeOf<number>();
  });

  it("rejects choices: []", () => {
    const result = ChatCompletionResponseSchema.safeParse({ ...validResponse, choices: [] });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["choices"]);
  });

  it("rejects an unknown top-level field and names it", () => {
    const result = ChatCompletionResponseSchema.safeParse({
      ...validResponse,
      system_fingerprint: "fp_1",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues[0];
    expect(issue?.code).toBe("unrecognized_keys");
    expect(issue?.code === "unrecognized_keys" && issue.keys).toEqual(["system_fingerprint"]);
  });

  it("rejects a missing usage", () => {
    const { usage: _usage, ...withoutUsage } = validResponse;
    const result = ChatCompletionResponseSchema.safeParse(withoutUsage);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["usage"]);
  });

  it('rejects object other than "chat.completion"', () => {
    const result = ChatCompletionResponseSchema.safeParse({
      ...validResponse,
      object: "chat.completion.chunk",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["object"]);
  });

  it.each([-1, 1.5])("rejects created that is not a non-negative integer: %s", (created) => {
    const result = ChatCompletionResponseSchema.safeParse({ ...validResponse, created });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["created"]);
  });

  it("rejects an unknown finish_reason", () => {
    const result = ChatCompletionResponseSchema.safeParse({
      ...validResponse,
      choices: [{ ...validResponse.choices[0], finish_reason: "tool_calls" }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["choices", 0, "finish_reason"]);
  });

  it("rejects negative token counts", () => {
    const result = ChatCompletionResponseSchema.safeParse({
      ...validResponse,
      usage: { ...validResponse.usage, prompt_tokens: -1 },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["usage", "prompt_tokens"]);
  });

  describe("SC-004: every sample of the invalid response corpus is rejected", () => {
    it.each(invalidResponses.map((s) => [s.name, s] as const))("%s", (_name, sample) => {
      const result = ChatCompletionResponseSchema.safeParse(sample.payload);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(sample.path);
    });
  });
});
