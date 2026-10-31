import { APICallError, JSONParseError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { ProviderCompletionInput } from "../../src/application/ports/llm-provider.port.js";
import {
  millisecondsUnchecked,
  targetIdUnchecked,
  usdUnchecked,
} from "../../src/domain/model/units.js";
import { createAiSdkProvider } from "../../src/infrastructure/llm/ai-sdk-provider.js";

// research R-05 / R-06 cases no real provider body can produce, driven through the SDK's
// own mock model. The HTTP mapping itself is covered per provider with MSW.

const INPUT: ProviderCompletionInput = {
  target: {
    id: targetIdUnchecked("mock-target"),
    provider: "openai",
    model: "mock-model",
    region: "test",
    residency: "us",
    pricing: { inputUsdPerMillion: usdUnchecked(0), outputUsdPerMillion: usdUnchecked(0) },
  },
  messages: [{ role: "user", content: "Hi." }],
  timeoutMs: millisecondsUnchecked(1_000),
};

const USAGE = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

function adapterFor(doGenerate: MockLanguageModelV3["doGenerate"]) {
  return createAiSdkProvider({
    provider: "openai",
    languageModel: (modelId) => new MockLanguageModelV3({ modelId, doGenerate }),
  });
}

describe("createAiSdkProvider edge cases (R-05, R-06)", () => {
  it("treats finish reason error as malformed_response, not retryable", async () => {
    const adapter = adapterFor(async () => ({
      content: [{ type: "text", text: "partial" }],
      finishReason: { unified: "error", raw: "error" },
      usage: USAGE,
      warnings: [],
    }));

    const result = await adapter.complete(INPUT);

    expect(result).toMatchObject({
      ok: false,
      error: { cause: "malformed_response", retryable: false, targetId: "mock-target" },
    });
  });

  it("maps finish reason other to stop and uses the target model when the response has no model id", async () => {
    const adapter = adapterFor(async () => ({
      content: [{ type: "text", text: "done" }],
      finishReason: { unified: "other", raw: "weird" },
      usage: USAGE,
      warnings: [],
    }));

    const result = await adapter.complete(INPUT);

    expect(result).toEqual({
      ok: true,
      value: {
        text: "done",
        finishReason: "stop",
        usage: { promptTokens: 3, completionTokens: 2 },
        modelName: "mock-model",
      },
    });
  });

  it("maps an unknown thrown error to http_error, not retryable, without its message", async () => {
    const adapter = adapterFor(async () => {
      throw new Error("internal detail SECRET");
    });

    const result = await adapter.complete(INPUT);

    expect(result).toMatchObject({ ok: false, error: { cause: "http_error", retryable: false } });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("maps an APICallError without a status to network, retryable", async () => {
    const adapter = adapterFor(async () => {
      throw new APICallError({
        message: "Cannot connect to API: SECRET",
        url: "https://example.test/SECRET",
        requestBodyValues: { prompt: "SECRET" },
        isRetryable: true,
      });
    });

    const result = await adapter.complete(INPUT);

    expect(result).toMatchObject({ ok: false, error: { cause: "network", retryable: true } });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("maps a bare SDK parse error to malformed_response and a fetch TypeError to network", async () => {
    const parse = adapterFor(async () => {
      throw new JSONParseError({ text: "SECRET", cause: new Error("bad") });
    });
    const fetchFailure = adapterFor(async () => {
      throw new TypeError("fetch failed");
    });

    expect(await parse.complete(INPUT)).toMatchObject({
      ok: false,
      error: { cause: "malformed_response", retryable: false },
    });
    expect(await fetchFailure.complete(INPUT)).toMatchObject({
      ok: false,
      error: { cause: "network", retryable: true },
    });
  });

  it("forwards system, user and assistant messages in order", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: USAGE,
        warnings: [],
      },
    });
    const adapter = createAiSdkProvider({ provider: "openai", languageModel: () => model });

    await adapter.complete({
      ...INPUT,
      messages: [
        { role: "system", content: "S" },
        { role: "user", content: "U" },
        { role: "assistant", content: "A", toolCalls: [] },
        { role: "user", content: "U2" },
      ],
    });

    expect(model.doGenerateCalls[0]?.prompt.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
  });

  it("passes maxRetries 0 semantics: a retryable APICallError reaches the model once", async () => {
    let calls = 0;
    const adapter = adapterFor(async () => {
      calls += 1;
      throw new APICallError({
        message: "overloaded",
        url: "https://example.test",
        requestBodyValues: {},
        statusCode: 529,
        isRetryable: true,
      });
    });

    const result = await adapter.complete(INPUT);

    expect(calls).toBe(1);
    expect(result).toMatchObject({
      ok: false,
      error: { cause: "http_error", retryable: true, status: 529 },
    });
  });
});
