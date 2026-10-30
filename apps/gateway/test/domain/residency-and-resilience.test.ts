import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RESIDENCIES } from "../../src/domain/model/model-target.js";
import type { DecisionInput } from "../../src/domain/model/routing-decision.js";
import {
  DEFAULT_RESILIENCE,
  type RoutingPolicyInput,
  validatePolicy,
} from "../../src/domain/model/routing-policy.js";
import { CLEAN_INSPECTION } from "../../src/domain/model/sensitivity.js";
import { decideRoute, examplePolicyInput, validPolicy } from "./helpers/policies.js";

// Spec 003 US2-3, US2-4, FR-012, FR-014, FR-020, research R-06, R-14 (tasks.md T021).

function issues(input: RoutingPolicyInput) {
  const result = validatePolicy(input);
  if (result.ok) throw new Error("expected the policy to be rejected");
  return result.error.issues;
}

function request(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    requestedModel: "tamiz-auto",
    taskType: "chat" as const,
    size: "short" as const,
    inspection: CLEAN_INSPECTION,
    ...overrides,
  };
}

describe("resilience settings (FR-020)", () => {
  it("fills the documented defaults when the policy has none", () => {
    const policy = validPolicy(examplePolicyInput());

    expect(policy.resilience).toEqual(DEFAULT_RESILIENCE);
    expect(DEFAULT_RESILIENCE).toEqual({
      requestDeadlineMs: 60_000,
      maxAttempts: 2,
      backoff: { baseDelayMs: 250, maxDelayMs: 2_000 },
      circuitBreaker: { failureThreshold: 5, cooldownMs: 30_000 },
    });
  });

  it("keeps given values and fills only the missing ones", () => {
    const policy = validPolicy({
      ...examplePolicyInput(),
      resilience: { maxAttempts: 3, circuitBreaker: { cooldownMs: 10_000 } },
    });

    expect(policy.resilience).toEqual({
      ...DEFAULT_RESILIENCE,
      maxAttempts: 3,
      circuitBreaker: { failureThreshold: 5, cooldownMs: 10_000 },
    });
  });

  it("rejects a maximum delay below the base delay", () => {
    const found = issues({
      ...examplePolicyInput(),
      resilience: { backoff: { baseDelayMs: 500, maxDelayMs: 100 } },
    });

    expect(found).toContainEqual({
      path: "resilience.backoff.maxDelayMs",
      message: "expected at least baseDelayMs",
    });
  });

  it.each([
    ["maxAttempts", { maxAttempts: 0 }, "resilience.maxAttempts"],
    ["requestDeadlineMs", { requestDeadlineMs: 999 }, "resilience.requestDeadlineMs"],
    ["cooldownMs", { circuitBreaker: { cooldownMs: 10 } }, "resilience.circuitBreaker.cooldownMs"],
  ])("rejects an out-of-range %s", (_name, resilience, path) => {
    const found = issues({ ...examplePolicyInput(), resilience });

    expect(found.map((issue) => issue.path)).toContain(path);
  });
});

describe("residency statements (FR-012, FR-014)", () => {
  it("US2-3: rejects a rule whose chain lists a target outside its residency", () => {
    const input = examplePolicyInput();
    const rules = input.rules.map((rule) =>
      rule.id === "long-documents-eu" ? { ...rule, residency: ["eu", "local"] as const } : rule,
    );

    const found = issues({ ...input, rules });

    // long-documents-eu is rules.2 and lists [mistral-small, openai-mini].
    expect(found).toContainEqual({
      path: "rules.2.route.1",
      message:
        'expected a target whose residency is in the rule\'s residency list (target residency "us")',
    });
  });

  it("US2-3: rejects a default chain that contradicts the default residency", () => {
    const found = issues({
      ...examplePolicyInput(),
      default: { route: ["mistral-small", "openai-mini"], residency: ["eu"] },
    });

    expect(found.map((issue) => issue.path)).toContain("default.route.1");
  });

  it("rejects a repeated residency", () => {
    const input = examplePolicyInput();
    const rules = [
      { id: "r", when: {}, route: ["ollama-llama"], residency: ["local", "local"] as const },
    ];

    expect(issues({ ...input, rules }).map((issue) => issue.path)).toContain("rules.0.residency.1");
  });

  it("accepts consistent statements", () => {
    const input = examplePolicyInput();
    const rules = [
      { id: "local-only", when: {}, route: ["ollama-llama"], residency: ["local"] as const },
    ];

    expect(
      validatePolicy({ ...input, rules, default: { route: ["mistral-small"], residency: ["eu"] } })
        .ok,
    ).toBe(true);
  });
});

describe("decide: allowed residencies (US2-4, FR-012)", () => {
  it("copies the matched rule's residency list", () => {
    const input = examplePolicyInput();
    const rules = [
      {
        id: "local-only",
        when: { requestedModel: ["tamiz-local"] },
        route: ["ollama-llama"],
        residency: ["local"] as const,
      },
    ];
    const policy = validPolicy({ ...input, rules });

    expect(
      decideRoute(policy, request({ requestedModel: "tamiz-local" })).allowedResidencies,
    ).toEqual(["local"]);
  });

  it("copies the default chain's residency list when no rule matches", () => {
    const policy = validPolicy({
      ...examplePolicyInput(),
      default: { route: ["mistral-small", "ollama-llama"], residency: ["eu", "local"] },
    });

    expect(decideRoute(policy, request({ requestedModel: "anything" })).allowedResidencies).toEqual(
      ["eu", "local"],
    );
  });

  it("US2-4: allows every residency when nothing is declared", () => {
    const policy = validPolicy(examplePolicyInput());

    expect(decideRoute(policy, request()).allowedResidencies).toEqual(RESIDENCIES);
  });

  it("every decision's allowed set is non-empty and contains every target of its own chain", () => {
    const policy = validPolicy({
      ...examplePolicyInput(),
      rules: [
        {
          id: "local-only",
          when: { taskType: ["code"] },
          route: ["ollama-llama"],
          residency: ["local"],
        },
      ],
      default: { route: ["mistral-small", "ollama-llama"], residency: ["eu", "local"] },
    });
    fc.assert(
      fc.property(
        fc.constantFrom("chat", "code", "summarize", "translate", "extract", "classify"),
        fc.constantFrom("short", "medium", "long"),
        (taskType, size) => {
          const decision = decideRoute(policy, request({ taskType, size }));
          expect(decision.allowedResidencies.length).toBeGreaterThan(0);
          for (const target of decision.chain) {
            expect(decision.allowedResidencies).toContain(target.residency);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
