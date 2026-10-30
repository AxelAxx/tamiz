import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PROVIDER_NAMES, RESIDENCIES } from "../../src/domain/model/model-target.js";
import type { DecisionInput } from "../../src/domain/model/routing-decision.js";
import {
  type RoutingPolicyInput,
  type RoutingRuleInput,
  validatePolicy,
} from "../../src/domain/model/routing-policy.js";
import { NOT_INSPECTED } from "../../src/domain/model/sensitivity.js";
import { TASK_SIZES, TASK_TYPES } from "../../src/domain/model/task-classifier.js";
import { decideRoute, PERMISSIVE_PRIVACY, validPolicy } from "./helpers/policies.js";

// Spec 002 US3-6, SC-003, research R-08, tasks.md T004: properties of `decide` over
// generated valid policies and classified requests.

const NUM_RUNS = 1000;
const MODEL_POOL = ["tamiz-local", "gpt-4o", "claude", "mistral-small"] as const;
const ID = /^[a-z0-9][a-z0-9-]{0,15}$/;
const LOCAL_ID = "local-fallback";
const LOCAL_TARGET = {
  id: LOCAL_ID,
  provider: "ollama" as const,
  model: "llama",
  region: "local",
  residency: "local" as const,
  pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
};

const targetArb = (id: string) =>
  fc.record(
    {
      id: fc.constant(id),
      provider: fc.constantFrom(...PROVIDER_NAMES),
      model: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim() !== ""),
      region: fc.constantFrom("local", "eu-west", "us-east"),
      residency: fc.constantFrom(...RESIDENCIES),
      pricing: fc.record({
        inputUsdPerMillion: fc.integer({ min: 0, max: 2000 }).map((cents) => cents / 100),
        outputUsdPerMillion: fc.integer({ min: 0, max: 2000 }).map((cents) => cents / 100),
      }),
      timeoutMs: fc.integer({ min: 1, max: 120_000 }),
    },
    { requiredKeys: ["id", "provider", "model", "region", "residency", "pricing"] },
  );

const ruleArb = (id: string, targetIds: readonly string[]): fc.Arbitrary<RoutingRuleInput> =>
  fc.record(
    {
      id: fc.constant(id),
      when: fc.record(
        {
          taskType: fc.subarray([...TASK_TYPES], { minLength: 1 }),
          size: fc.subarray([...TASK_SIZES], { minLength: 1 }),
          requestedModel: fc.subarray([...MODEL_POOL], { minLength: 1 }),
        },
        { requiredKeys: [] },
      ),
      route: fc.shuffledSubarray([...targetIds], { minLength: 1 }),
      orderBy: fc.constant("cost" as const),
      timeoutMs: fc.integer({ min: 1, max: 120_000 }),
    },
    { requiredKeys: ["id", "when", "route"] },
  );

const policyInputArb: fc.Arbitrary<RoutingPolicyInput> = fc
  .record({
    targetIds: fc.uniqueArray(
      fc.stringMatching(ID).filter((id) => id !== LOCAL_ID),
      { minLength: 1, maxLength: 6 },
    ),
    ruleIds: fc.uniqueArray(
      fc.stringMatching(ID).filter((id) => id !== "default"),
      { maxLength: 6 },
    ),
  })
  .chain(({ targetIds, ruleIds }) =>
    fc.record({
      id: fc.stringMatching(/^[A-Za-z0-9_-]{1,16}$/),
      version: fc.integer({ min: 1, max: 1000 }),
      defaultTimeoutMs: fc.integer({ min: 1, max: 120_000 }),
      // A fixed local target backs the privacy section's local route; rules never name it.
      targets: fc.tuple(...targetIds.map(targetArb)).map((targets) => [...targets, LOCAL_TARGET]),
      rules:
        ruleIds.length === 0
          ? fc.constant([])
          : fc.tuple(...ruleIds.map((id) => ruleArb(id, targetIds))),
      default: fc.record({ route: fc.shuffledSubarray(targetIds, { minLength: 1 }) }),
      privacy: fc.constant({ ...PERMISSIVE_PRIVACY, localRoute: [LOCAL_ID] }),
    }),
  );

const requestArb: fc.Arbitrary<DecisionInput> = fc.record({
  requestedModel: fc.oneof(fc.constantFrom(...MODEL_POOL), fc.string({ maxLength: 12 })),
  taskType: fc.constantFrom(...TASK_TYPES),
  size: fc.constantFrom(...TASK_SIZES),
  inspection: fc.constant(NOT_INSPECTED),
});

describe("decide (property-based, SC-003)", () => {
  it("every generated policy input is valid", () => {
    fc.assert(
      fc.property(policyInputArb, (input) => validatePolicy(input).ok),
      { numRuns: NUM_RUNS },
    );
  });

  it("is deterministic: the same input gives a deep-equal decision", () => {
    fc.assert(
      fc.property(policyInputArb, requestArb, (input, req) => {
        const policy = validPolicy(input);
        expect(decideRoute(policy, req)).toEqual(decideRoute(policy, req));
        expect(decideRoute(validPolicy(input), { ...req })).toEqual(decideRoute(policy, req));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("returns a non-empty chain of declared targets with no duplicates", () => {
    fc.assert(
      fc.property(policyInputArb, requestArb, (input, req) => {
        const policy = validPolicy(input);
        const { chain } = decideRoute(policy, req);
        expect(chain.length).toBeGreaterThan(0);
        for (const target of chain) {
          expect(policy.targets).toContain(target);
        }
        const ids = chain.map((target) => target.id);
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("names a declared rule or `default`, and the chain is that rule's targets", () => {
    fc.assert(
      fc.property(policyInputArb, requestArb, (input, req) => {
        const policy = validPolicy(input);
        const decision = decideRoute(policy, req);
        const rule = policy.rules.find((candidate) => candidate.id === decision.ruleId);
        const route = decision.ruleId === "default" ? policy.default.route : rule?.route;
        expect(route).toBeDefined();
        expect([...decision.chain.map((target) => target.id)].sort()).toEqual(
          [...(route ?? [])].sort(),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("carries the policy identity, the classification, `none` and `allow`", () => {
    fc.assert(
      fc.property(policyInputArb, requestArb, (input, req) => {
        const policy = validPolicy(input);
        expect(decideRoute(policy, req)).toMatchObject({
          policyId: policy.id,
          policyVersion: policy.version,
          taskType: req.taskType,
          size: req.size,
          sensitivity: "none",
          privacyAction: "allow",
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("does not mutate the policy or the request", () => {
    fc.assert(
      fc.property(policyInputArb, requestArb, (input, req) => {
        const policy = validPolicy(input);
        const policyBefore = structuredClone(policy);
        const requestBefore = structuredClone(req);
        decideRoute(policy, req);
        expect(policy).toEqual(policyBefore);
        expect(req).toEqual(requestBefore);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
