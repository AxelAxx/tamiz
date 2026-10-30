import { describe, expect, it } from "vitest";
import type { ModelTarget } from "../../src/domain/model/model-target.js";
import {
  applyPrivacy,
  type PrivacyLevelSettings,
  type PrivacySettings,
  type PrivacySettingsInput,
  validatePrivacy,
} from "../../src/domain/model/privacy-policy.js";
import { decide } from "../../src/domain/model/routing-decision.js";
import { validatePolicy } from "../../src/domain/model/routing-policy.js";
import type { Inspection, SensitivityLevel } from "../../src/domain/model/sensitivity.js";
import { NOT_INSPECTED } from "../../src/domain/model/sensitivity.js";
import {
  decideRoute,
  examplePolicyInput,
  PERMISSIVE_PRIVACY,
  validPolicy,
} from "./helpers/policies.js";

// Spec 005 US1-1 … US1-5 (decision part), US6-1 … US6-3, FR-002 … FR-004, research R-04
// (tasks.md T002).

const policy = validPolicy(examplePolicyInput());
const target = (id: string): ModelTarget => {
  const found = policy.targets.find((t) => t.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};
const OLLAMA = target("ollama-llama");
const MISTRAL = target("mistral-small");
const OPENAI = target("openai-mini");
const ANTHROPIC = target("anthropic-sonnet");

const DECLARED = new Map(policy.targets.map((t) => [t.id as string, t.residency] as const));

function settings(levels: Partial<Record<SensitivityLevel, PrivacyLevelSettings>> = {}) {
  return {
    ...PERMISSIVE_PRIVACY,
    levels: { ...PERMISSIVE_PRIVACY.levels, ...levels },
  } as PrivacySettings;
}

function inspected(level: SensitivityLevel): Inspection {
  return { status: "ok", level, entities: [] };
}

const FAILED: Inspection = { status: "failed", reason: "timeout" };

function step(
  privacy: PrivacySettings,
  inspection: Inspection,
  chain = [ANTHROPIC, OPENAI, MISTRAL],
) {
  return applyPrivacy({ chain, privacy, localChain: [OLLAMA], inspection });
}

describe("validatePrivacy", () => {
  const valid: PrivacySettingsInput = PERMISSIVE_PRIVACY;

  it("accepts the default section of research R-11", () => {
    const result = validatePrivacy(
      {
        ...valid,
        levels: {
          none: { action: "allow" },
          low: { action: "allow" },
          high: { action: "anonymize", residency: ["local", "eu"] },
          critical: { action: "restrict_to_local" },
        },
      },
      DECLARED,
    );
    expect(result.issues).toEqual([]);
    expect(result.settings?.localRoute).toEqual(["ollama-llama"]);
  });

  it("US6-1: a missing section is an issue on `privacy`", () => {
    expect(validatePrivacy(undefined, DECLARED).issues.map((i) => i.path)).toEqual(["privacy"]);
    const { privacy: _omitted, ...rest } = examplePolicyInput();
    const result = validatePolicy({ ...rest, privacy: undefined });
    expect(result.ok).toBe(false);
  });

  it.each([
    [{ action: "allow" } as const],
    [{ action: "allow", residency: ["local", "us"] } as const],
    [{ action: "allow", residency: ["global"] } as const],
  ])("US6-2: rejects critical %j (clear data outside local and eu)", (critical) => {
    const result = validatePrivacy({ ...valid, levels: { ...valid.levels, critical } }, DECLARED);
    expect(result.issues.map((i) => i.path)).toEqual(["privacy.levels.critical"]);
  });

  it.each([
    [{ action: "allow", residency: ["local", "eu"] } as const],
    [{ action: "anonymize" } as const],
    [{ action: "block" } as const],
    [{ action: "restrict_to_local" } as const],
  ])("accepts critical %j", (critical) => {
    expect(
      validatePrivacy({ ...valid, levels: { ...valid.levels, critical } }, DECLARED).issues,
    ).toEqual([]);
  });

  it("US6-3: a non-local, unknown or repeated localRoute entry is rejected with its path", () => {
    const result = validatePrivacy(
      { ...valid, localRoute: ["mistral-small", "ghost", "ollama-llama", "ollama-llama"] },
      DECLARED,
    );
    expect(result.issues).toEqual([
      {
        path: "privacy.localRoute.0",
        message: 'expected a local target (target residency "eu")',
      },
      { path: "privacy.localRoute.1", message: "expected the id of a declared target" },
      { path: "privacy.localRoute.3", message: "expected each target at most once" },
    ]);
  });

  it("an empty localRoute or residency list is rejected", () => {
    const result = validatePrivacy(
      {
        ...valid,
        localRoute: [],
        levels: { ...valid.levels, high: { action: "anonymize", residency: [] } },
      },
      DECLARED,
    );
    expect(result.issues.map((i) => i.path)).toEqual([
      "privacy.localRoute",
      "privacy.levels.high.residency",
    ]);
  });
});

describe("applyPrivacy", () => {
  it("US1-2: `allow` without residencies keeps the rule's chain as it is", () => {
    expect(step(settings(), inspected("none"))).toEqual({
      kind: "route",
      action: "allow",
      chain: [ANTHROPIC, OPENAI, MISTRAL],
      allowedResidencies: ["local", "eu", "us", "global"],
    });
  });

  it("US1-1: `restrict_to_local` uses the local route and allows only local", () => {
    const outcome = step(
      settings({ critical: { action: "restrict_to_local" } }),
      inspected("critical"),
    );
    expect(outcome).toEqual({
      kind: "route",
      action: "restrict_to_local",
      chain: [OLLAMA],
      allowedResidencies: ["local"],
    });
  });

  it("US1-3: `block` blocks with reason `action`", () => {
    expect(step(settings({ critical: { action: "block" } }), inspected("critical"))).toEqual({
      kind: "block",
      reason: "action",
    });
  });

  it("US1-4: the level's residencies filter the chain, keeping its order", () => {
    const outcome = step(
      settings({ high: { action: "anonymize", residency: ["local", "eu"] } }),
      inspected("high"),
    );
    expect(outcome).toEqual({
      kind: "route",
      action: "anonymize",
      chain: [MISTRAL],
      allowedResidencies: ["local", "eu"],
    });
  });

  it("intersects the rule's residency statement with the level's", () => {
    const outcome = applyPrivacy({
      chain: [MISTRAL, OLLAMA],
      ruleResidency: ["eu", "local"],
      privacy: settings({ high: { action: "allow", residency: ["local"] } }),
      localChain: [OLLAMA],
      inspection: inspected("high"),
    });
    expect(outcome).toEqual({
      kind: "route",
      action: "allow",
      chain: [OLLAMA],
      allowedResidencies: ["local"],
    });
  });

  it("US1-5: nothing left after filtering blocks with reason `no_target`", () => {
    expect(
      step(settings({ high: { action: "anonymize", residency: ["local"] } }), inspected("high")),
    ).toEqual({ kind: "block", reason: "no_target" });
  });

  it("US3-1 (decision part): a failed inspection applies `onDetectorError`, never allow", () => {
    expect(step(settings(), FAILED)).toMatchObject({
      kind: "route",
      action: "restrict_to_local",
      chain: [OLLAMA],
    });
    expect(step({ ...settings(), onDetectorError: "block" }, FAILED)).toEqual({
      kind: "block",
      reason: "detector_unavailable",
    });
  });
});

describe("decide with privacy", () => {
  const strict = validPolicy({
    ...examplePolicyInput(),
    privacy: {
      ...PERMISSIVE_PRIVACY,
      levels: {
        none: { action: "allow" },
        low: { action: "allow" },
        high: { action: "anonymize", residency: ["local", "eu"] },
        critical: { action: "block" },
      },
    },
  });
  const code = { requestedModel: "gpt-4o", taskType: "code", size: "short" } as const;

  it("records the sensitivity of the inspection and the action", () => {
    const decision = decideRoute(strict, { ...code, inspection: inspected("high") });
    expect(decision).toMatchObject({
      kind: "route",
      ruleId: "code-to-frontier",
      sensitivity: "high",
      privacyAction: "anonymize",
      allowedResidencies: ["local", "eu"],
    });
    expect(decision.chain.map((t) => t.id)).toEqual(["mistral-small"]);
  });

  it("a blocked decision has no chain and carries the rule, the level and the reason", () => {
    const decision = decide(strict, { ...code, inspection: inspected("critical") });
    expect(decision).toEqual({
      kind: "block",
      policyId: strict.id,
      policyVersion: strict.version,
      ruleId: "code-to-frontier",
      taskType: "code",
      size: "short",
      sensitivity: "critical",
      privacyAction: "block",
      reason: "action",
    });
  });

  it("a failed inspection is recorded as sensitivity `unknown`", () => {
    const decision = decideRoute(strict, { ...code, inspection: FAILED });
    expect(decision.sensitivity).toBe("unknown");
    expect(decision.privacyAction).toBe("restrict_to_local");
  });

  it("an uninspected request keeps the 003 route", () => {
    const decision = decideRoute(strict, { ...code, inspection: NOT_INSPECTED });
    expect(decision.chain.map((t) => t.id)).toEqual([
      "anthropic-sonnet",
      "openai-mini",
      "mistral-small",
    ]);
  });
});
