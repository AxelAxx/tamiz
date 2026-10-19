import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { Message } from "../../src/domain/model/inference-request.js";
import {
  type DecisionInput,
  decide,
  matches,
  orderTargets,
  PRIVACY_ACTIONS,
} from "../../src/domain/model/routing-decision.js";
import {
  DEFAULT_RULE_ID,
  type RoutingPolicy,
  type RoutingPolicyInput,
} from "../../src/domain/model/routing-policy.js";
import { SENSITIVITIES } from "../../src/domain/model/sensitivity.js";
import { classify } from "../../src/domain/model/task-classifier.js";
import { targetIdUnchecked } from "../../src/domain/model/units.js";
import { examplePolicyInput, validPolicy } from "./helpers/policies.js";

// Spec 002 US3, FR-005 … FR-007, research R-08, tasks.md T003.

function request(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    requestedModel: "gpt-4o",
    taskType: "chat",
    size: "short",
    sensitivity: "unknown",
    ...overrides,
  };
}

function chainIds(input: RoutingPolicyInput, req: DecisionInput): string[] {
  return decide(validPolicy(input), req).chain.map((target) => target.id);
}

describe("closed lists", () => {
  it("allows only `allow` and `unknown` in this feature", () => {
    expect(PRIVACY_ACTIONS).toEqual(["allow"]);
    expect(SENSITIVITIES).toEqual(["unknown"]);
    expect(DEFAULT_RULE_ID).toBe("default");
  });
});

describe("decide", () => {
  it("US3-1: the first matching rule's chain, in the rule's order, named by the rule", () => {
    const policy = validPolicy(examplePolicyInput());
    const decision = decide(policy, request({ taskType: "code", size: "long" }));
    expect(decision.ruleId).toBe("code-to-frontier");
    expect(decision.chain.map((target) => target.id)).toEqual([
      "anthropic-sonnet",
      "openai-mini",
      "mistral-small",
    ]);
  });

  it("US3-2: the first matching rule in declaration order wins", () => {
    // Both rules match `extract` + `short`; the more specific one is second and loses.
    const input = examplePolicyInput();
    const rules = [
      { id: "first", when: { taskType: ["extract" as const] }, route: ["openai-mini"] },
      {
        id: "second",
        when: { taskType: ["extract" as const], size: ["short" as const] },
        route: ["ollama-llama"],
      },
    ];
    const decision = decide(validPolicy({ ...input, rules }), request({ taskType: "extract" }));
    expect(decision.ruleId).toBe("first");
    expect(decision.chain.map((target) => target.id)).toEqual(["openai-mini"]);
  });

  it("US3-3: no matching rule gives the default chain and rule `default`", () => {
    const policy = validPolicy(examplePolicyInput());
    const decision = decide(policy, request({ taskType: "chat", size: "long" }));
    expect(decision.ruleId).toBe("default");
    expect(decision.chain.map((target) => target.id)).toEqual([
      "mistral-small",
      "openai-mini",
      "ollama-llama",
    ]);
  });

  it("US3-4: a requested-model condition matches regardless of task type and size", () => {
    const policy = validPolicy(examplePolicyInput());
    for (const taskType of ["code", "summarize", "chat"] as const) {
      for (const size of ["short", "long"] as const) {
        const decision = decide(policy, request({ requestedModel: "tamiz-local", taskType, size }));
        expect(decision.ruleId).toBe("pinned-local");
        expect(decision.chain.map((target) => target.id)).toEqual(["ollama-llama"]);
      }
    }
  });

  it("US3-5: `orderBy: cost` sorts by input + output price ascending", () => {
    const policy = validPolicy(examplePolicyInput());
    const decision = decide(policy, request({ taskType: "classify", size: "short" }));
    expect(decision.ruleId).toBe("cheap-short-tasks");
    expect(decision.chain.map((target) => target.id)).toEqual([
      "ollama-llama",
      "mistral-small",
      "openai-mini",
    ]);
  });

  it("US3-5: cost ties keep declaration order (stable sort)", () => {
    const input = examplePolicyInput();
    const free = { inputUsdPerMillion: 0, outputUsdPerMillion: 0 };
    const targets = input.targets.map((target) =>
      target.id === "anthropic-sonnet" ? target : { ...target, pricing: free },
    );
    const rules = [
      {
        id: "ties",
        when: {},
        route: ["anthropic-sonnet", "openai-mini", "ollama-llama", "mistral-small"],
        orderBy: "cost" as const,
      },
    ];
    expect(chainIds({ ...input, targets, rules }, request())).toEqual([
      "openai-mini",
      "ollama-llama",
      "mistral-small",
      "anthropic-sonnet",
    ]);
  });

  it("US3-5: sums both prices (a cheap input price alone does not win)", () => {
    const input = examplePolicyInput();
    const targets = input.targets.map((target) => {
      if (target.id === "openai-mini") {
        return { ...target, pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 10 } };
      }
      if (target.id === "mistral-small") {
        return { ...target, pricing: { inputUsdPerMillion: 4, outputUsdPerMillion: 4 } };
      }
      return target;
    });
    const rules = [
      { id: "r", when: {}, route: ["openai-mini", "mistral-small"], orderBy: "cost" as const },
    ];
    expect(chainIds({ ...input, targets, rules }, request())).toEqual([
      "mistral-small",
      "openai-mini",
    ]);
  });

  it("US3-7: records sensitivity `unknown` and privacy action `allow`", () => {
    const decision = decide(validPolicy(examplePolicyInput()), request());
    expect(decision.sensitivity).toBe("unknown");
    expect(decision.privacyAction).toBe("allow");
  });

  it("US2-5: copies the policy id and version, the task type and the size", () => {
    const input = { ...examplePolicyInput(), id: "acme-v2", version: 7 };
    const decision = decide(validPolicy(input), request({ taskType: "summarize", size: "medium" }));
    expect(decision).toMatchObject({
      policyId: "acme-v2",
      policyVersion: 7,
      taskType: "summarize",
      size: "medium",
    });
  });

  it("US6-6: copies the matched rule's timeout, and omits it otherwise", () => {
    const policy = validPolicy(examplePolicyInput());
    const withTimeout = decide(policy, request({ taskType: "translate" }));
    expect(withTimeout.ruleId).toBe("cheap-short-tasks");
    expect(withTimeout.ruleTimeoutMs).toBe(20_000);

    const ruleWithout = decide(policy, request({ taskType: "code" }));
    expect("ruleTimeoutMs" in ruleWithout).toBe(false);

    const defaultChain = decide(policy, request({ taskType: "chat" }));
    expect("ruleTimeoutMs" in defaultChain).toBe(false);
  });

  it("a requested model equal to a target id does not pin that target", () => {
    const policy = validPolicy(examplePolicyInput());
    const decision = decide(policy, request({ requestedModel: "anthropic-sonnet" }));
    expect(decision.ruleId).toBe("default");
    expect(decision.chain[0]?.id).toBe("mistral-small");
  });

  it("a first rule with an empty condition matches every request", () => {
    const input = examplePolicyInput();
    const rules = [{ id: "catch-all", when: {}, route: ["ollama-llama"] }, ...input.rules];
    const policy = validPolicy({ ...input, rules });
    for (const req of [
      request({ taskType: "code" }),
      request({ requestedModel: "tamiz-local" }),
      request({ taskType: "summarize", size: "long" }),
    ]) {
      expect(decide(policy, req).ruleId).toBe("catch-all");
    }
  });

  it("a policy with zero rules serves everything from the default chain", () => {
    const policy = validPolicy({ ...examplePolicyInput(), rules: [] });
    expect(decide(policy, request({ taskType: "code" })).ruleId).toBe("default");
  });

  it("returns full target objects from the policy and does not mutate it", () => {
    const policy = validPolicy(examplePolicyInput());
    const before = structuredClone(policy);
    const decision = decide(policy, request({ taskType: "classify" }));
    for (const target of decision.chain) {
      expect(policy.targets).toContain(target);
    }
    expect(policy).toEqual(before);
  });
});

describe("an unvalidated policy", () => {
  it("throws on a chain entry that names no declared target (programming error)", () => {
    const policy = validPolicy(examplePolicyInput());
    const broken: RoutingPolicy = {
      ...policy,
      rules: [],
      default: { route: [targetIdUnchecked("ghost")] },
    };
    expect(() => decide(broken, request())).toThrow(/not declared/);
  });
});

describe("matches", () => {
  const policy = validPolicy(examplePolicyInput());
  const longDocs = policy.rules[2];
  if (longDocs === undefined) throw new Error("fixture");

  it("requires every present field to contain the request value", () => {
    expect(matches(longDocs, request({ taskType: "summarize", size: "long" }))).toBe(true);
    expect(matches(longDocs, request({ taskType: "summarize", size: "short" }))).toBe(false);
    expect(matches(longDocs, request({ taskType: "chat", size: "long" }))).toBe(false);
  });

  it("matches the requested model exactly (case-sensitive)", () => {
    const pinned = policy.rules[0];
    if (pinned === undefined) throw new Error("fixture");
    expect(matches(pinned, request({ requestedModel: "tamiz-local" }))).toBe(true);
    expect(matches(pinned, request({ requestedModel: "Tamiz-Local" }))).toBe(false);
  });
});

describe("orderTargets", () => {
  it("keeps the listed order without `orderBy`", () => {
    const policy = validPolicy(examplePolicyInput());
    const rule = policy.rules[1];
    if (rule === undefined) throw new Error("fixture");
    expect(orderTargets(rule, policy).map((target) => target.id)).toEqual([
      "anthropic-sonnet",
      "openai-mini",
      "mistral-small",
    ]);
  });
});

describe("SC-007: classification plus decision are fast", () => {
  it("p95 of 1 000 classify + decide calls is under 5 ms", () => {
    const policy = validPolicy(examplePolicyInput());
    const messages: Message[] = [
      { role: "system", content: "You are a helpful assistant. ".repeat(20) },
      { role: "user", content: "Resume este informe en tres frases. ".repeat(200) },
    ];
    const durations: number[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const start = performance.now();
      const classification = classify(messages);
      decide(policy, { ...classification, requestedModel: "gpt-4o", sensitivity: "unknown" });
      durations.push(performance.now() - start);
    }
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    expect(p95).toBeLessThan(5);
  });
});
