import { describe, expect, it } from "vitest";
import { extractAction } from "../src/agent/action.js";

// Spec 009 US5-3 (part), research R-10, data-model section 4.1 (tasks.md T022).

const CALL = { tool: "get_cost_report", arguments: { groupBy: "day" } };

describe("extractAction", () => {
  it("reads a bare object", () => {
    expect(extractAction(JSON.stringify(CALL))).toEqual({ ok: true, value: CALL });
  });

  it("reads an object inside a json code fence", () => {
    const text = `\`\`\`json\n${JSON.stringify(CALL, null, 2)}\n\`\`\``;
    expect(extractAction(text)).toEqual({ ok: true, value: CALL });
  });

  it("reads an object after prose, with braces inside strings", () => {
    const text = `Let me check the costs first. {"answer": "Spend {roughly} doubled"} Done.`;
    expect(extractAction(text)).toEqual({
      ok: true,
      value: { answer: "Spend {roughly} doubled" },
    });
  });

  it("defaults the arguments of a tool call to an empty object", () => {
    expect(extractAction('{"tool": "get_provider_health"}')).toEqual({
      ok: true,
      value: { tool: "get_provider_health", arguments: {} },
    });
  });

  it("takes the first of two objects", () => {
    expect(extractAction('{"answer": "first"} {"answer": "second"}')).toEqual({
      ok: true,
      value: { answer: "first" },
    });
  });

  it.each([
    ["an empty answer", '{"answer": ""}'],
    ["no JSON at all", "Spend rose because of the frontier route."],
    ["a JSON array", '[{"answer": "x"}]'],
    ["an object of neither shape", '{"thought": "hmm"}'],
    ["both shapes at once", '{"tool": "x", "answer": "y"}'],
    ["arguments that are not an object", '{"tool": "x", "arguments": [1]}'],
    ["an unbalanced object", '{"answer": "x"'],
    ["invalid JSON", "{answer: x}"],
  ])("fails on %s", (_case, text) => {
    expect(extractAction(text)).toEqual({ ok: false, error: "format" });
  });
});
