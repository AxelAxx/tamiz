import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SimulateResponseSchema } from "../src/index.js";

// Spec 005 FR-019, data-model section 1.3 (tasks.md T044).

const example = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      "../../../specs/005-privacy-aware-routing/contracts/simulate.example.json",
    ),
    "utf8",
  ),
) as { response: Record<string, unknown> };

describe("SimulateResponseSchema", () => {
  it("parses the committed example", () => {
    expect(SimulateResponseSchema.safeParse(example.response).success).toBe(true);
  });

  it("rejects unknown fields", () => {
    expect(SimulateResponseSchema.safeParse({ ...example.response, prompt: "x" }).success).toBe(
      false,
    );
  });

  it("requires blockReason exactly when the decision is block", () => {
    const blocked = {
      ...example.response,
      decision: "block",
      privacyAction: "block",
      chain: [],
      allowedResidencies: [],
    };
    expect(SimulateResponseSchema.safeParse(blocked).success).toBe(false);
    expect(SimulateResponseSchema.safeParse({ ...blocked, blockReason: "action" }).success).toBe(
      true,
    );
    expect(
      SimulateResponseSchema.safeParse({ ...example.response, blockReason: "action" }).success,
    ).toBe(false);
  });
});

describe("SimulateResponseSchema with tool calling (009 tool-calling FR-015)", () => {
  const entity = { kind: "DNI", start: 1, end: 10, score: 0.99 };

  it("accepts every entity location and the notAnonymizable reason", () => {
    const entities = [
      { ...entity, messageIndex: 2, location: { kind: "content", messageIndex: 2 } },
      {
        ...entity,
        messageIndex: 1,
        location: { kind: "arguments", messageIndex: 1, toolCallIndex: 0 },
      },
      { ...entity, location: { kind: "tool_definition", toolIndex: 0 } },
    ];
    const response = { ...example.response, entities, notAnonymizable: "json_structure" };
    expect(SimulateResponseSchema.safeParse(response).success).toBe(true);
  });

  it("rejects an unknown location kind", () => {
    const entities = [{ ...entity, location: { kind: "schema", toolIndex: 0 } }];
    expect(SimulateResponseSchema.safeParse({ ...example.response, entities }).success).toBe(false);
  });
});
