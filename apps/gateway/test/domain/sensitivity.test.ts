import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTITY_KINDS,
  NOT_INSPECTED,
  SENSITIVITIES,
  SENSITIVITY_LEVELS,
  sensitivityOf,
} from "../../src/domain/model/sensitivity.js";

// Spec 005 FR-001, data-model section 2.1 (tasks.md T005).

describe("sensitivity", () => {
  it("orders the levels from least to most sensitive, after `unknown`", () => {
    expect(SENSITIVITY_LEVELS).toEqual(["none", "low", "high", "critical"]);
    expect(SENSITIVITIES).toEqual(["unknown", "none", "low", "high", "critical"]);
  });

  it("is `unknown` when inspection failed, else the level", () => {
    expect(sensitivityOf({ status: "failed", reason: "timeout" })).toBe("unknown");
    expect(sensitivityOf({ status: "ok", level: "high", entities: [] })).toBe("high");
    expect(sensitivityOf(NOT_INSPECTED)).toBe("none");
  });

  it("has the privacy service's closed list of kinds (services/privacy/openapi.json)", () => {
    const openapi = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../../../../services/privacy/openapi.json"),
        "utf8",
      ),
    ) as { components: { schemas: { EntityKind: { enum: string[] } } } };
    expect([...ENTITY_KINDS]).toEqual(openapi.components.schemas.EntityKind.enum);
  });
});
