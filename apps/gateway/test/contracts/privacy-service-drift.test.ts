import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PrivacyAnalyzeRequestSchema,
  PrivacyAnalyzeResponseSchema,
  PrivacyEntityKindSchema,
  PrivacyFindingSchema,
  PrivacySensitivitySchema,
} from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

// Spec 005 FR-010, research R-03 (tasks.md T012): the Zod mirror in `@tamiz/contracts`
// agrees with the privacy service's committed OpenAPI document. A change on either side
// fails here, naming the component.

interface Component {
  readonly properties?: Record<string, unknown>;
  readonly required?: ReadonlyArray<string>;
  readonly additionalProperties?: boolean;
  readonly enum?: ReadonlyArray<string>;
}

const openapi = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../../services/privacy/openapi.json"), "utf8"),
) as { components: { schemas: Record<string, Component> } };
const components = openapi.components.schemas;

function component(name: string): Component {
  const found = components[name];
  if (found === undefined) throw new Error(`openapi.json has no component ${name}`);
  return found;
}

function requiredKeys(schema: z.ZodObject): string[] {
  return Object.entries(schema.shape)
    .filter(([, field]) => !(field as z.ZodType).safeParse(undefined).success)
    .map(([key]) => key)
    .sort();
}

describe("privacy service contract mirror (FR-010)", () => {
  it.each([
    ["EntityKind", PrivacyEntityKindSchema.options],
    ["SensitivityLevel", PrivacySensitivitySchema.options],
  ])("%s has the same closed list", (name, options) => {
    expect([...options]).toEqual(component(name).enum);
  });

  it.each([
    ["AnalyzeRequest", PrivacyAnalyzeRequestSchema],
    ["FindingOut", PrivacyFindingSchema],
    ["AnalyzeResponse", PrivacyAnalyzeResponseSchema],
  ] as const)("%s has the same fields and required list", (name, schema) => {
    const expected = component(name);
    expect(Object.keys(schema.shape).sort()).toEqual(Object.keys(expected.properties ?? {}).sort());
    expect(requiredKeys(schema)).toEqual([...(expected.required ?? [])].sort());
  });

  it("the request rejects unknown fields on both sides", () => {
    expect(component("AnalyzeRequest").additionalProperties).toBe(false);
    expect(PrivacyAnalyzeRequestSchema.safeParse({ text: "x", extra: 1 }).success).toBe(false);
  });

  it("the committed analyze example parses with the mirror", () => {
    const example = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../../specs/004-privacy-service/contracts/analyze.example.json",
        ),
        "utf8",
      ),
    ) as { request: unknown; response: unknown };
    expect(PrivacyAnalyzeRequestSchema.safeParse(example.request).success).toBe(true);
    expect(PrivacyAnalyzeResponseSchema.safeParse(example.response).success).toBe(true);
  });
});
