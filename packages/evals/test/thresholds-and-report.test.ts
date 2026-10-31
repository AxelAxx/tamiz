import { readFile } from "node:fs/promises";
import { EVAL_FAILING_CAP, type EvalReport, EvalReportSchema } from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/report/markdown.js";
import { exitCode } from "../src/runner.js";
import { meets, THRESHOLDS, thresholdsFor } from "../src/thresholds.js";

// Spec 007 US1-1, US1-2, US1-6, FR-003, FR-004 (tasks.md T002, T004).

const EXAMPLE = new URL(
  "../../../specs/007-evals-gate/contracts/report.example.json",
  import.meta.url,
);

async function example(): Promise<EvalReport> {
  return EvalReportSchema.parse(JSON.parse(await readFile(EXAMPLE, "utf8")));
}

describe("thresholds", () => {
  it.each([
    ["eq", 0, 0, true],
    ["eq", 0.001, 0, false],
    ["lt", 0.0199, 0.02, true],
    ["lt", 0.02, 0.02, false],
    ["lte", 0.02, 0.02, true],
    ["gte", 0.95, 0.95, true],
    ["gte", 0.9499, 0.95, false],
  ] as const)("%s: %d against %d → %s", (comparison, value, bound, expected) => {
    expect(meets(value, comparison, bound)).toBe(expected);
  });

  it("the bars are the ones of the spec, in one place", () => {
    const bar = (metric: string) => THRESHOLDS.find((t) => t.metric === metric);
    expect(bar("leak_rate.DNI")).toMatchObject({ comparison: "eq", bound: 0 });
    expect(bar("leak_rate.CREDIT_CARD")).toMatchObject({ comparison: "eq", bound: 0 });
    expect(bar("leak_rate.PERSON")).toMatchObject({ comparison: "lt", bound: 0.02 });
    expect(bar("recall.IBAN")).toMatchObject({ comparison: "gte", bound: 0.95 });
    expect(bar("recall.PERSON")).toMatchObject({ comparison: "gte", bound: 0.8 });
    expect(bar("route_accuracy")).toMatchObject({ comparison: "gte", bound: 0.95 });
    expect(bar("relative_score")).toMatchObject({ comparison: "gte", bound: 0.95 });
    expect(thresholdsFor("cost")).toEqual([]);
  });

  it("009 tool-calling US7-2: fewer than 40 values in tool messages fails the leak gate", () => {
    const bar = THRESHOLDS.find((t) => t.metric === "values.tool_messages");
    expect(bar).toMatchObject({ eval: "leak", comparison: "gte", bound: 40 });
    expect(meets(39, "gte", bar?.bound ?? 0)).toBe(false);
    expect(meets(0, "gte", bar?.bound ?? 0)).toBe(false);
    expect(thresholdsFor("leak").some((t) => t.metric === "leak_rate.LOCATION")).toBe(false);
  });
});

describe("report", () => {
  it("T004: the contract example parses", async () => {
    expect((await example()).evals.map((e) => e.id)).toEqual([
      "leak",
      "detection",
      "routing",
      "quality",
      "cost",
    ]);
  });

  it("the run status maps to the exit code: error > fail > pass", async () => {
    const report = await example();
    expect(exitCode({ ...report, status: "pass" })).toBe(0);
    expect(exitCode({ ...report, status: "fail" })).toBe(1);
    expect(exitCode({ ...report, status: "error" })).toBe(2);
  });

  it("US1-2, US1-6: the Markdown shows status, bars, failing ids and provenance", async () => {
    const markdown = renderMarkdown(await example());
    expect(markdown).toContain("# Tamiz evals — fail");
    expect(markdown).toContain("policy `default` v3");
    expect(markdown).toContain("routing v1 (44)");
    expect(markdown).toContain("| `route_accuracy` | 93.18 % | ≥ 95.00 % | ✗ |");
    expect(markdown).toContain("| `leak_rate.LOCATION` | 61.00 % | reported |  |");
    expect(markdown).toContain("Failing cases (first 1 of 3)");
    expect(markdown).toContain("`routing-017`");
  });

  it("the failing list is capped and the count kept", () => {
    const failing = Array.from({ length: EVAL_FAILING_CAP + 1 }, (_, i) => ({
      id: `routing-${i}`,
      reason: "unexpected route",
    }));
    const report = {
      schemaVersion: 1,
      run: {
        startedAt: "2026-10-31T00:00:00.000Z",
        durationMs: 0,
        selection: ["routing"],
        datasets: [],
        services: {},
        models: {},
      },
      status: "fail",
      evals: [
        { id: "routing", status: "fail", durationMs: 0, metrics: [], failing, failingCount: 51 },
      ],
    };
    expect(EvalReportSchema.safeParse(report).success).toBe(false);
  });
});
