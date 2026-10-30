import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RESIDENCIES } from "../../src/domain/model/model-target.js";
import {
  PRIVACY_ACTIONS,
  type PrivacyLevelSettings,
  type PrivacySettingsInput,
} from "../../src/domain/model/privacy-policy.js";
import { decide } from "../../src/domain/model/routing-decision.js";
import { validatePolicy } from "../../src/domain/model/routing-policy.js";
import {
  DETECTOR_FAILURES,
  type Inspection,
  SENSITIVITY_LEVELS,
} from "../../src/domain/model/sensitivity.js";
import { TASK_SIZES, TASK_TYPES } from "../../src/domain/model/task-classifier.js";
import { examplePolicyInput } from "./helpers/policies.js";

// Spec 005 SC-001, FR-005 (tasks.md T003): over at least 10 000 generated privacy
// sections, rule residencies and inspections, critical data never reaches a target
// outside local and eu unless anonymized, and a block never has a target.

const NUM_RUNS = 10_000;

const residencyListArb = fc.subarray([...RESIDENCIES], { minLength: 1 });
const levelArb: fc.Arbitrary<PrivacyLevelSettings> = fc.record(
  { action: fc.constantFrom(...PRIVACY_ACTIONS), residency: residencyListArb },
  { requiredKeys: ["action"] },
);
const privacyArb: fc.Arbitrary<PrivacySettingsInput> = fc.record({
  onDetectorError: fc.constantFrom("restrict_to_local", "block"),
  localRoute: fc.constant(["ollama-llama"]),
  levels: fc.record({ none: levelArb, low: levelArb, high: levelArb, critical: levelArb }),
});
const inspectionArb: fc.Arbitrary<Inspection> = fc.oneof(
  fc.record({
    status: fc.constant("ok" as const),
    level: fc.constantFrom(...SENSITIVITY_LEVELS),
    entities: fc.constant([]),
  }),
  fc.record({
    status: fc.constant("failed" as const),
    reason: fc.constantFrom(...DETECTOR_FAILURES),
  }),
);
const requestArb = fc.record({
  requestedModel: fc.constantFrom("gpt-4o", "tamiz-local", "claude"),
  taskType: fc.constantFrom(...TASK_TYPES),
  size: fc.constantFrom(...TASK_SIZES),
  inspection: inspectionArb,
});

describe("privacy decision properties (SC-001, FR-005)", () => {
  it("critical requests in clear stay in local and eu; blocks have no target; routes are non-empty and allowed", () => {
    let checked = 0;
    fc.assert(
      fc.property(privacyArb, requestArb, (privacy, req) => {
        const base = examplePolicyInput();
        const validated = validatePolicy({
          ...base,
          default: { route: ["mistral-small", "openai-mini", "ollama-llama"] },
          privacy,
        });
        // Policies the boot check rejects never route traffic (US6-2); skip them.
        fc.pre(validated.ok);
        if (!validated.ok) return;
        checked += 1;

        const decision = decide(validated.value, req);
        if (decision.kind === "block") {
          expect("chain" in decision).toBe(false);
          return;
        }
        expect(decision.chain.length).toBeGreaterThan(0);
        for (const t of decision.chain) {
          expect(decision.allowedResidencies).toContain(t.residency);
        }
        const critical = req.inspection.status === "ok" && req.inspection.level === "critical";
        if (critical && decision.privacyAction !== "anonymize") {
          for (const t of decision.chain) expect(["local", "eu"]).toContain(t.residency);
        }
        if (req.inspection.status === "failed") {
          expect(decision.privacyAction).toBe("restrict_to_local");
          expect(decision.sensitivity).toBe("unknown");
        }
      }),
      { numRuns: NUM_RUNS },
    );
    expect(checked).toBeGreaterThan(NUM_RUNS / 2);
  });
});
