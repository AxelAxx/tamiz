import { describe, expect, it } from "vitest";
import type { SimulateResponse } from "../src/clients/gateway.js";
import type { LeakCase } from "../src/datasets.js";
import { scoreDetection } from "../src/evals/detection.js";
import { leakEval, observeSimulation, scoreLeak } from "../src/evals/leak.js";

// Spec 007 US2-1 … US2-5, US3-1 (tasks.md T013, T014).

const TEXT = "Soy Edurne Zubiri, DNI 06324134P, de Soria.";
const CASE: LeakCase = {
  id: "pii-leak-0001",
  tags: ["clinic"],
  messages: [{ role: "user", content: TEXT }],
  values: [
    { kind: "PERSON", messageIndex: 0, start: 4, end: 17 },
    { kind: "DNI", messageIndex: 0, start: 23, end: 32 },
    { kind: "LOCATION", messageIndex: 0, start: 37, end: 42 },
  ],
};

const target = (id: string, residency: "local" | "eu" | "us") => ({
  id,
  provider: residency === "local" ? ("ollama" as const) : ("mistral" as const),
  model: "m",
  residency,
});

function simulated(overrides: Partial<SimulateResponse> = {}): SimulateResponse {
  return {
    sensitivity: "critical",
    detector: "ok",
    entities: [],
    ruleId: "default",
    decision: "route",
    privacyAction: "restrict_to_local",
    chain: [target("ollama-llama", "local")],
    allowedResidencies: ["local"],
    ...overrides,
  } as SimulateResponse;
}

const leaked = (s: SimulateResponse, c: LeakCase = CASE) =>
  scoreLeak(observeSimulation(c, s)).leaked;

describe("leak scorer", () => {
  it("restricted to local: nothing leaks even though the values are sent verbatim", () => {
    expect(leaked(simulated())).toEqual([false, false, false]);
  });

  it("US2-1: a critical value leaks when any chain target is non-local, fallbacks included", () => {
    const s = simulated({
      privacyAction: "allow",
      sensitivity: "none",
      chain: [target("ollama-llama", "local"), target("mistral-small", "eu")],
    });
    expect(leaked(s)).toEqual([true, true, true]);
  });

  it("US2-2: after anonymize, a placeholder is no leak but a verbatim name is", () => {
    const anonymized = simulated({
      privacyAction: "anonymize",
      sensitivity: "high",
      chain: [target("mistral-small", "eu")],
      providerMessages: [
        { role: "system", content: "Aviso: datos sustituidos por marcadores." },
        { role: "user", content: "Soy <PERSON_1>, DNI <DNI_1>, de Soria." },
      ],
    });
    expect(leaked(anonymized)).toEqual([false, false, true]);
    const missed = simulated({
      ...anonymized,
      providerMessages: [{ role: "user", content: "Soy Edurne Zubiri, DNI <DNI_1>, de Soria." }],
    });
    expect(leaked(missed)).toEqual([true, false, true]);
  });

  it("the anonymization notice is searched too", () => {
    const s = simulated({
      privacyAction: "anonymize",
      chain: [target("mistral-small", "eu")],
      providerMessages: [
        { role: "system", content: "Edurne Zubiri" },
        { role: "user", content: "Soy <PERSON_1>." },
      ],
    });
    expect(leaked(s)[0]).toBe(true);
  });

  it("US2-3: a blocked request leaks nothing", () => {
    const s = simulated({
      decision: "block",
      blockReason: "action",
      privacyAction: "block",
      chain: [],
    });
    expect(leaked(s)).toEqual([false, false, false]);
  });

  it("values are compared after NFC normalization", () => {
    const decomposed = "Soy Begoña Zubiri.";
    const c: LeakCase = {
      ...CASE,
      messages: [{ role: "user", content: "Soy Begoña Zubiri." }],
      values: [{ kind: "PERSON", messageIndex: 0, start: 4, end: 17 }],
    };
    const s = simulated({
      privacyAction: "allow",
      chain: [target("mistral-small", "eu")],
      providerMessages: [{ role: "user", content: decomposed }],
    });
    expect(leaked(s, c)).toEqual([true]);
  });

  it("US2-4, US2-5: rates per kind, failing values listed by position; low kinds reported only", () => {
    const s = simulated({
      privacyAction: "allow",
      sensitivity: "low",
      chain: [target("mistral-small", "eu")],
    });
    const result = scoreLeak(observeSimulation(CASE, s));
    const summary = leakEval.summarize([{ c: CASE, result }]);
    const metric = (name: string) => summary.metrics.find((m) => m.name === name)?.value;
    expect(metric("leak_rate.DNI")).toBe(1);
    expect(metric("leak_rate.LOCATION")).toBe(1);
    expect(metric("values.PERSON")).toBe(1);
    expect(summary.failing[1]).toEqual({
      id: "pii-leak-0001",
      reason: "value would reach a non-local target verbatim",
      expected: { kind: "DNI", messageIndex: 0, start: 23, end: 32 },
      actual: { privacyAction: "allow", sensitivity: "low", chain: "mistral-small" },
    });
    expect(JSON.stringify(summary)).not.toContain("06324134P");
  });
});

describe("detection scorer", () => {
  it("US3-1: structured kinds need exact offsets; names and places overlap", () => {
    const labels = [
      { kind: "DNI" as const, start: 4, end: 13 },
      { kind: "PERSON" as const, start: 20, end: 35 },
      { kind: "IBAN" as const, start: 40, end: 64 },
    ];
    const findings = [
      { kind: "DNI" as const, start: 4, end: 13 },
      { kind: "PERSON" as const, start: 17, end: 30 },
      { kind: "IBAN" as const, start: 40, end: 60 },
      { kind: "EMAIL" as const, start: 70, end: 80 },
    ];
    const { tp, fp, fn } = scoreDetection(labels, findings);
    expect(tp.map((f) => f.kind)).toEqual(["DNI", "PERSON"]);
    expect(fp.map((f) => f.kind)).toEqual(["IBAN", "EMAIL"]);
    expect(fn).toEqual([{ kind: "IBAN", start: 40, end: 64 }]);
  });

  it("each annotation is matched at most once", () => {
    const labels = [{ kind: "PERSON" as const, start: 0, end: 20 }];
    const findings = [
      { kind: "PERSON" as const, start: 0, end: 10 },
      { kind: "PERSON" as const, start: 11, end: 20 },
    ];
    const { tp, fp } = scoreDetection(labels, findings);
    expect(tp).toHaveLength(1);
    expect(fp).toHaveLength(1);
  });
});
