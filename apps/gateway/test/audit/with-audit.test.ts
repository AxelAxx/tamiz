import { createHmac, randomUUID } from "node:crypto";
import { AuditEntrySchema } from "@tamiz/contracts";
import { createFakeClock, createInMemoryPolicyRepository } from "@tamiz/test-utils";
import { describe, expect, it } from "vitest";
import { withAuditStream } from "../../src/application/audit/with-audit.js";
import type { StreamPart } from "../../src/application/ports/llm-provider.port.js";
import type { RoutedStreamPart } from "../../src/application/use-cases/stream-inference.js";
import type { Inspection } from "../../src/domain/model/sensitivity.js";
import { clientIdUnchecked, requestIdUnchecked } from "../../src/domain/model/units.js";
import { err, ok } from "../../src/domain/result.js";
import { createInMemoryAuditLog } from "../../src/infrastructure/cache/in-memory-audit-log.js";
import { decideRoute } from "../domain/helpers/policies.js";
import { AUTH, createTestApp, defaultPolicy, TEST_AUDIT_KEY } from "../helpers/app.js";
import { CLEAN, inspectAs } from "../helpers/privacy.js";
import { failure } from "../resilience/helpers.js";

// Spec 006 US1-1 … US1-5, FR-001 … FR-003, SC-001 (tasks.md T004): exactly one entry per
// request that reaches the decision, for every outcome, streamed or not.

const TEXT = "Escribe a Ana Ruiz sobre el contrato.";
const MESSAGES = [{ role: "user", content: TEXT }];
const HIGH: Inspection = {
  status: "ok",
  level: "high",
  entities: [{ textIndex: 0, kind: "PERSON", start: 10, end: 18, score: 0.85 }],
};

function post(extra: Record<string, unknown> = {}, auth: Record<string, string> = AUTH) {
  return {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ model: "tamiz-auto", messages: MESSAGES, ...extra }),
  };
}

async function* parts(...items: StreamPart[]): AsyncGenerator<StreamPart> {
  for (const item of items) yield item;
}

const answered = ok({
  text: "Hecho.",
  finishReason: "stop" as const,
  usage: { promptTokens: 40, completionTokens: 10 },
  modelName: "served",
});

/** Lets the fire-and-forget audit write (it awaits the policy) settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("withAudit (spec 006)", () => {
  it("US1-1: an answered request leaves one valid entry with target, usage and cost", async () => {
    const { send, audit } = await createTestApp({ script: () => answered });

    await send("/v1/chat/completions", post());
    await settle();

    const [entry, ...rest] = audit.entries();
    expect(rest).toHaveLength(0);
    expect(AuditEntrySchema.safeParse(entry).success).toBe(true);
    expect(entry).toMatchObject({
      outcome: "answered",
      streamed: false,
      target: { id: "mistral-small" },
      usage: { inputTokens: 40, outputTokens: 10, estimated: false },
      baselineTargetId: "anthropic-sonnet",
    });
    expect(entry?.costUsd).toBeCloseTo((40 * 0.1 + 10 * 0.3) / 1e6, 12);
  });

  it("US1-2: a stream leaves one entry at its end: finish, error or cancel", async () => {
    const cases = [
      [
        "answered",
        parts(
          { type: "delta", text: " mundo" },
          { type: "finish", finishReason: "stop", usage: { promptTokens: 9, completionTokens: 4 } },
        ),
      ],
      ["failed", parts({ type: "error", error: failure("network") })],
    ] as const;
    for (const [outcome, rest] of cases) {
      const { send, audit } = await createTestApp({
        streamScript: async (input) => ok({ first: "Hola", modelName: input.target.model, rest }),
      });
      const response = await send("/v1/chat/completions", post({ stream: true }));
      await response.text();
      await settle();
      expect(audit.entries().map((e) => [e.outcome, e.streamed])).toEqual([[outcome, true]]);
    }
  });

  it("US1-2: a client that stops reading leaves one `cancelled` entry", async () => {
    // The HTTP layer stops iterating when the client goes away; that is `return()` on the
    // parts iterator, which is what this test does directly.
    const policy = await defaultPolicy();
    const decision = decideRoute(policy, {
      requestedModel: "tamiz-auto",
      taskType: "chat",
      size: "short",
      inspection: CLEAN,
    });
    const target = decision.chain[0];
    if (target === undefined) throw new Error("the default chain has a target");
    async function* endless(): AsyncGenerator<RoutedStreamPart> {
      for (;;) yield { type: "delta", text: "." };
    }
    const audit = createInMemoryAuditLog();
    const stream = withAuditStream(
      async () =>
        ok({
          decision,
          target,
          abandoned: [],
          modelName: target.model,
          first: "Hola",
          parts: endless(),
          createdAt: new Date(),
        }),
      {
        audit,
        clock: createFakeClock(),
        policies: createInMemoryPolicyRepository(policy),
        hash: () => "a".repeat(64),
        newId: randomUUID,
      },
    );

    const result = await stream({
      requestId: requestIdUnchecked("req-1"),
      clientId: clientIdUnchecked("demo"),
      requestedModel: "tamiz-auto",
      messages: [{ role: "user", content: TEXT }],
    });
    if (!result.ok) throw new Error("expected a stream");
    const iterator = result.value.parts[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    await settle();

    expect(audit.entries().map((e) => [e.outcome, e.streamed])).toEqual([["cancelled", true]]);
  });

  it("US1-3: a privacy block leaves one `blocked` entry with the reason and no target", async () => {
    const base = await defaultPolicy();
    const policy = {
      ...base,
      privacy: {
        ...base.privacy,
        levels: { ...base.privacy.levels, high: { action: "block" as const } },
      },
    };
    const { send, audit } = await createTestApp({ policy, inspect: inspectAs(HIGH) });

    const response = await send("/v1/chat/completions", post());
    await settle();

    expect(response.status).toBe(451);
    const [entry] = audit.entries();
    expect(entry).toMatchObject({
      outcome: "blocked",
      blockReason: "action",
      errorType: "policy_blocked",
      sensitivity: "high",
      entities: { PERSON: 1 },
      costUsd: 0,
    });
    expect(entry?.target).toBeUndefined();
  });

  it("US1-3: a failed inspection with `block` is audited as `detector_unavailable`", async () => {
    const base = await defaultPolicy();
    const policy = { ...base, privacy: { ...base.privacy, onDetectorError: "block" as const } };
    const { send, audit } = await createTestApp({
      policy,
      inspect: inspectAs({ status: "failed", reason: "timeout" }),
    });

    await send("/v1/chat/completions", post());
    await settle();

    expect(audit.entries()[0]).toMatchObject({
      outcome: "blocked",
      blockReason: "detector_unavailable",
      errorType: "privacy_unavailable",
      sensitivity: "unknown",
    });
  });

  it("US1-4: an exhausted chain leaves one `failed` entry with every abandoned target", async () => {
    const { send, audit } = await createTestApp({
      script: (input) => err(failure("http_error", { status: 500, on: input.target })),
    });

    await send("/v1/chat/completions", post());
    await settle();

    const [entry, ...rest] = audit.entries();
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({ outcome: "failed", errorType: "provider_error" });
    expect(entry?.abandoned.map((a) => a.targetId)).toEqual(["mistral-small", "openai-mini"]);
    expect(entry?.target?.id).toBe("ollama-llama");
  });

  it("requests that never reach the decision, and simulations, leave no entry", async () => {
    const { send, audit } = await createTestApp({ script: () => answered });

    await send("/v1/chat/completions", post({}, {}));
    await send("/v1/chat/completions", { ...post(), body: "{nope" });
    await send("/v1/simulate", post());
    await settle();

    expect(audit.size()).toBe(0);
  });

  it("US1-5: the entry has no text and the hash is the HMAC of the messages", async () => {
    const { send, audit } = await createTestApp({
      inspect: inspectAs(HIGH),
      script: () => ok({ ...answered.value, text: "Hecho para <PERSON_1>." }),
    });

    await send("/v1/chat/completions", post());
    await settle();

    const [entry] = audit.entries();
    const serialized = JSON.stringify(entry);
    for (const value of ["Ana Ruiz", "contrato", "Hecho"]) expect(serialized).not.toContain(value);
    expect(entry?.requestHash).toBe(
      createHmac("sha256", TEST_AUDIT_KEY).update(JSON.stringify(MESSAGES)).digest("hex"),
    );
  });
});

describe("createInMemoryAuditLog", () => {
  it("keeps the most recent entries, newest first, within its bound", async () => {
    const log = createInMemoryAuditLog(100);
    const { send } = await createTestApp({ audit: log, script: () => answered });
    for (let i = 0; i < 105; i += 1) await send("/v1/chat/completions", post());
    await settle();

    expect(log.size()).toBe(100);
    const times = log.entries().map((e) => e.startedAt);
    expect([...times].sort().reverse()).toEqual(times);
  });
});
