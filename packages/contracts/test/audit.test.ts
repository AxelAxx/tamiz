import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditEntrySchema } from "../src/index.js";

// Spec 006 FR-002, FR-003, data-model section 1.1 (tasks.md T001).

const example = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      "../../../specs/006-audit-and-telemetry/contracts/audit-entry.example.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;

describe("AuditEntrySchema", () => {
  it("parses the committed example", () => {
    expect(AuditEntrySchema.safeParse(example).success).toBe(true);
  });

  it.each(["prompt", "messages", "text", "values", "mapping"])(
    "has no place for content: rejects a `%s` field",
    (field) => {
      expect(AuditEntrySchema.safeParse({ ...example, [field]: "x" }).success).toBe(false);
    },
  );

  it("requires a 64-hex keyed hash", () => {
    expect(AuditEntrySchema.safeParse({ ...example, requestHash: "abc" }).success).toBe(false);
  });

  it("keeps entity counts positive and per known kind", () => {
    expect(AuditEntrySchema.safeParse({ ...example, entities: { DNI: 0 } }).success).toBe(false);
    expect(AuditEntrySchema.safeParse({ ...example, entities: { PASSPORT: 1 } }).success).toBe(
      false,
    );
  });
});

describe("AuditEntrySchema tools summary (009 tool-calling FR-018, US6-1)", () => {
  const tools = { declared: 3, toolMessages: 1, called: ["get_patient"] };

  it("accepts counts and called tool names", () => {
    expect(AuditEntrySchema.safeParse({ ...example, tools }).success).toBe(true);
  });

  it.each(["arguments", "results", "definitions"])("has no place for tool %s", (field) => {
    const withContent = { ...example, tools: { ...tools, [field]: "x" } };
    expect(AuditEntrySchema.safeParse(withContent).success).toBe(false);
  });

  it("keeps at most 32 names, each a tool-name identifier", () => {
    const many = { ...tools, called: Array.from({ length: 33 }, () => "t") };
    expect(AuditEntrySchema.safeParse({ ...example, tools: many }).success).toBe(false);
    const prose = { ...tools, called: ["Ana Ruiz Gil"] };
    expect(AuditEntrySchema.safeParse({ ...example, tools: prose }).success).toBe(false);
  });
});
