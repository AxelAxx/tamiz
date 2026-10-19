import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY_TIMEOUT_MS,
  type RoutingPolicyInput,
  targetById,
  validatePolicy,
} from "../../src/domain/model/routing-policy.js";
import { examplePolicyInput, validPolicy } from "./helpers/policies.js";

// Spec 002 FR-003, FR-004, research R-02, tasks.md T002.

/** Returns the issue paths of a rejected policy, or fails the test if it was accepted. */
function issuePaths(input: RoutingPolicyInput): string[] {
  const result = validatePolicy(input);
  if (result.ok) {
    throw new Error("expected the policy to be rejected");
  }
  expect(result.error.kind).toBe("validation");
  return result.error.issues.map((issue) => issue.path);
}

describe("validatePolicy accepts", () => {
  it("the example policy, keeping every field and the declaration order", () => {
    const policy = validPolicy(examplePolicyInput());
    expect(policy.id).toBe("default");
    expect(policy.version).toBe(1);
    expect(policy.defaultTimeoutMs).toBe(30_000);
    expect(policy.targets.map((target) => target.id)).toEqual([
      "ollama-llama",
      "mistral-small",
      "openai-mini",
      "anthropic-sonnet",
    ]);
    expect(policy.rules.map((rule) => rule.id)).toEqual([
      "pinned-local",
      "code-to-frontier",
      "long-documents-eu",
      "cheap-short-tasks",
    ]);
    expect(policy.targets[0]).toEqual(examplePolicyInput().targets[0]);
    expect(policy.rules[3]).toEqual(examplePolicyInput().rules[3]);
    expect(policy.default.route).toEqual(["mistral-small", "openai-mini", "ollama-llama"]);
  });

  it("zero rules", () => {
    const policy = validPolicy({ ...examplePolicyInput(), rules: [] });
    expect(policy.rules).toEqual([]);
  });

  it("an empty condition", () => {
    const input = examplePolicyInput();
    const policy = validPolicy({
      ...input,
      rules: [{ id: "catch-all", when: {}, route: ["ollama-llama"] }],
    });
    expect(policy.rules[0]?.when).toEqual({});
  });

  it("a missing default timeout, using 30 000 ms", () => {
    const { defaultTimeoutMs: _omitted, ...input } = examplePolicyInput();
    expect(DEFAULT_POLICY_TIMEOUT_MS).toBe(30_000);
    expect(validPolicy(input).defaultTimeoutMs).toBe(30_000);
  });

  it("does not mutate its input", () => {
    const input = examplePolicyInput();
    validPolicy(input);
    expect(input).toEqual(examplePolicyInput());
  });
});

describe("validatePolicy rejects, naming the path", () => {
  it("a duplicate target id", () => {
    const input = examplePolicyInput();
    const first = input.targets[0];
    if (first === undefined) throw new Error("fixture");
    const targets = [first, { ...first }, ...input.targets.slice(1)];
    expect(issuePaths({ ...input, targets })).toContain("targets.1.id");
  });

  it("a duplicate rule id", () => {
    const input = examplePolicyInput();
    const rules = [
      { id: "same", when: {}, route: ["ollama-llama"] },
      { id: "same", when: {}, route: ["mistral-small"] },
    ];
    expect(issuePaths({ ...input, rules })).toEqual(["rules.1.id"]);
  });

  it("the reserved rule id `default`", () => {
    const rules = [{ id: "default", when: {}, route: ["ollama-llama"] }];
    expect(issuePaths({ ...examplePolicyInput(), rules })).toEqual(["rules.0.id"]);
  });

  it("an undeclared target in a rule", () => {
    const rules = [{ id: "r", when: {}, route: ["ollama-llama", "nope"] }];
    expect(issuePaths({ ...examplePolicyInput(), rules })).toEqual(["rules.0.route.1"]);
  });

  it("an undeclared target in the default chain", () => {
    const input = { ...examplePolicyInput(), default: { route: ["nope"] } };
    expect(issuePaths(input)).toEqual(["default.route.0"]);
  });

  it("a duplicate target in a chain", () => {
    const rules = [{ id: "r", when: {}, route: ["ollama-llama", "mistral-small", "ollama-llama"] }];
    expect(issuePaths({ ...examplePolicyInput(), rules })).toEqual(["rules.0.route.2"]);
    const input = { ...examplePolicyInput(), default: { route: ["openai-mini", "openai-mini"] } };
    expect(issuePaths(input)).toEqual(["default.route.1"]);
  });

  it("an empty chain", () => {
    const rules = [{ id: "r", when: {}, route: [] }];
    expect(issuePaths({ ...examplePolicyInput(), rules })).toEqual(["rules.0.route"]);
    expect(issuePaths({ ...examplePolicyInput(), default: { route: [] } })).toEqual([
      "default.route",
    ]);
  });

  it("no targets", () => {
    expect(issuePaths({ ...examplePolicyInput(), targets: [] })).toContain("targets");
  });

  it("a negative price", () => {
    const input = examplePolicyInput();
    const [first, ...rest] = input.targets;
    if (first === undefined) throw new Error("fixture");
    const targets = [
      { ...first, pricing: { inputUsdPerMillion: -1, outputUsdPerMillion: -2 } },
      ...rest,
    ];
    expect(issuePaths({ ...input, targets })).toEqual([
      "targets.0.pricing.inputUsdPerMillion",
      "targets.0.pricing.outputUsdPerMillion",
    ]);
  });

  it("a non-positive timeout on the policy, a target or a rule", () => {
    const input = examplePolicyInput();
    const [first, ...rest] = input.targets;
    if (first === undefined) throw new Error("fixture");
    expect(issuePaths({ ...input, defaultTimeoutMs: 0 })).toEqual(["defaultTimeoutMs"]);
    expect(issuePaths({ ...input, targets: [{ ...first, timeoutMs: -5 }, ...rest] })).toEqual([
      "targets.0.timeoutMs",
    ]);
    const rules = [{ id: "r", when: {}, route: ["ollama-llama"], timeoutMs: 1.5 }];
    expect(issuePaths({ ...input, rules })).toEqual(["rules.0.timeoutMs"]);
  });

  it("malformed ids, version, model and region", () => {
    const input = examplePolicyInput();
    const [first, ...rest] = input.targets;
    if (first === undefined) throw new Error("fixture");
    expect(issuePaths({ ...input, id: "" })).toEqual(["id"]);
    expect(issuePaths({ ...input, version: 0 })).toEqual(["version"]);
    expect(issuePaths({ ...input, version: 1.5 })).toEqual(["version"]);
    const badTarget = { ...first, id: "Bad Id", model: "", region: " " };
    const paths = issuePaths({ ...input, targets: [badTarget, ...rest] });
    expect(paths).toEqual(
      expect.arrayContaining(["targets.0.id", "targets.0.model", "targets.0.region"]),
    );
    const rules = [{ id: "Bad Rule", when: {}, route: ["ollama-llama"] }];
    expect(issuePaths({ ...input, rules })).toEqual(["rules.0.id"]);
  });

  it("an empty list inside a condition", () => {
    const rules = [
      { id: "r", when: { taskType: [], size: [], requestedModel: [] }, route: ["ollama-llama"] },
    ];
    expect(issuePaths({ ...examplePolicyInput(), rules })).toEqual([
      "rules.0.when.taskType",
      "rules.0.when.size",
      "rules.0.when.requestedModel",
    ]);
  });

  it("reports every problem at once, never the offending value", () => {
    const input = examplePolicyInput();
    const rules = [
      { id: "default", when: {}, route: ["Secret-Value"] },
      { id: "x", when: {}, route: [] },
    ];
    const result = validatePolicy({ ...input, rules, default: { route: ["nope"] } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.map((issue) => issue.path)).toEqual([
        "rules.0.id",
        "rules.0.route.0",
        "rules.1.route",
        "default.route.0",
      ]);
      expect(JSON.stringify(result.error)).not.toContain("Secret-Value");
    }
  });
});

describe("targetById", () => {
  it("returns the declared target", () => {
    const policy = validPolicy(examplePolicyInput());
    const target = policy.targets[2];
    if (target === undefined) throw new Error("fixture");
    expect(targetById(policy, target.id)).toBe(target);
  });
});
