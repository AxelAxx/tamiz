import { describe, expect, expectTypeOf, it } from "vitest";
import { type ChatCompletionRequest, ChatCompletionRequestSchema } from "../src/index.js";
import { invalidRequests, minimalRequest, validRequest } from "./fixtures/chat-completion.js";

describe("ChatCompletionRequestSchema (spec US2-1 … US2-4, SC-004)", () => {
  it("US2-1: accepts a valid request and types every field", () => {
    const result = ChatCompletionRequestSchema.safeParse(validRequest);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(validRequest);
    expectTypeOf(result.data).toEqualTypeOf<ChatCompletionRequest>();
    expectTypeOf(result.data.model).toEqualTypeOf<string>();
    expectTypeOf(result.data.temperature).toEqualTypeOf<number | undefined>();
    expectTypeOf(result.data.max_tokens).toEqualTypeOf<number | undefined>();
    expectTypeOf(result.data.stream).toEqualTypeOf<boolean | undefined>();
    expectTypeOf(result.data.user).toEqualTypeOf<string | undefined>();
    expectTypeOf(result.data.messages[0]?.role).toEqualTypeOf<
      "system" | "user" | "assistant" | "tool" | undefined
    >();
  });

  it("accepts the minimal request (model + messages only)", () => {
    expect(ChatCompletionRequestSchema.safeParse(minimalRequest).success).toBe(true);
  });

  it("US2-2: rejects an unknown top-level field and names it", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      ...minimalRequest,
      parallel_tool_calls: false,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.code === "unrecognized_keys");
    expect(issue).toBeDefined();
    expect(issue?.code === "unrecognized_keys" && issue.keys).toEqual(["parallel_tool_calls"]);
    expect(issue?.message).toContain("parallel_tool_calls");
  });

  it("US2-2: rejects an unknown field nested inside a message", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      ...minimalRequest,
      messages: [{ role: "user", content: "hi", name: "alice" }],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues[0];
    expect(issue?.code).toBe("unrecognized_keys");
    expect(issue?.path).toEqual(["messages", 0]);
  });

  it('US2-3: rejects temperature: "hot" naming the field and the expected type', () => {
    const result = ChatCompletionRequestSchema.safeParse({ ...minimalRequest, temperature: "hot" });

    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues[0];
    expect(issue?.path).toEqual(["temperature"]);
    expect(issue?.code).toBe("invalid_type");
    expect(issue?.code === "invalid_type" && issue.expected).toBe("number");
  });

  it('US2-3: rejects messages: "hello" naming the field and the expected type', () => {
    const result = ChatCompletionRequestSchema.safeParse({ ...minimalRequest, messages: "hello" });

    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues[0];
    expect(issue?.path).toEqual(["messages"]);
    expect(issue?.code).toBe("invalid_type");
    expect(issue?.code === "invalid_type" && issue.expected).toBe("array");
  });

  it("spec 003 FR-021: accepts stream: true (001 US2-4 rejected it until feature 003)", () => {
    expect(ChatCompletionRequestSchema.safeParse({ ...minimalRequest, stream: true }).success).toBe(
      true,
    );
  });

  it("spec 003 R-10: accepts stream_options.include_usage and rejects unknown stream_options keys", () => {
    expect(
      ChatCompletionRequestSchema.safeParse({
        ...minimalRequest,
        stream: true,
        stream_options: { include_usage: true },
      }).success,
    ).toBe(true);
    const unknown = ChatCompletionRequestSchema.safeParse({
      ...minimalRequest,
      stream: true,
      stream_options: { continuous_usage_stats: true },
    });
    expect(unknown.success).toBe(false);
    if (unknown.success) return;
    expect(unknown.error.issues[0]?.path).toEqual(["stream_options"]);
  });

  it("rejects a non-boolean stream", () => {
    const result = ChatCompletionRequestSchema.safeParse({ ...minimalRequest, stream: "yes" });
    expect(result.success).toBe(false);
  });

  it("accepts stream: false explicitly", () => {
    expect(
      ChatCompletionRequestSchema.safeParse({ ...minimalRequest, stream: false }).success,
    ).toBe(true);
  });

  describe("edge cases", () => {
    it("rejects empty messages", () => {
      const result = ChatCompletionRequestSchema.safeParse({ ...minimalRequest, messages: [] });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(["messages"]);
    });

    it('rejects an unknown role ("function")', () => {
      const result = ChatCompletionRequestSchema.safeParse({
        ...minimalRequest,
        messages: [{ role: "function", content: "x" }],
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(["messages", 0, "role"]);
    });

    it.each([-0.1, 2.5, Number.NaN])("rejects temperature outside [0, 2]: %s", (temperature) => {
      const result = ChatCompletionRequestSchema.safeParse({ ...minimalRequest, temperature });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(["temperature"]);
    });

    it.each([0, 2])("accepts temperature at the boundary: %s", (temperature) => {
      expect(
        ChatCompletionRequestSchema.safeParse({ ...minimalRequest, temperature }).success,
      ).toBe(true);
    });

    it.each([0, -1, 1.5])("rejects max_tokens that is not a positive integer: %s", (max_tokens) => {
      const result = ChatCompletionRequestSchema.safeParse({ ...minimalRequest, max_tokens });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(["max_tokens"]);
    });

    it("rejects an empty model", () => {
      const result = ChatCompletionRequestSchema.safeParse({ ...minimalRequest, model: "" });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(["model"]);
    });

    it("rejects a user longer than 256 characters", () => {
      const result = ChatCompletionRequestSchema.safeParse({
        ...minimalRequest,
        user: "u".repeat(257),
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(["user"]);
    });
  });

  describe("SC-004: every sample of the invalid corpus is rejected", () => {
    it.each(invalidRequests.map((s) => [s.name, s] as const))("%s", (_name, sample) => {
      const result = ChatCompletionRequestSchema.safeParse(sample.payload);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(sample.path);
    });
  });
});
