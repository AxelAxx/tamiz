import { describe, expect, it } from "vitest";
import { RoutingPolicySchema } from "../src/index.js";

// Spec 002 FR-019, US2-2, US3-7 (tasks.md T036): the policy file's shape. Cross-field
// rules (unique ids, declared targets) belong to the gateway domain, not to this schema.

/** `specs/002-provider-routing/contracts/policy.example.yaml`, as JSON. */
function examplePolicy(): Record<string, unknown> {
  return {
    id: "default",
    version: 1,
    defaultTimeoutMs: 30000,
    targets: [
      {
        id: "ollama-llama",
        provider: "ollama",
        model: "llama3.1:8b",
        region: "local",
        residency: "local",
        pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
        timeoutMs: 60000,
      },
      {
        id: "mistral-small",
        provider: "mistral",
        model: "mistral-small-latest",
        region: "eu-west",
        residency: "eu",
        pricing: { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.3 },
      },
    ],
    rules: [
      { id: "pinned-local", when: { requestedModel: ["tamiz-local"] }, route: ["ollama-llama"] },
      {
        id: "cheap-short-tasks",
        when: { taskType: ["classify", "translate"], size: ["short", "medium"] },
        route: ["mistral-small", "ollama-llama"],
        orderBy: "cost",
        timeoutMs: 20000,
      },
    ],
    default: { route: ["mistral-small", "ollama-llama"] },
    privacy: {
      onDetectorError: "restrict_to_local",
      localRoute: ["ollama-llama"],
      levels: {
        none: { action: "allow" },
        low: { action: "allow" },
        high: { action: "anonymize", residency: ["local", "eu"] },
        critical: { action: "restrict_to_local" },
      },
    },
  };
}

type Mutation = (policy: Record<string, unknown>) => void;

function target(policy: Record<string, unknown>, index: number): Record<string, unknown> {
  return (policy["targets"] as Array<Record<string, unknown>>)[index] as Record<string, unknown>;
}

function rule(policy: Record<string, unknown>, index: number): Record<string, unknown> {
  return (policy["rules"] as Array<Record<string, unknown>>)[index] as Record<string, unknown>;
}

function issuePaths(input: unknown): string[] {
  const result = RoutingPolicySchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.map(String).join("."));
}

describe("RoutingPolicySchema (FR-019)", () => {
  it("parses the example policy", () => {
    const result = RoutingPolicySchema.safeParse(examplePolicy());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe("default");
    expect(result.data.targets).toHaveLength(2);
    expect(result.data.rules[1]?.timeoutMs).toBe(20000);
  });

  it("defaults defaultTimeoutMs to 30000 when omitted", () => {
    const policy = examplePolicy();
    delete policy["defaultTimeoutMs"];

    const result = RoutingPolicySchema.safeParse(policy);

    expect(result.success && result.data.defaultTimeoutMs).toBe(30000);
  });

  it("accepts an empty condition, which matches every request", () => {
    const policy = examplePolicy();
    rule(policy, 0)["when"] = {};

    expect(RoutingPolicySchema.safeParse(policy).success).toBe(true);
  });

  it("spec 003: accepts a resilience section and residency statements, all optional", () => {
    const policy = examplePolicy();
    policy["resilience"] = {
      requestDeadlineMs: 60_000,
      maxAttempts: 2,
      backoff: { baseDelayMs: 250, maxDelayMs: 2_000 },
      circuitBreaker: { failureThreshold: 5, cooldownMs: 30_000 },
    };
    rule(policy, 0)["residency"] = ["local"];
    policy["default"] = { route: ["mistral-small", "ollama-llama"], residency: ["eu", "local"] };

    const result = RoutingPolicySchema.safeParse(policy);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.resilience?.circuitBreaker?.cooldownMs).toBe(30_000);
    expect(result.data.rules[0]?.residency).toEqual(["local"]);
    expect(result.data.default.residency).toEqual(["eu", "local"]);
    expect(RoutingPolicySchema.safeParse({ ...policy, resilience: {} }).success).toBe(true);
  });

  const rejected: ReadonlyArray<readonly [string, Mutation, string]> = [
    ["an unknown provider", (p) => (target(p, 0)["provider"] = "azure"), "targets.0.provider"],
    [
      "a negative price",
      (p) => (target(p, 1)["pricing"] = { inputUsdPerMillion: -1, outputUsdPerMillion: 0 }),
      "targets.1.pricing.inputUsdPerMillion",
    ],
    ["version 0", (p) => (p["version"] = 0), "version"],
    ["defaultTimeoutMs 0", (p) => (p["defaultTimeoutMs"] = 0), "defaultTimeoutMs"],
    ["an empty rule route", (p) => (rule(p, 0)["route"] = []), "rules.0.route"],
    ["an empty default route", (p) => (p["default"] = { route: [] }), "default.route"],
    ["orderBy latency", (p) => (rule(p, 1)["orderBy"] = "latency"), "rules.1.orderBy"],
    ["a rule timeoutMs of 0", (p) => (rule(p, 1)["timeoutMs"] = 0), "rules.1.timeoutMs"],
    ["an unknown top-level key", (p) => (p["fallback"] = true), ""],
    [
      "a sensitivity condition (US3-7, until feature 005)",
      (p) => (rule(p, 0)["when"] = { sensitivity: ["high"] }),
      "rules.0.when",
    ],
    [
      "an empty taskType list",
      (p) => (rule(p, 1)["when"] = { taskType: [] }),
      "rules.1.when.taskType",
    ],
    [
      "an unknown task type",
      (p) => (rule(p, 1)["when"] = { taskType: ["poetry"] }),
      "rules.1.when.taskType.0",
    ],
    ["an upper-case target id", (p) => (target(p, 0)["id"] = "Ollama"), "targets.0.id"],
    ["an empty model name", (p) => (target(p, 0)["model"] = ""), "targets.0.model"],
    ["no targets", (p) => (p["targets"] = []), "targets"],
    ["maxAttempts 0", (p) => (p["resilience"] = { maxAttempts: 0 }), "resilience.maxAttempts"],
    ["maxAttempts 6", (p) => (p["resilience"] = { maxAttempts: 6 }), "resilience.maxAttempts"],
    [
      "requestDeadlineMs 999",
      (p) => (p["resilience"] = { requestDeadlineMs: 999 }),
      "resilience.requestDeadlineMs",
    ],
    [
      "cooldownMs 999",
      (p) => (p["resilience"] = { circuitBreaker: { cooldownMs: 999 } }),
      "resilience.circuitBreaker.cooldownMs",
    ],
    [
      "failureThreshold 0",
      (p) => (p["resilience"] = { circuitBreaker: { failureThreshold: 0 } }),
      "resilience.circuitBreaker.failureThreshold",
    ],
    [
      "baseDelayMs 0",
      (p) => (p["resilience"] = { backoff: { baseDelayMs: 0 } }),
      "resilience.backoff.baseDelayMs",
    ],
    ["an unknown resilience key", (p) => (p["resilience"] = { jitter: "full" }), "resilience"],
    ["an empty residency list", (p) => (rule(p, 0)["residency"] = []), "rules.0.residency"],
    ["an unknown residency", (p) => (rule(p, 0)["residency"] = ["mars"]), "rules.0.residency.0"],
    ["a repeated residency", (p) => (rule(p, 0)["residency"] = ["eu", "eu"]), "rules.0.residency"],
    [
      "an empty default residency",
      (p) => (p["default"] = { route: ["ollama-llama"], residency: [] }),
      "default.residency",
    ],
  ];

  it.each(rejected)("rejects %s at its path", (_name, mutate, path) => {
    const policy = examplePolicy();
    mutate(policy);

    expect(issuePaths(policy)).toContain(path);
  });
});
