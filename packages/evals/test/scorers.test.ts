import { describe, expect, it } from "vitest";
import type { SimulateResponse } from "../src/clients/gateway.js";
import type { LeakCase } from "../src/datasets.js";
import { scoreDetection } from "../src/evals/detection.js";
import { leakEval, observeSimulation, scoreLeak } from "../src/evals/leak.js";
import { type RoutingObservation, routingEval, scoreRouting } from "../src/evals/routing.js";

// Spec 007 US2-1 … US2-5, US3-1, US4-1, US4-2 (tasks.md T013, T014, T020).

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
    taskType: "chat",
    size: "short",
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

// 009 tool-calling US7-1 … US7-3 (tasks.md T026).
describe("leak scorer with tool messages", () => {
  const ARGS = '{"nombre":"Edurne Zubiri"}';
  const RESULT = "DNI 06324134P confirmado.";
  const TOOL_CASE: LeakCase = {
    id: "pii-leak-tool-0001",
    tags: ["tool-both"],
    messages: [
      { role: "user", content: "Busca a la paciente." },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "find", arguments: ARGS } }],
      },
      { role: "tool", tool_call_id: "c1", content: RESULT },
    ],
    values: [
      {
        kind: "PERSON",
        messageIndex: 1,
        start: 11,
        end: 24,
        location: { kind: "arguments", messageIndex: 1, toolCallIndex: 0 },
      },
      { kind: "DNI", messageIndex: 2, start: 4, end: 13 },
    ],
  };
  const eu = [target("mistral-small", "eu")];

  it("US7-1: values in arguments and in tool results count when sent to a non-local target", () => {
    const s = simulated({ privacyAction: "allow", sensitivity: "none", chain: eu });
    expect(leaked(s, TOOL_CASE)).toEqual([true, true]);
  });

  it("US7-1: anonymized arguments and results leak nothing", () => {
    const s = simulated({
      privacyAction: "anonymize",
      chain: eu,
      providerMessages: [
        { role: "system", content: "notice" },
        TOOL_CASE.messages[0] ?? { role: "user", content: "" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "find", arguments: '{"nombre":"<PERSON_1>"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "c1", content: "DNI <DNI_1> confirmado." },
      ],
    });
    expect(leaked(s, TOOL_CASE)).toEqual([false, false]);
  });

  it("US7-3: a DNI left in a tool result with a non-local chain is a leak", () => {
    const s = simulated({
      privacyAction: "anonymize",
      chain: eu,
      providerMessages: [
        { role: "user", content: "Busca a la paciente." },
        { role: "tool", tool_call_id: "c1", content: RESULT },
      ],
    });
    expect(leaked(s, TOOL_CASE)).toEqual([false, true]);
  });

  it("counts values in tool messages apart and reports their leak rate", () => {
    const s = simulated({ privacyAction: "allow", sensitivity: "none", chain: eu });
    const result = scoreLeak(observeSimulation(TOOL_CASE, s));
    const summary = leakEval.summarize([
      { c: TOOL_CASE, result },
      { c: CASE, result: scoreLeak(observeSimulation(CASE, simulated())) },
    ]);
    const metric = (name: string) => summary.metrics.find((m) => m.name === name)?.value;
    expect(metric("values.tool_messages")).toBe(2);
    expect(metric("leak_rate.tool_messages")).toBe(1);
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

describe("routing scorer", () => {
  const routingCase = (route: string) => ({
    id: "routing-001",
    messages: [{ role: "user" as const, content: "Hola" }],
    expected: { taskType: "chat", size: "short", route },
  });
  const observed = (overrides: Partial<RoutingObservation> = {}): RoutingObservation => ({
    route: "mistral-small",
    rule: "default",
    taskType: "chat",
    size: "short",
    sensitivity: "none",
    decision: "route",
    ...overrides,
  });

  it("US4-1: the first target must be the expected route", () => {
    expect(scoreRouting(routingCase("mistral-small"), observed()).ok).toBe(true);
    expect(scoreRouting(routingCase("openai-mini"), observed()).ok).toBe(false);
  });

  it("an expected `block` passes only when the request is blocked", () => {
    expect(
      scoreRouting(routingCase("block"), observed({ decision: "block", route: null })).ok,
    ).toBe(true);
    expect(scoreRouting(routingCase("block"), observed()).ok).toBe(false);
    expect(
      scoreRouting(routingCase("mistral-small"), observed({ decision: "block", route: null })).ok,
    ).toBe(false);
  });

  it("US4-2: a mismatch shows route, rule, task type, size and sensitivity on both sides", () => {
    const c = routingCase("openai-mini");
    const result = scoreRouting(c, observed({ taskType: "summarize", sensitivity: "low" }));
    const summary = routingEval.summarize([{ c, result }]);
    expect(summary.failing).toEqual([
      {
        id: "routing-001",
        reason: "unexpected route",
        expected: { route: "openai-mini", taskType: "chat", size: "short" },
        actual: {
          route: "mistral-small",
          rule: "default",
          taskType: "summarize",
          size: "short",
          sensitivity: "low",
        },
      },
    ]);
    expect(summary.metrics.find((m) => m.name === "task_type_accuracy")?.value).toBe(0);
  });
});
