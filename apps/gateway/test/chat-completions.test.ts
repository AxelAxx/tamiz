import { ChatCompletionResponseSchema, ErrorEnvelopeSchema } from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import { providerError } from "../src/domain/errors.js";
import { err } from "../src/domain/result.js";
import { createLogger } from "../src/infrastructure/logging/logger.js";
import { AUTH, createTestApp, DEMO_KEY, DEMO_KEY_HASH } from "./helpers/app.js";

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
    expect(body).toEqual({
      id: "chatcmpl-req-abc",
      object: "chat.completion",
      created: Math.floor(Date.parse("2026-05-06T07:08:09.000Z") / 1000),
      model: "mistral-small-latest-served",
      choices: [
        { index: 0, message: { role: "assistant", content: "Hola." }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    });
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

  it("reports zero usage when the provider omits it (until T-002-07)", async () => {
    const { app } = await createTestApp({
      script: () => ({ ok: true, value: { text: "x", finishReason: "length", modelName: "m" } }),
    });

    const body = ChatCompletionResponseSchema.parse(
      await (await app.request("/v1/chat/completions", post(VALID))).json(),
    );

    expect(body.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    expect(body.choices[0]?.finish_reason).toBe("length");
  });

  it.each([
    ["an unknown field", { ...VALID, tools: [] }, "tools"],
    ["a wrong type", { ...VALID, temperature: "hot-SECRET" }, "temperature"],
    ["empty messages", { ...VALID, messages: [] }, "messages"],
    ["stream: true", { ...VALID, stream: true }, "stream"],
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
    "US1-6: a provider %s maps to %i %s with the routing headers",
    async (cause, status, type) => {
      const { app } = await createTestApp({
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

      const response = await app.request("/v1/chat/completions", post(VALID));

      expect(response.status).toBe(status);
      const { error } = await envelope(response);
      expect(error.type).toBe(type);
      expect(JSON.stringify(error)).not.toMatch(/at .*\.ts/);
      expect(response.headers.get("x-tamiz-route")).toBe("mistral-small");
      expect(response.headers.get("x-tamiz-rule")).toBe("default");
    },
  );
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
