import { describe, expect, it } from "vitest";
import type {
  ProviderCompletionInput,
  StreamPart,
} from "../src/application/ports/llm-provider.port.js";
import type { RoutingEvent } from "../src/application/ports/routing-events.port.js";
import type { RoutingPolicy } from "../src/domain/model/routing-policy.js";
import type { DetectedEntity, Inspection } from "../src/domain/model/sensitivity.js";
import { err, ok } from "../src/domain/result.js";
import { AUTH, type CompletionResult, createTestApp, defaultPolicy } from "./helpers/app.js";
import { inspectAs } from "./helpers/privacy.js";
import { failure } from "./resilience/helpers.js";

// Spec 005 US1-1 … US1-6, US2-1, US2-3, US2-4, US2-6, US3-1, US3-4, FR-011 … FR-015
// (tasks.md T027, T028): the whole request path with the default policy (research R-11),
// a scripted privacy inspection and scripted providers.

const DNI_TEXT = "Mi DNI es 12345678Z, ¿qué trámites necesito?";
const NAMES_TEXT = "Escribe a Ana Ruiz (ana@example.com) sobre el contrato.";

function entity(messageIndex: number, text: string, kind: DetectedEntity["kind"], value: string) {
  const start = text.indexOf(value);
  return { messageIndex, kind, start, end: start + value.length, score: 0.9 };
}

const CRITICAL: Inspection = {
  status: "ok",
  level: "critical",
  entities: [entity(0, DNI_TEXT, "DNI", "12345678Z")],
};

function highFor(messages: ReadonlyArray<string>): Inspection {
  const entities: DetectedEntity[] = [];
  messages.forEach((text, index) => {
    for (const [kind, value] of [
      ["PERSON", "Ana Ruiz"],
      ["EMAIL", "ana@example.com"],
    ] as const) {
      if (text.includes(value)) entities.push(entity(index, text, kind, value));
    }
  });
  return { status: "ok", level: entities.length > 0 ? "high" : "none", entities };
}

function body(content: string | ReadonlyArray<{ role: string; content: string }>, extra = {}) {
  const messages = typeof content === "string" ? [{ role: "user", content }] : content;
  return {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ model: "tamiz-auto", messages, ...extra }),
  };
}

const echo = (input: ProviderCompletionInput): CompletionResult =>
  ok({
    text: input.messages.at(-1)?.content ?? "",
    finishReason: "stop",
    usage: { promptTokens: 40, completionTokens: 10 },
    modelName: input.target.model,
  });

function recorder() {
  const events: RoutingEvent[] = [];
  return { events, emit: (event: RoutingEvent) => void events.push(event) };
}

async function policyWith(privacy: Partial<RoutingPolicy["privacy"]>): Promise<RoutingPolicy> {
  const base = await defaultPolicy();
  return { ...base, privacy: { ...base.privacy, ...privacy } };
}

describe("privacy-aware routing (default policy)", () => {
  it("US1-1: a DNI keeps the request on the local model, with the privacy headers", async () => {
    const { send, provider } = await createTestApp({ inspect: inspectAs(CRITICAL), script: echo });

    const response = await send("/v1/chat/completions", body(DNI_TEXT));

    expect(response.status).toBe(200);
    expect(provider.calls.map((call) => call.target.id)).toEqual(["ollama-llama"]);
    expect(response.headers.get("x-tamiz-sensitivity")).toBe("critical");
    expect(response.headers.get("x-tamiz-privacy")).toBe("restrict_to_local");
    expect(response.headers.get("x-tamiz-route")).toBe("ollama-llama");
  });

  it("US1-2: a request without personal data routes as in feature 003", async () => {
    const { send, provider } = await createTestApp({ script: echo });

    const response = await send("/v1/chat/completions", body("¿Qué tiempo hará mañana?"));

    expect(provider.calls[0]?.target.id).toBe("mistral-small");
    expect(response.headers.get("x-tamiz-sensitivity")).toBe("none");
    expect(response.headers.get("x-tamiz-privacy")).toBe("allow");
  });

  it("US1-3: action `block` → 451 policy_blocked naming level and action, no provider call", async () => {
    const policy = await policyWith({
      levels: { ...(await defaultPolicy()).privacy.levels, critical: { action: "block" } },
    });
    const { send, provider } = await createTestApp({ policy, inspect: inspectAs(CRITICAL) });

    const response = await send("/v1/chat/completions", body(DNI_TEXT));

    expect(response.status).toBe(451);
    const envelope = (await response.json()) as { error: { type: string; message: string } };
    expect(envelope.error.type).toBe("policy_blocked");
    expect(envelope.error.message).toBe("sensitivity critical: action block (rule default)");
    expect(provider.calls).toHaveLength(0);
    expect(response.headers.get("x-tamiz-privacy")).toBe("block");
    expect(JSON.stringify(envelope)).not.toContain("12345678Z");
  });

  it("US1-4: the level's residencies remove the US targets of the rule's chain", async () => {
    const code = "Revisa este código de Ana Ruiz:\n```ts\nconst x = 1;\n```";
    const { send, provider } = await createTestApp({
      inspect: inspectAs(highFor),
      script: echo,
    });

    const response = await send("/v1/chat/completions", body(code));

    expect(response.headers.get("x-tamiz-rule")).toBe("code-to-frontier");
    expect(provider.calls.map((call) => call.target.id)).toEqual(["mistral-small"]);
  });

  it("US1-5: nothing left after filtering → 451, no provider call", async () => {
    const policy = await policyWith({
      levels: {
        ...(await defaultPolicy()).privacy.levels,
        high: { action: "anonymize", residency: ["global"] },
      },
    });
    const { send, provider } = await createTestApp({ policy, inspect: inspectAs(highFor) });

    const response = await send("/v1/chat/completions", body(NAMES_TEXT));

    expect(response.status).toBe(451);
    const envelope = (await response.json()) as { error: { message: string } };
    expect(envelope.error.message).toBe("sensitivity high: no allowed target (rule default)");
    expect(provider.calls).toHaveLength(0);
  });

  it("US1-6: when the local model fails, nothing falls back outside local", async () => {
    const { send, provider } = await createTestApp({
      inspect: inspectAs(CRITICAL),
      script: (input) => err(failure("http_error", { status: 503, on: input.target })),
    });

    const response = await send("/v1/chat/completions", body(DNI_TEXT));

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(new Set(provider.calls.map((call) => call.target.id))).toEqual(
      new Set(["ollama-llama"]),
    );
  });

  it("US2-1, US2-4: the provider sees placeholders in every role and the notice first", async () => {
    const messages = [
      { role: "system", content: "Asistente de Ana Ruiz." },
      { role: "user", content: NAMES_TEXT },
      { role: "assistant", content: "¿Algo más para ana@example.com?" },
      { role: "user", content: "Sí, a Ana Ruiz otra vez." },
    ];
    const { send, provider } = await createTestApp({ inspect: inspectAs(highFor), script: echo });

    const response = await send("/v1/chat/completions", body(messages));

    expect(response.status).toBe(200);
    const sent = provider.calls[0]?.messages ?? [];
    expect(sent[0]).toEqual({
      role: "system",
      content: "Keep every <KIND_n> placeholder exactly as written.",
    });
    expect(sent.slice(1).map((m) => m.content)).toEqual([
      "Asistente de <PERSON_1>.",
      "Escribe a <PERSON_1> (<EMAIL_1>) sobre el contrato.",
      "¿Algo más para <EMAIL_1>?",
      "Sí, a <PERSON_1> otra vez.",
    ]);
    const serialized = JSON.stringify(provider.calls);
    expect(serialized).not.toContain("Ana Ruiz");
    expect(serialized).not.toContain("ana@example.com");
    expect(response.headers.get("x-tamiz-privacy")).toBe("anonymize;notice=v1");
  });

  it("US2-3, US2-6: the answer is restored for the client; usage is the provider's", async () => {
    const { send } = await createTestApp({
      inspect: inspectAs(highFor),
      script: (input) =>
        ok({
          text: "Hecho: <PERSON_1> recibirá el correo en <EMAIL_1>; <PERSON_9> no existe.",
          finishReason: "stop",
          usage: { promptTokens: 40, completionTokens: 10 },
          modelName: input.target.model,
        }),
    });

    const response = await send("/v1/chat/completions", body(NAMES_TEXT));
    const json = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number; cost_usd: number };
    };

    expect(json.choices[0]?.message.content).toBe(
      "Hecho: Ana Ruiz recibirá el correo en ana@example.com; <PERSON_9> no existe.",
    );
    expect(json.usage.prompt_tokens).toBe(40);
    expect(json.usage.completion_tokens).toBe(10);
    // mistral-small: 0.1 / 0.3 USD per million tokens.
    expect(json.usage.cost_usd).toBeCloseTo((40 * 0.1 + 10 * 0.3) / 1e6, 12);
  });

  it("US3-1: a failed inspection routes locally with sensitivity `unknown`", async () => {
    const events = recorder();
    const { send, provider } = await createTestApp({
      inspect: inspectAs({ status: "failed", reason: "unavailable" }),
      script: echo,
      events,
    });

    const response = await send("/v1/chat/completions", body("Hola"));

    expect(provider.calls.map((call) => call.target.id)).toEqual(["ollama-llama"]);
    expect(response.headers.get("x-tamiz-sensitivity")).toBe("unknown");
    expect(response.headers.get("x-tamiz-privacy")).toBe("restrict_to_local");
    expect(events.events).toContainEqual(
      expect.objectContaining({
        type: "privacy.action",
        sensitivity: "unknown",
        action: "restrict_to_local",
      }),
    );
  });

  it("US3-4: a failed inspection with `onDetectorError: block` → 503 privacy_unavailable", async () => {
    const policy = await policyWith({ onDetectorError: "block" });
    const { send, provider } = await createTestApp({
      policy,
      inspect: inspectAs({ status: "failed", reason: "timeout" }),
    });

    const response = await send("/v1/chat/completions", body("Hola"));

    expect(response.status).toBe(503);
    const envelope = (await response.json()) as { error: { type: string } };
    expect(envelope.error.type).toBe("privacy_unavailable");
    expect(provider.calls).toHaveLength(0);
    expect(response.headers.get("x-tamiz-sensitivity")).toBe("unknown");
  });

  it("FR-015: privacy events carry counts and actions, never values", async () => {
    const events = recorder();
    const { send } = await createTestApp({ inspect: inspectAs(highFor), script: echo, events });

    await send("/v1/chat/completions", body(NAMES_TEXT));

    expect(events.events).toContainEqual(
      expect.objectContaining({ type: "privacy.anonymized", placeholders: 2 }),
    );
    expect(JSON.stringify(events.events)).not.toContain("Ana Ruiz");
  });

  it("streams of anonymized requests are restored and carry the privacy headers", async () => {
    async function* rest(): AsyncGenerator<StreamPart> {
      yield { type: "delta", text: " para <PERSON_1>" };
      yield {
        type: "finish",
        finishReason: "stop",
        usage: { promptTokens: 9, completionTokens: 4 },
      };
    }
    const streamed: ProviderCompletionInput[] = [];
    const { send } = await createTestApp({
      inspect: inspectAs(highFor),
      streamScript: async (input) => {
        streamed.push(input);
        return ok({ first: "Respuesta", modelName: input.target.model, rest: rest() });
      },
    });

    const response = await send("/v1/chat/completions", body(NAMES_TEXT, { stream: true }));
    const text = await response.text();

    expect(response.headers.get("x-tamiz-privacy")).toBe("anonymize;notice=v1");
    expect(text).toContain(" para Ana Ruiz");
    expect(JSON.stringify(streamed)).not.toContain("Ana Ruiz");
  });

  it("a blocked stream gets the JSON error and no stream starts", async () => {
    const policy = await policyWith({
      levels: { ...(await defaultPolicy()).privacy.levels, critical: { action: "block" } },
    });
    const { send } = await createTestApp({
      policy,
      inspect: inspectAs(CRITICAL),
      streamScript: async () => {
        throw new Error("no stream may start");
      },
    });

    const response = await send("/v1/chat/completions", body(DNI_TEXT, { stream: true }));

    expect(response.status).toBe(451);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
