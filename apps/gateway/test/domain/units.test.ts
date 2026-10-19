import { describe, expect, it } from "vitest";
import {
  clientId,
  clientIdUnchecked,
  milliseconds,
  millisecondsUnchecked,
  policyId,
  policyIdUnchecked,
  requestId,
  requestIdUnchecked,
  ruleId,
  ruleIdUnchecked,
  targetId,
  targetIdUnchecked,
  usd,
  usdUnchecked,
} from "../../src/domain/model/units.js";

// Spec 002, research R-01, tasks.md T005: the domain owns its branded units.

describe("validating constructors", () => {
  it.each([
    ["usd(-1)", () => usd(-1)],
    ["usd(NaN)", () => usd(Number.NaN)],
    ["usd(Infinity)", () => usd(Number.POSITIVE_INFINITY)],
    ["milliseconds(1.5)", () => milliseconds(1.5)],
    ["milliseconds(-1)", () => milliseconds(-1)],
    ['targetId("Bad Id")', () => targetId("Bad Id")],
    ['targetId("-leading-dash")', () => targetId("-leading-dash")],
    ["targetId of 65 characters", () => targetId("a".repeat(65))],
    ['ruleId("Upper")', () => ruleId("Upper")],
    ['policyId("")', () => policyId("")],
    ['policyId("has space")', () => policyId("has space")],
    ["requestId of 129 characters", () => requestId("a".repeat(129))],
    ['requestId("a=b")', () => requestId("a=b")],
    ['clientId("")', () => clientId("")],
  ])("%s returns a validation error", (_label, build) => {
    const result = build();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(result.error.issues).toHaveLength(1);
    }
  });

  it.each([
    ["usd(0)", () => usd(0), 0],
    ["usd(0.15)", () => usd(0.15), 0.15],
    ["milliseconds(0)", () => milliseconds(0), 0],
    ["milliseconds(30000)", () => milliseconds(30_000), 30_000],
    ['targetId("ollama-llama")', () => targetId("ollama-llama"), "ollama-llama"],
    ["targetId of 64 characters", () => targetId("a".repeat(64)), "a".repeat(64)],
    ['ruleId("code-to-frontier")', () => ruleId("code-to-frontier"), "code-to-frontier"],
    ['policyId("Default_Policy-1")', () => policyId("Default_Policy-1"), "Default_Policy-1"],
    ["requestId of 128 characters", () => requestId("A".repeat(128)), "A".repeat(128)],
    ['clientId("billing-app")', () => clientId("billing-app"), "billing-app"],
  ])("%s returns ok with the same primitive", (_label, build, expected) => {
    expect(build()).toEqual({ ok: true, value: expected });
  });

  it("names the given path in the issue, and `value` by default", () => {
    const named = usd(-1, "targets.0.pricing.inputUsdPerMillion");
    const unnamed = usd(-1);
    expect(named.ok ? undefined : named.error.issues[0]?.path).toBe(
      "targets.0.pricing.inputUsdPerMillion",
    );
    expect(unnamed.ok ? undefined : unnamed.error.issues[0]?.path).toBe("value");
  });

  it("never echoes the offending value in the message", () => {
    const result = targetId("Secret Value");
    expect(JSON.stringify(result)).not.toContain("Secret Value");
  });
});

describe("unchecked constructors", () => {
  it("brand values without validating them (values already checked at the edge)", () => {
    expect(usdUnchecked(-1)).toBe(-1);
    expect(millisecondsUnchecked(1.5)).toBe(1.5);
    expect(targetIdUnchecked("Bad Id")).toBe("Bad Id");
    expect(ruleIdUnchecked("Bad Id")).toBe("Bad Id");
    expect(policyIdUnchecked("")).toBe("");
    expect(requestIdUnchecked("a=b")).toBe("a=b");
    expect(clientIdUnchecked("")).toBe("");
  });
});
