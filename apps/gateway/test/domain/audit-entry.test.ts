import { AuditEntrySchema } from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import { type AuditInput, auditEntry } from "../../src/domain/model/audit-entry.js";
import { baselineCost, baselineTarget } from "../../src/domain/model/baseline.js";
import type { ModelTarget } from "../../src/domain/model/model-target.js";
import { decide } from "../../src/domain/model/routing-decision.js";
import type { Inspection } from "../../src/domain/model/sensitivity.js";
import { examplePolicyInput, validPolicy } from "./helpers/policies.js";

// Spec 006 US1-1, US1-5, FR-002, FR-003, research R-08 (tasks.md T002, T003).

const policy = validPolicy(examplePolicyInput());
const target = (id: string): ModelTarget => {
  const found = policy.targets.find((t) => t.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};
const HIGH: Inspection = {
  status: "ok",
  level: "high",
  entities: [
    { textIndex: 0, kind: "PERSON", start: 3, end: 11, score: 0.85 },
    { textIndex: 0, kind: "PERSON", start: 20, end: 25, score: 0.85 },
    { textIndex: 1, kind: "EMAIL", start: 0, end: 15, score: 1 },
  ],
};
const decision = decide(policy, {
  requestedModel: "gpt-4o",
  taskType: "chat",
  size: "short",
  inspection: HIGH,
});
const HASH = "a".repeat(64);

function input(overrides: Partial<AuditInput> = {}): AuditInput {
  return {
    id: "5f0c8a3e-2b7d-4c1a-9e6f-1d2c3b4a5e60",
    requestId: "req-1",
    clientId: "demo",
    startedAt: new Date("2026-10-30T10:00:00.000Z"),
    endedAt: new Date("2026-10-30T10:00:01.250Z"),
    requestHash: HASH,
    decision,
    streamed: false,
    result: {
      kind: "answered",
      target: target("mistral-small"),
      abandoned: [{ targetId: target("openai-mini").id, reason: "timeout" }],
      usage: { promptTokens: 40, completionTokens: 10, estimated: false },
      cost: 0.000007,
      noticeVersion: "v1",
    },
    baseline: target("anthropic-sonnet"),
    ...overrides,
  };
}

describe("baseline", () => {
  it("is the most expensive target, the first on a tie", () => {
    expect(baselineTarget(policy.targets)?.id).toBe("anthropic-sonnet");
    const twin = { ...target("anthropic-sonnet"), id: "twin" } as ModelTarget;
    expect(baselineTarget([target("anthropic-sonnet"), twin])?.id).toBe("anthropic-sonnet");
  });

  it("is undefined when nothing is priced", () => {
    expect(baselineTarget([target("ollama-llama")])).toBeUndefined();
    expect(baselineTarget([])).toBeUndefined();
  });

  it("prices the tokens at the baseline's prices", () => {
    expect(
      baselineCost({ promptTokens: 40, completionTokens: 10 }, target("anthropic-sonnet")),
    ).toBeCloseTo((40 * 3 + 10 * 15) / 1e6, 12);
  });
});

describe("auditEntry", () => {
  it("US1-1: an answered request has the decision, target, usage, cost and baseline", () => {
    const entry = auditEntry(input());

    expect(entry).toMatchObject({
      outcome: "answered",
      latencyMs: 1250,
      ruleId: "default",
      sensitivity: "high",
      entities: { PERSON: 2, EMAIL: 1 },
      privacyAction: "allow", // the example policy allows `high` (PERMISSIVE_PRIVACY)
      noticeVersion: "v1",
      target: { id: "mistral-small", provider: "mistral", residency: "eu" },
      abandoned: [{ targetId: "openai-mini", reason: "timeout" }],
      usage: { inputTokens: 40, outputTokens: 10, estimated: false },
      costUsd: 0.000007,
      baselineTargetId: "anthropic-sonnet",
    });
    expect(entry.baselineCostUsd).toBeCloseTo((40 * 3 + 10 * 15) / 1e6, 12);
    expect(AuditEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("a blocked request has a reason, an error type, zero cost and no usage", () => {
    const entry = auditEntry(
      input({
        result: { kind: "blocked", reason: "action", errorType: "policy_blocked", abandoned: [] },
      }),
    );

    expect(entry).toMatchObject({ outcome: "blocked", blockReason: "action", costUsd: 0 });
    expect(entry.usage).toBeUndefined();
    expect(entry.baselineCostUsd).toBeUndefined();
    expect(AuditEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("a failed request carries the error type and the last target", () => {
    const entry = auditEntry(
      input({
        result: {
          kind: "failed",
          target: target("ollama-llama"),
          abandoned: [],
          errorType: "provider_timeout",
        },
      }),
    );
    expect(entry).toMatchObject({
      outcome: "failed",
      errorType: "provider_timeout",
      target: { id: "ollama-llama" },
      costUsd: 0,
    });
    expect(AuditEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("US1-5: has only counts, never offsets; every key is a contract field", () => {
    const entry = auditEntry(input());
    const serialized = JSON.stringify(entry);

    expect(serialized).not.toMatch(/"start"|"end"|"textIndex"|"score"/);
    expect(AuditEntrySchema.strict().safeParse(entry).success).toBe(true);
  });
});
