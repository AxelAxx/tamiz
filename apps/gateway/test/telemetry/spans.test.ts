import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import type { ProviderCompletionInput } from "../../src/application/ports/llm-provider.port.js";
import { providerError } from "../../src/domain/errors.js";
import { err, ok } from "../../src/domain/result.js";
import { fanOut } from "../../src/infrastructure/telemetry/fan-out.js";
import { AUTH, createTestApp, defaultPolicy } from "../helpers/app.js";
import { inspectAs } from "../helpers/privacy.js";
import { captureSpans } from "../helpers/tracing.js";

// Spec 006 US5-1 … US5-3, FR-009 (tasks.md T024).

const TEXT = "Hola, ¿qué tal?";

/** Default chain mistral-small → openai-mini → ollama-llama; the first one rejects the key. */
function failFirst(input: ProviderCompletionInput) {
  if (input.target.id === "mistral-small") {
    return err(
      providerError({
        targetId: input.target.id,
        provider: input.target.provider,
        cause: "authentication",
        retryable: false,
        message: "provider failed (HTTP 401)",
      }),
    );
  }
  return ok({
    text: "Resumen listo.",
    finishReason: "stop" as const,
    usage: { promptTokens: 30, completionTokens: 8 },
    modelName: `${input.target.model}-2026`,
  });
}

async function tracedRequest(
  options: Partial<Parameters<typeof createTestApp>[0]> = {},
  stream = false,
) {
  const capture = captureSpans();
  const { send } = await createTestApp({
    tracer: capture.tracer,
    events: capture.events,
    script: failFirst,
    ...options,
  });
  const response = await send("/v1/chat/completions", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      model: "tamiz-auto",
      stream,
      messages: [{ role: "user", content: TEXT }],
    }),
  });
  await response.text();
  return { capture, response };
}

function split(spans: ReadonlyArray<ReadableSpan>) {
  const request = spans.filter((s) => s.name === "tamiz.request");
  const attempts = spans.filter((s) => s.name.startsWith("chat "));
  return { request, attempts };
}

describe("spans of a request (spec 006 US5)", () => {
  it("US5-1: one request span, two attempt children, the first failed, and the fallback event", async () => {
    const { capture, response } = await tracedRequest();
    expect(response.status).toBe(200);
    const { request, attempts } = split(capture.spans());
    expect(request).toHaveLength(1);
    expect(attempts).toHaveLength(2);
    const root = request[0];
    if (root === undefined) throw new Error("no request span");
    expect(root.kind).toBe(SpanKind.SERVER);
    const spanId = root.spanContext().spanId;
    for (const attempt of attempts) {
      expect(attempt.parentSpanContext?.spanId).toBe(spanId);
      expect(attempt.spanContext().traceId).toBe(root.spanContext().traceId);
      expect(attempt.kind).toBe(SpanKind.CLIENT);
    }
    const [first, second] = [...attempts].sort((a, b) =>
      a.startTime[0] === b.startTime[0]
        ? a.startTime[1] - b.startTime[1]
        : a.startTime[0] - b.startTime[0],
    );
    expect(first?.name).toBe("chat mistral-small-latest");
    expect(first?.status.code).toBe(SpanStatusCode.ERROR);
    expect(first?.attributes["error.type"]).toBe("authentication");
    expect(second?.name).toBe("chat gpt-4o-mini");
    expect(second?.status.code).not.toBe(SpanStatusCode.ERROR);
    const fallback = root.events.find((e) => e.name === "routing.fallback");
    expect(fallback?.attributes).toEqual({ target: "mistral-small", reason: "authentication" });
  });

  it("US5-2: an attempt span carries the GenAI attributes", async () => {
    const { capture } = await tracedRequest();
    const served = split(capture.spans()).attempts.find((s) => s.name === "chat gpt-4o-mini");
    expect(served?.attributes).toMatchObject({
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "openai",
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o-mini",
      "gen_ai.response.model": "gpt-4o-mini-2026",
      "gen_ai.response.finish_reasons": ["stop"],
      "gen_ai.usage.input_tokens": 30,
      "gen_ai.usage.output_tokens": 8,
    });
  });

  it("US5-3: the request span carries the decision and a routing.decision event", async () => {
    const { capture } = await tracedRequest({
      inspect: inspectAs({
        status: "ok",
        level: "low",
        entities: [{ textIndex: 0, kind: "PHONE", start: 0, end: 4, score: 0.9 }],
      }),
    });
    const root = split(capture.spans()).request[0];
    expect(root?.attributes).toMatchObject({
      "tamiz.route": "openai-mini",
      "tamiz.rule": "default",
      "tamiz.sensitivity": "low",
      "tamiz.privacy.action": "allow",
      "tamiz.entities.PHONE": 1,
      "tamiz.fallbacks": 1,
      "tamiz.fallback.targets": ["mistral-small"],
      "tamiz.usage.input_tokens": 30,
      "tamiz.streamed": false,
    });
    expect(typeof root?.attributes["tamiz.cost_usd"]).toBe("number");
    const names = root?.events.map((e) => e.name) ?? [];
    expect(names).toEqual(
      expect.arrayContaining(["privacy.action", "routing.decision", "routing.fallback"]),
    );
    const decision = root?.events.find((e) => e.name === "routing.decision");
    expect(decision?.attributes).toMatchObject({
      rule: "default",
      action: "allow",
      chain: ["mistral-small", "openai-mini", "ollama-llama"],
    });
  });

  it("a blocked request is one failed request span with no attempt", async () => {
    const base = await defaultPolicy();
    const { capture, response } = await tracedRequest({
      inspect: inspectAs({ status: "failed", reason: "unavailable" }),
      policy: { ...base, privacy: { ...base.privacy, onDetectorError: "block" } },
    });
    expect(response.status).toBe(503);
    const { request, attempts } = split(capture.spans());
    expect(attempts).toHaveLength(0);
    expect(request[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(request[0]?.attributes["error.type"]).toBe("privacy_unavailable");
  });

  it("a stream's request span ends with the stream and carries its usage", async () => {
    const { capture, response } = await tracedRequest(
      {
        streamScript: async (input) => {
          const first = failFirst(input);
          if (!first.ok) return first;
          return ok({
            first: "Resumen",
            modelName: first.value.modelName,
            rest: (async function* () {
              yield {
                type: "finish" as const,
                finishReason: "stop" as const,
                usage: { promptTokens: 30, completionTokens: 8 },
              };
            })(),
          });
        },
      },
      true,
    );
    expect(response.status).toBe(200);
    const { request, attempts } = split(capture.spans());
    expect(attempts).toHaveLength(2);
    expect(request[0]?.attributes).toMatchObject({
      "tamiz.streamed": true,
      "tamiz.route": "openai-mini",
      "tamiz.usage.output_tokens": 8,
    });
  });

  it("a sink that throws does not stop the others", () => {
    const seen: string[] = [];
    const sinks = fanOut(
      {
        emit: () => {
          throw new Error("broken");
        },
      },
      { emit: (e) => void seen.push(e.type) },
    );
    sinks.emit({
      type: "audit.dropped",
      count: 1,
      reason: "queue_full",
      at: "2026-01-01T00:00:00Z",
    });
    expect(seen).toEqual(["audit.dropped"]);
  });
});
