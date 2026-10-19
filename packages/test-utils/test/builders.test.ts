import {
  ChatCompletionRequestSchema,
  ChatCompletionResponseSchema,
  HealthResponseSchema,
} from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import { chatCompletionRequest, chatCompletionResponse, healthResponse } from "../src/builders.js";

// Spec 001, US7 scenario 2 (FR-025): builders that produce valid contract objects with
// per-field overrides. Every builder parses the merged object with its contract schema,
// so a bad override fails loudly instead of leaking an invalid fixture into a test.

describe("chatCompletionRequest", () => {
  it("US7-2: without arguments, validates against ChatCompletionRequestSchema", () => {
    const request = chatCompletionRequest();

    expect(ChatCompletionRequestSchema.safeParse(request).success).toBe(true);
    expect(request.messages.length).toBeGreaterThan(0);
  });

  it("US7-2: with { model: 'x' }, keeps every default and applies the override", () => {
    const defaults = chatCompletionRequest();

    const request = chatCompletionRequest({ model: "x" });

    expect(request.model).toBe("x");
    expect(request.messages).toEqual(defaults.messages);
    expect(ChatCompletionRequestSchema.safeParse(request).success).toBe(true);
  });

  it("returns a new object on every call", () => {
    const first = chatCompletionRequest();
    const second = chatCompletionRequest();

    expect(first).not.toBe(second);
    expect(first.messages).not.toBe(second.messages);
    expect(first).toEqual(second);
  });

  it("fails loudly on an override that breaks the contract", () => {
    expect(() => chatCompletionRequest({ messages: [] })).toThrow();
    expect(() => chatCompletionRequest({ temperature: 7 })).toThrow();
  });
});

describe("chatCompletionResponse", () => {
  it("US7-2: without arguments, validates against ChatCompletionResponseSchema", () => {
    const response = chatCompletionResponse();

    expect(ChatCompletionResponseSchema.safeParse(response).success).toBe(true);
    expect(response.object).toBe("chat.completion");
  });

  it("applies an override and keeps the rest", () => {
    const defaults = chatCompletionResponse();

    const response = chatCompletionResponse({ model: "llama-override" });

    expect(response.model).toBe("llama-override");
    expect(response.choices).toEqual(defaults.choices);
    expect(response.usage).toEqual(defaults.usage);
  });

  it("fails loudly on an override that breaks the contract", () => {
    expect(() => chatCompletionResponse({ choices: [] })).toThrow();
  });
});

describe("healthResponse", () => {
  it("US7-2: without arguments, validates against HealthResponseSchema", () => {
    const health = healthResponse();

    expect(HealthResponseSchema.safeParse(health).success).toBe(true);
    expect(health.status).toBe("ok");
    expect(health.checks).toBeUndefined();
  });

  it("applies an override and keeps the rest", () => {
    const defaults = healthResponse();

    const health = healthResponse({ version: "9.9.9" });

    expect(health.version).toBe("9.9.9");
    expect(health.uptimeMs).toBe(defaults.uptimeMs);
  });

  it("fails loudly on an override that breaks the contract", () => {
    // `degraded` without `checks` violates the health contract's refinement.
    expect(() => healthResponse({ status: "degraded" })).toThrow();
    expect(() => healthResponse({ version: "" })).toThrow();
  });
});
