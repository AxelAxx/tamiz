import { describe, expect, it } from "vitest";
import { PrivacySectionSchema } from "../src/index.js";

// Spec 005 FR-002, US6-1, data-model section 1.2 (tasks.md T001).

const valid = {
  onDetectorError: "restrict_to_local",
  localRoute: ["ollama-llama"],
  levels: {
    none: { action: "allow" },
    low: { action: "allow" },
    high: { action: "anonymize", residency: ["local", "eu"] },
    critical: { action: "restrict_to_local" },
  },
};

function paths(input: unknown): string[] {
  const result = PrivacySectionSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
}

describe("PrivacySectionSchema", () => {
  it("parses the default section of research R-11", () => {
    expect(paths(valid)).toEqual([]);
  });

  it("requires every level", () => {
    const { critical: _dropped, ...levels } = valid.levels;
    expect(paths({ ...valid, levels })).toEqual(["levels.critical"]);
  });

  it("rejects an unknown action, unknown keys and `allow` on detector error", () => {
    expect(paths({ ...valid, levels: { ...valid.levels, low: { action: "log" } } })).toEqual([
      "levels.low.action",
    ]);
    expect(paths({ ...valid, extra: true })).toEqual([""]);
    expect(paths({ ...valid, onDetectorError: "allow" })).toEqual(["onDetectorError"]);
  });

  it("rejects an empty local route and repeated residencies", () => {
    expect(paths({ ...valid, localRoute: [] })).toEqual(["localRoute"]);
    expect(
      paths({
        ...valid,
        levels: { ...valid.levels, high: { action: "allow", residency: ["eu", "eu"] } },
      }),
    ).toEqual(["levels.high.residency"]);
  });
});
