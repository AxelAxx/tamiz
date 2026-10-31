import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type ChatCompletionResponse,
  ChatCompletionResponseSchema,
  type Usd,
} from "../src/index.js";
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
      "stop" | "length" | "content_filter" | "tool_calls" | undefined
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
      choices: [{ ...validResponse.choices[0], finish_reason: "function_call" }],
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

describe("usage cost extension (spec 002 US7-5, FR-035)", () => {
  const withUsage = (usage: Record<string, unknown>) => ({
    ...validResponse,
    usage: { ...validResponse.usage, ...usage },
  });

  it("accepts cost_usd and estimated, and types cost_usd as Usd", () => {
    const result = ChatCompletionResponseSchema.safeParse(
      withUsage({ cost_usd: 0.00045, estimated: false }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.usage.cost_usd).toBe(0.00045);
    expectTypeOf(result.data.usage.cost_usd).toEqualTypeOf<Usd | undefined>();
    expectTypeOf(result.data.usage.estimated).toEqualTypeOf<boolean | undefined>();
  });

  it("keeps both fields optional (the 001 shape still validates)", () => {
    expect(ChatCompletionResponseSchema.safeParse(validResponse).success).toBe(true);
  });

  it("rejects a negative cost and a non-boolean estimated", () => {
    expect(ChatCompletionResponseSchema.safeParse(withUsage({ cost_usd: -0.01 })).success).toBe(
      false,
    );
    expect(ChatCompletionResponseSchema.safeParse(withUsage({ estimated: "yes" })).success).toBe(
      false,
    );
  });

  it("still rejects unknown usage keys", () => {
    const result = ChatCompletionResponseSchema.safeParse(withUsage({ cached_tokens: 3 }));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["usage"]);
  });
});
