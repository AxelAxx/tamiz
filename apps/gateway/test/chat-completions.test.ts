import { ChatCompletionResponseSchema, ErrorEnvelopeSchema } from "@tamiz/contracts";
import { createFakeClock } from "@tamiz/test-utils";
import { describe, expect, it } from "vitest";
import type { ProviderCompletionInput } from "../src/application/ports/llm-provider.port.js";
import { classifyTask } from "../src/application/use-cases/classify-task.js";
import type { RouteInference } from "../src/application/use-cases/route-inference.js";
import { providerError, residencyViolationError } from "../src/domain/errors.js";
import { decide } from "../src/domain/model/routing-decision.js";
import { millisecondsUnchecked, targetIdUnchecked } from "../src/domain/model/units.js";
import { err, ok } from "../src/domain/result.js";
import { createInMemoryCircuitState } from "../src/infrastructure/cache/in-memory-circuit-state.js";
import { createLogger } from "../src/infrastructure/logging/logger.js";
import { createLogRoutingEvents } from "../src/infrastructure/telemetry/log-routing-events.js";
import { createApp } from "../src/presentation/app.js";
import {
  AUTH,
  createTestApp,
  DEMO_KEY,
  DEMO_KEY_HASH,
  defaultPolicy,
  START,
} from "./helpers/app.js";
import { noopLogger } from "./helpers/noop-logger.js";

/** The real pino logger writing to memory: what an operator would actually see. */
function capturedLogger() {
  const chunks: string[] = [];
  const logger = createLogger({
    level: "info",
    destination: { write: (chunk: string) => void chunks.push(chunk) },
  });
  return { logger, output: () => chunks.join("") };
}

// Spec 002 US1-1 … US1-4, US1-6, US2-4, US5-1 … US5-3, US5-5, FR-024 … FR-027, FR-029,
// FR-032, SC-007 (tasks.md T052). In-process with `app.request()` and a scripted provider.

function post(body: unknown, headers: Record<string, string> = AUTH): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

const VALID = {
  model: "tamiz-auto",
  messages: [{ role: "user", content: "Hola, ¿qué tal?" }],
} as const;

async function envelope(response: Response) {
  return ErrorEnvelopeSchema.parse(await response.json());
}

describe("POST /v1/chat/completions", () => {
  it("US1-1, US1-2, FR-025: answers 200 with a contract body and the routing headers", async () => {
    const { app, provider } = await createTestApp();

    const response = await app.request(
      "/v1/chat/completions",
      post(VALID, { ...AUTH, "x-request-id": "req-abc" }),
    );

    expect(response.status).toBe(200);
    const body = ChatCompletionResponseSchema.parse(await response.json());
    const { cost_usd, ...tokens } = body.usage;
    expect({ ...body, usage: tokens }).toEqual({
      id: "chatcmpl-req-abc",
      object: "chat.completion",
      created: Math.floor(Date.parse("2026-05-06T07:08:09.000Z") / 1000),
      model: "mistral-small-latest-served",
      choices: [
        { index: 0, message: { role: "assistant", content: "Hola." }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, estimated: false },
    });
    // US7-5: mistral-small is priced 0.1 / 0.3 USD per million in policies/default.yaml.
    expect(cost_usd).toBeCloseTo((12 * 0.1 + 3 * 0.3) / 1e6, 12);
    expect(response.headers.get("x-tamiz-route")).toBe("mistral-small");
    expect(response.headers.get("x-tamiz-rule")).toBe("default");
    expect(response.headers.get("x-request-id")).toBe("req-abc");
    expect(provider.calls).toHaveLength(1);
  });

  it("forwards temperature and max_tokens and never the user field (US6-7)", async () => {
    const { app, provider } = await createTestApp();

    await app.request(
      "/v1/chat/completions",
      post({ ...VALID, temperature: 0.4, max_tokens: 50, user: "someone@example.com" }),
    );

    expect(provider.calls[0]).toMatchObject({ temperature: 0.4, maxTokens: 50 });
    expect(JSON.stringify(provider.calls[0])).not.toContain("someone@example.com");
  });

  it("US7-4: estimates and flags usage when the provider omits it, and prices the estimate", async () => {
    const { app } = await createTestApp({
      script: () => ({
        ok: true,
        value: { text: "abcdefgh", finishReason: "length", modelName: "m" },
      }),
    });

    const body = ChatCompletionResponseSchema.parse(
      await (await app.request("/v1/chat/completions", post(VALID))).json(),
    );

    // "Hola, ¿qué tal?" is 15 characters → 4 tokens; "abcdefgh" → 2 tokens.
    const { cost_usd, ...tokens } = body.usage;
    expect(tokens).toEqual({
      prompt_tokens: 4,
      completion_tokens: 2,
      total_tokens: 6,
      estimated: true,
    });
    expect(cost_usd).toBeCloseTo((4 * 0.1 + 2 * 0.3) / 1e6, 12);
    expect(body.choices[0]?.finish_reason).toBe("length");
  });

  it("US7-2: a zero-priced local target costs exactly 0", async () => {
    const { app } = await createTestApp();

    const response = await app.request(
      "/v1/chat/completions",
      post({ ...VALID, model: "tamiz-local" }),
    );

    expect(response.headers.get("x-tamiz-route")).toBe("ollama-llama");
    const body = ChatCompletionResponseSchema.parse(await response.json());
    expect(body.usage.cost_usd).toBe(0);
  });

  it.each([
    ["an unknown field", { ...VALID, tools: [] }, "tools"],
    ["a wrong type", { ...VALID, temperature: "hot-SECRET" }, "temperature"],
    ["empty messages", { ...VALID, messages: [] }, "messages"],
    [
      'stream: "yes" (not a boolean; true streams since spec 003)',
      { ...VALID, stream: "yes" },
      "stream",
    ],
  ])(
    "US1-3: rejects %s with 400 invalid_request, no values, no routing headers",
    async (_n, body, path) => {
      const { app, provider } = await createTestApp();

      const response = await app.request("/v1/chat/completions", post(body));

      expect(response.status).toBe(400);
      const { error } = await envelope(response);
      expect(error.type).toBe("invalid_request");
      expect(error.message).toContain(path);
      expect(error.message).not.toContain("SECRET");
      expect(error.requestId).toBeDefined();
      expect(response.headers.get("x-tamiz-route")).toBeNull();
      expect(response.headers.get("x-tamiz-rule")).toBeNull();
      expect(provider.calls).toHaveLength(0);
    },
  );

  it("rejects a body that is not JSON with 400 invalid_request", async () => {
    const { app } = await createTestApp();

    const response = await app.request("/v1/chat/completions", post("{not json"));

    expect(response.status).toBe(400);
    expect((await envelope(response)).error.type).toBe("invalid_request");
  });

  it("rejects a body that is not declared as JSON with 400 invalid_request", async () => {
    const { app, provider } = await createTestApp();

    const response = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { ...AUTH, "content-type": "text/plain" },
      body: JSON.stringify(VALID),
    });

    expect(response.status).toBe(400);
    expect((await envelope(response)).error.type).toBe("invalid_request");
    expect(provider.calls).toHaveLength(0);
  });

  it("FR-032: rejects a body over 1 MiB with 400 invalid_request", async () => {
    const { app, provider } = await createTestApp();
    const huge = { ...VALID, messages: [{ role: "user", content: "x".repeat(1_153_434) }] };

    const response = await app.request("/v1/chat/completions", post(huge));

    expect(response.status).toBe(400);
    expect((await envelope(response)).error.type).toBe("invalid_request");
    expect(provider.calls).toHaveLength(0);
  });

  it("US1-4: an unknown model name falls through to the default chain", async () => {
    const { app } = await createTestApp();

    const response = await app.request("/v1/chat/completions", post({ ...VALID, model: "gpt-4o" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-tamiz-rule")).toBe("default");
  });

  it("US2-4: the default policy routes code to the frontier rule", async () => {
    const { app } = await createTestApp();

    const response = await app.request(
      "/v1/chat/completions",
      post({
        ...VALID,
        messages: [{ role: "user", content: "escribe una función en python que ordene una lista" }],
      }),
    );

    expect(response.headers.get("x-tamiz-rule")).toBe("code-to-frontier");
    expect(response.headers.get("x-tamiz-route")).toBe("anthropic-sonnet");
  });

  it.each([
    ["http_error", 502, "provider_error"],
    ["rate_limited", 502, "provider_error"],
    ["timeout", 504, "provider_timeout"],
  ] as const)(
    "US1-4, US1-6: every target failing with %s → %i %s, last target and the earlier ones in the headers",
    async (cause, status, type) => {
      const { send } = await createTestApp({
        script: (input) =>
          err(
            providerError({
              targetId: input.target.id,
              provider: input.target.provider,
              cause,
              retryable: true,
              message: "provider failed (HTTP 500)",
            }),
          ),
      });

      const response = await send("/v1/chat/completions", post(VALID));

      expect(response.status).toBe(status);
      const { error } = await envelope(response);
      expect(error.type).toBe(type);
      expect(JSON.stringify(error)).not.toMatch(/at .*\.ts/);
      // Default chain: mistral-small → openai-mini → ollama-llama.
      expect(response.headers.get("x-tamiz-route")).toBe("ollama-llama");
      expect(response.headers.get("x-tamiz-rule")).toBe("default");
      expect(response.headers.get("x-tamiz-fallback")).toBe(
        `mistral-small:${cause},openai-mini:${cause}`,
      );
    },
  );
});

describe("resilience on the endpoint (spec 003)", () => {
  const failOn =
    (ids: ReadonlyArray<string>, cause: "http_error" | "authentication" = "http_error") =>
    (input: ProviderCompletionInput) =>
      ids.includes(input.target.id)
        ? err(
            providerError({
              targetId: input.target.id,
              provider: input.target.provider,
              cause,
              retryable: cause === "http_error",
              message: "provider failed",
              ...(cause === "http_error" ? { status: 503 } : { status: 401 }),
            }),
          )
        : ok({
            text: "Hola.",
            finishReason: "stop" as const,
            usage: { promptTokens: 12, completionTokens: 3 },
            modelName: `${input.target.model}-served`,
          });

  it("US1-1: a failing primary falls back; 200 with route and fallback headers", async () => {
    const { send, provider } = await createTestApp({ script: failOn(["mistral-small"]) });

    const response = await send("/v1/chat/completions", post(VALID));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-tamiz-route")).toBe("openai-mini");
    expect(response.headers.get("x-tamiz-fallback")).toBe("mistral-small:http_error");
    expect(provider.calls.map((call) => call.target.id)).toEqual([
      "mistral-small",
      "mistral-small",
      "openai-mini",
    ]);
  });

  it("US1-2: a rejected credential is not retried and is reported as authentication", async () => {
    const { send, provider } = await createTestApp({
      script: failOn(["mistral-small"], "authentication"),
    });

    const response = await send("/v1/chat/completions", post(VALID));

    expect(response.headers.get("x-tamiz-fallback")).toBe("mistral-small:authentication");
    expect(provider.calls.map((call) => call.target.id)).toEqual(["mistral-small", "openai-mini"]);
  });

  it("US1-3: no fallback, no x-tamiz-fallback header", async () => {
    const { send } = await createTestApp();

    const response = await send("/v1/chat/completions", post(VALID));

    expect(response.status).toBe(200);
    expect(response.headers.has("x-tamiz-fallback")).toBe(false);
  });

  it("US1-5: model and cost are the answering target's", async () => {
    const { send } = await createTestApp({ script: failOn(["mistral-small"]) });

    const body = ChatCompletionResponseSchema.parse(
      await (await send("/v1/chat/completions", post(VALID))).json(),
    );

    expect(body.model).toBe("gpt-4o-mini-served");
    // openai-mini: 0.15 / 0.6 USD per million tokens.
    expect(body.usage.cost_usd).toBeCloseTo((12 * 0.15 + 3 * 0.6) / 1e6, 12);
  });

  it("US2-1: a residency violation → 451 policy_blocked with policy data only", async () => {
    const policy = await defaultPolicy();
    const blocked: RouteInference = async (request) => {
      const decision = decide(policy, { ...classifyTask(request) });
      const target = decision.chain[1];
      if (target === undefined) throw new Error("the default chain has two targets");
      return err({
        decision,
        failure: {
          kind: "residency",
          target,
          error: residencyViolationError({
            ruleId: decision.ruleId,
            targetId: target.id,
            residency: target.residency,
            allowed: ["eu", "local"],
          }),
          abandoned: [{ targetId: decision.chain[0]?.id ?? target.id, reason: "timeout" }],
        },
      });
    };
    const app = createApp({
      clock: createFakeClock(START),
      version: "0.1.0",
      startedAt: START,
      logger: noopLogger,
      routeInference: blocked,
      streamInference: () => Promise.reject(new Error("not streamed")),
      authenticate: (key) => (key === DEMO_KEY ? "demo" : undefined),
    });

    const response = await app.request("/v1/chat/completions", post(VALID));

    expect(response.status).toBe(451);
    const { error } = await envelope(response);
    expect(error.type).toBe("policy_blocked");
    expect(error.message).toBe("rule default does not allow residency us (target openai-mini)");
    expect(error.message).not.toContain("Hola");
    expect(response.headers.get("x-tamiz-route")).toBe("openai-mini");
    expect(response.headers.get("x-tamiz-fallback")).toBe("mistral-small:timeout");
  });

  it("US4-7: every circuit open → 503 provider_unavailable with retry-after in whole seconds", async () => {
    const clock = createFakeClock(START);
    const circuitState = createInMemoryCircuitState(clock);
    for (const id of ["mistral-small", "openai-mini", "ollama-llama"]) {
      await circuitState.open(targetIdUnchecked(id), millisecondsUnchecked(30_000));
    }
    const { send, provider, clock: appClock } = await createTestApp({ circuitState });
    appClock.set(new Date(START.getTime() + 500));

    const response = await send("/v1/chat/completions", post(VALID));

    expect(response.status).toBe(503);
    expect((await envelope(response)).error.type).toBe("provider_unavailable");
    // 29.5 s left, rounded up.
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("x-tamiz-route")).toBe("ollama-llama");
    expect(response.headers.get("x-tamiz-fallback")).toBe(
      "mistral-small:circuit_open,openai-mini:circuit_open",
    );
    expect(provider.calls).toHaveLength(0);
  });

  it("US5-3: the log output of a failing, falling-back request holds no message content", async () => {
    const captured = capturedLogger();
    const { send } = await createTestApp({
      script: failOn(["mistral-small"]),
      logger: captured.logger,
      events: createLogRoutingEvents(captured.logger),
    });

    await send(
      "/v1/chat/completions",
      post({ ...VALID, messages: [{ role: "user", content: "PROMPT-MARKER confidential" }] }),
    );

    const output = captured.output();
    expect(output).toContain('"event":"fallback"');
    expect(output).not.toContain("PROMPT-MARKER");
    expect(output).not.toContain(DEMO_KEY);
  });
});

describe("API key authentication (US5)", () => {
  it.each([
    ["no Authorization header", {}],
    ["a Basic scheme", { authorization: `Basic ${DEMO_KEY}` }],
    ["Bearer without a key", { authorization: "Bearer " }],
  ])("US5-1: %s → 401 unauthorized and no provider call", async (_name, headers) => {
    const { app, provider } = await createTestApp();

    const response = await app.request("/v1/chat/completions", post(VALID, headers));

    expect(response.status).toBe(401);
    expect((await envelope(response)).error.type).toBe("unauthorized");
    expect(response.headers.get("x-tamiz-route")).toBeNull();
    expect(provider.calls).toHaveLength(0);
  });

  it("US5-2: an unknown key → 401, and the log output holds neither the key nor a hash", async () => {
    const captured = capturedLogger();
    const { app } = await createTestApp({ logger: captured.logger });
    const unknown = "tmz_unknown-key-SECRET-0000000000000000000000000";

    const response = await app.request(
      "/v1/chat/completions",
      post(VALID, { authorization: `Bearer ${unknown}` }),
    );

    expect(response.status).toBe(401);
    const logged = captured.output();
    expect(logged).toContain("request completed");
    expect(logged).not.toContain(unknown);
    expect(logged).not.toContain(DEMO_KEY_HASH);
  });

  it("US5-3: a valid key → 200, and the log line names the client but not the key", async () => {
    const captured = capturedLogger();
    const { app } = await createTestApp({ logger: captured.logger });

    const response = await app.request("/v1/chat/completions", post(VALID));

    expect(response.status).toBe(200);
    const line = JSON.parse(captured.output().trim()) as Record<string, unknown>;
    expect(line).toMatchObject({
      msg: "request completed",
      clientId: "demo",
      route: "mistral-small",
    });
    expect(captured.output()).not.toContain(DEMO_KEY);
  });

  it("US5-5: GET /health needs no key", async () => {
    const { app } = await createTestApp();

    expect((await app.request("/health")).status).toBe(200);
  });
});

describe("latency (SC-007)", () => {
  it("serves 200 requests with an instant provider at p95 under 20 ms", async () => {
    const { app } = await createTestApp();
    const durations: number[] = [];

    for (let i = 0; i < 200; i += 1) {
      const started = performance.now();
      const response = await app.request("/v1/chat/completions", post(VALID));
      durations.push(performance.now() - started);
      expect(response.status).toBe(200);
    }

    durations.sort((a, b) => a - b);
    expect(durations[Math.floor(durations.length * 0.95)]).toBeLessThan(20);
  });
});
