import { readFileSync } from "node:fs";
import { delay, HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type {
  FinishReason,
  LlmProviderPort,
  ProviderCompletionInput,
} from "../../src/application/ports/llm-provider.port.js";
import type { ProviderError, ProviderErrorCause } from "../../src/domain/errors.js";
import type { ModelTarget, ProviderName } from "../../src/domain/model/model-target.js";
import {
  millisecondsUnchecked,
  targetIdUnchecked,
  usdUnchecked,
} from "../../src/domain/model/units.js";
import { useMswServer } from "./msw.js";

// The scenario list every provider adapter must satisfy (spec 002 US6, FR-014 … FR-017,
// tasks.md T027 … T030). Each `<provider>.adapter.test.ts` supplies the endpoint, the
// adapter and how to shape that provider's bodies.

export type JsonBody = Record<string, unknown>;

/** Credential and markers that must never appear in a returned error (FR-017). */
export const SECRET_API_KEY = "sk-test-SECRET-do-not-leak-0001";
const PROMPT_MARKER = "PROMPT-MARKER-confidential";
const BODY_MARKER = "UPSTREAM-BODY-MARKER";

export function loadFixture(name: string): JsonBody {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

export interface AdapterScenarioConfig {
  readonly provider: ProviderName;
  /** The upstream URL the adapter must call. */
  readonly url: string;
  /** The provider's model name used by the target. */
  readonly model: string;
  readonly createAdapter: () => LlmProviderPort;
  /** A minimal real-shaped success body. */
  readonly success: JsonBody;
  readonly expected: {
    readonly text: string;
    readonly modelName: string;
    readonly promptTokens: number;
    readonly completionTokens: number;
  };
  /** The success body with the provider's raw finish reason replaced. */
  readonly withFinishReason: (raw: string) => JsonBody;
  /** Raw provider finish reasons and the contract value each must map to. */
  readonly finishReasons: ReadonlyArray<readonly [raw: string, expected: FinishReason]>;
  /** The request-body field that carries `maxTokens`. */
  readonly maxTokensField: string;
  /** A body with two choices whose first text is `expected.text`; absent when the API has no choices. */
  readonly twoChoices?: JsonBody;
  /** The success body without `usage`; absent when the provider schema requires it. */
  readonly withoutUsage?: JsonBody;
  /** The status and cause of the "rejected request" case: 401 for keyed providers, 404 for Ollama. */
  readonly rejected: { readonly status: number; readonly cause: ProviderErrorCause };
}

const TARGET_ID = "target-under-test";

function targetFor(config: AdapterScenarioConfig): ModelTarget {
  return {
    id: targetIdUnchecked(TARGET_ID),
    provider: config.provider,
    model: config.model,
    region: "test",
    residency: "local",
    pricing: { inputUsdPerMillion: usdUnchecked(0), outputUsdPerMillion: usdUnchecked(0) },
  };
}

function inputFor(
  config: AdapterScenarioConfig,
  overrides: Partial<Pick<ProviderCompletionInput, "timeoutMs" | "temperature" | "maxTokens">> = {},
): ProviderCompletionInput {
  return {
    target: targetFor(config),
    messages: [
      { role: "system", content: "You are terse." },
      { role: "user", content: `Say hello. ${PROMPT_MARKER}` },
    ],
    timeoutMs: millisecondsUnchecked(5_000),
    ...overrides,
  };
}

function expectProviderError(
  error: ProviderError,
  config: AdapterScenarioConfig,
  expected: { cause: ProviderErrorCause; retryable: boolean; status?: number },
): void {
  expect(error).toMatchObject({
    kind: "provider",
    targetId: TARGET_ID,
    provider: config.provider,
    cause: expected.cause,
    retryable: expected.retryable,
  });
  expect(error.status).toBe(expected.status);
  const serialised = JSON.stringify(error);
  expect(serialised).not.toContain(SECRET_API_KEY);
  expect(serialised).not.toContain(PROMPT_MARKER);
  expect(serialised).not.toContain(BODY_MARKER);
}

function upstreamError(status: number): Response {
  return HttpResponse.json(
    { error: { message: `${BODY_MARKER} status ${status}`, type: "upstream_error" } },
    { status },
  );
}

export function describeAdapterScenarios(config: AdapterScenarioConfig): void {
  describe(`${config.provider} adapter (US6)`, () => {
    const server = useMswServer();

    /** Answers every call with `respond` and counts the calls; keeps the last request body. */
    function answer(respond: (request: Request) => Response | Promise<Response>) {
      const seen = { calls: 0, body: undefined as JsonBody | undefined };
      server.use(
        http.post(config.url, async ({ request }) => {
          seen.calls += 1;
          seen.body = (await request.clone().json()) as JsonBody;
          return respond(request);
        }),
      );
      return seen;
    }

    async function errorFrom(input = inputFor(config)): Promise<ProviderError> {
      const result = await config.createAdapter().complete(input);
      if (result.ok) throw new Error("expected a ProviderError, got a completion");
      return result.error;
    }

    it("normalises a success: text, finish reason, usage and model name (US6-1)", async () => {
      answer(() => HttpResponse.json(config.success));

      const result = await config.createAdapter().complete(inputFor(config));

      expect(result).toEqual({
        ok: true,
        value: {
          text: config.expected.text,
          finishReason: "stop",
          usage: {
            promptTokens: config.expected.promptTokens,
            completionTokens: config.expected.completionTokens,
          },
          modelName: config.expected.modelName,
        },
      });
    });

    it("maps 429 to rate_limited, retryable, status 429, called once (US6-2)", async () => {
      const seen = answer(() => upstreamError(429));

      expectProviderError(await errorFrom(), config, {
        cause: "rate_limited",
        retryable: true,
        status: 429,
      });
      expect(seen.calls).toBe(1);
    });

    it("maps 500 to http_error, retryable, status 500, called once: no SDK retries (US6-2)", async () => {
      const seen = answer(() => upstreamError(500));

      expectProviderError(await errorFrom(), config, {
        cause: "http_error",
        retryable: true,
        status: 500,
      });
      expect(seen.calls).toBe(1);
    });

    it(`maps ${config.rejected.status} to ${config.rejected.cause}, not retryable, no credential (US6-3)`, async () => {
      answer(() => upstreamError(config.rejected.status));

      expectProviderError(await errorFrom(), config, {
        cause: config.rejected.cause,
        retryable: false,
        status: config.rejected.status,
      });
    });

    it("maps 400 to http_error, not retryable (US6-3)", async () => {
      answer(() => upstreamError(400));

      expectProviderError(await errorFrom(), config, {
        cause: "http_error",
        retryable: false,
        status: 400,
      });
    });

    it("maps a stalled connection to timeout within the target timeout and aborts it (US6-4)", async () => {
      let aborted = false;
      answer(async (request) => {
        request.signal.addEventListener("abort", () => {
          aborted = true;
        });
        await delay("infinite");
        return HttpResponse.json(config.success);
      });

      const started = Date.now();
      const error = await errorFrom(inputFor(config, { timeoutMs: millisecondsUnchecked(200) }));
      const elapsed = Date.now() - started;

      expectProviderError(error, config, { cause: "timeout", retryable: true });
      expect(elapsed).toBeGreaterThanOrEqual(150);
      expect(elapsed).toBeLessThan(1_000);
      expect(aborted).toBe(true);
    });

    it("maps a connection failure to network, retryable (FR-015)", async () => {
      answer(() => HttpResponse.error());

      expectProviderError(await errorFrom(), config, { cause: "network", retryable: true });
    });

    it("maps a body of the wrong shape to malformed_response, not retryable, body absent (US6-5)", async () => {
      answer(() => HttpResponse.json({ nope: true, marker: BODY_MARKER }));

      expectProviderError(await errorFrom(), config, {
        cause: "malformed_response",
        retryable: false,
      });
    });

    it("maps a body that is not JSON to malformed_response (US6-5)", async () => {
      answer(
        () =>
          new HttpResponse(`<html>${BODY_MARKER}</html>`, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );

      expectProviderError(await errorFrom(), config, {
        cause: "malformed_response",
        retryable: false,
      });
    });

    it("forwards temperature and max tokens, and never a user field (US6-7)", async () => {
      const seen = answer(() => HttpResponse.json(config.success));

      await config.createAdapter().complete(inputFor(config, { temperature: 0.3, maxTokens: 64 }));

      expect(seen.body).toMatchObject({ temperature: 0.3, [config.maxTokensField]: 64 });
      expect(seen.body).not.toHaveProperty("user");
      expect(seen.body?.["model"]).toBe(config.model);
    });

    it("omits temperature when the request has none", async () => {
      const seen = answer(() => HttpResponse.json(config.success));

      await config.createAdapter().complete(inputFor(config));

      expect(seen.body).not.toHaveProperty("temperature");
    });

    it.each(config.finishReasons)(
      "maps finish reason %s to %s (FR-016; tool_calls since the 009 tool-calling addendum)",
      async (raw, expected) => {
        answer(() => HttpResponse.json(config.withFinishReason(raw)));

        const result = await config.createAdapter().complete(inputFor(config));

        expect(result.ok && result.value.finishReason).toBe(expected);
      },
    );

    const { twoChoices, withoutUsage } = config;
    if (twoChoices !== undefined) {
      it("returns the first choice when the body has two (edge case)", async () => {
        answer(() => HttpResponse.json(twoChoices));

        const result = await config.createAdapter().complete(inputFor(config));

        expect(result.ok && result.value.text).toBe(config.expected.text);
      });
    }

    if (withoutUsage !== undefined) {
      it("leaves usage absent when the provider omits it (T-002-07 estimates it)", async () => {
        answer(() => HttpResponse.json(withoutUsage));

        const result = await config.createAdapter().complete(inputFor(config));

        expect(result.ok).toBe(true);
        expect(result.ok && result.value).not.toHaveProperty("usage");
      });
    }
  });
}

/** Builders for the OpenAI chat-completion shape shared by OpenAI, Mistral and Ollama. */
export function chatCompletionShape(success: JsonBody) {
  const choices = success["choices"] as ReadonlyArray<JsonBody>;
  const first = choices[0] as JsonBody;
  const { usage: _usage, ...withoutUsage } = success;
  return {
    withFinishReason: (raw: string): JsonBody => ({
      ...success,
      choices: [{ ...first, finish_reason: raw }],
    }),
    twoChoices: {
      ...success,
      choices: [
        first,
        { ...first, index: 1, message: { role: "assistant", content: "Second choice." } },
      ],
    },
    withoutUsage,
  };
}
