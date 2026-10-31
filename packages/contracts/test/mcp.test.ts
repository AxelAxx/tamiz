import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GetCostReportInputSchema,
  GetProviderHealthInputSchema,
  MCP_TOOL_NAMES,
  McpToolErrorSchema,
  McpToolNameSchema,
  ProvidersReportSchema,
  QueryAuditLogInputSchema,
  SimulateRoutingInputSchema,
} from "../src/index.js";

// Spec 009 FR-001, FR-007 … FR-011, data-model sections 1.1, 1.2 and 1.4 (tasks.md T001).

const example = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../specs/009-mcp-agent/contracts/tool-result.example.json"),
    "utf8",
  ),
) as {
  success: { result: { structuredContent: unknown } };
  error: { result: { content: { text: string }[] } };
};

const RANGE = { from: "2026-10-30T00:00:00Z", to: "2026-10-31T00:00:00Z" };

describe("McpToolNameSchema", () => {
  it("names the four tools", () => {
    expect([...MCP_TOOL_NAMES]).toEqual([
      "simulate_routing",
      "query_audit_log",
      "get_cost_report",
      "get_provider_health",
    ]);
    expect(McpToolNameSchema.safeParse("nope").success).toBe(false);
  });
});

describe("SimulateRoutingInputSchema", () => {
  it("accepts a text or a list of messages, with an optional model", () => {
    expect(SimulateRoutingInputSchema.safeParse({ text: "hola" }).success).toBe(true);
    expect(
      SimulateRoutingInputSchema.safeParse({
        messages: [{ role: "user", content: "hola" }],
        model: "auto",
      }).success,
    ).toBe(true);
  });

  it("bounds the text at 1 … 32 000 characters", () => {
    expect(SimulateRoutingInputSchema.safeParse({ text: "" }).success).toBe(false);
    expect(SimulateRoutingInputSchema.safeParse({ text: "a".repeat(32_000) }).success).toBe(true);
    expect(SimulateRoutingInputSchema.safeParse({ text: "a".repeat(32_001) }).success).toBe(false);
  });

  it("requires at least one message", () => {
    expect(SimulateRoutingInputSchema.safeParse({ messages: [] }).success).toBe(false);
  });

  it("requires exactly one of text and messages", () => {
    expect(SimulateRoutingInputSchema.safeParse({}).success).toBe(false);
    expect(
      SimulateRoutingInputSchema.safeParse({
        text: "hola",
        messages: [{ role: "user", content: "hola" }],
      }).success,
    ).toBe(false);
  });

  it("bounds the model at 1 … 200 characters", () => {
    expect(SimulateRoutingInputSchema.safeParse({ text: "x", model: "" }).success).toBe(false);
    expect(
      SimulateRoutingInputSchema.safeParse({ text: "x", model: "m".repeat(201) }).success,
    ).toBe(false);
  });
});

describe("QueryAuditLogInputSchema", () => {
  it("defaults the page size to 20 and caps it at 50, without string coercion", () => {
    expect(QueryAuditLogInputSchema.parse({}).limit).toBe(20);
    expect(QueryAuditLogInputSchema.safeParse({ limit: 50 }).success).toBe(true);
    expect(QueryAuditLogInputSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(QueryAuditLogInputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(QueryAuditLogInputSchema.safeParse({ limit: "20" }).success).toBe(false);
  });

  it("takes the filters of the admin audit query", () => {
    const parsed = QueryAuditLogInputSchema.parse({
      ...RANGE,
      route: "ollama-llama",
      rule: "pinned-local",
      sensitivity: "critical",
      action: "restrict_to_local",
      entity: "DNI",
      outcome: "answered",
      cursor: "abc",
    });
    expect(parsed.entity).toBe("DNI");
    expect(QueryAuditLogInputSchema.safeParse({ entity: "PASSWORD" }).success).toBe(false);
    expect(QueryAuditLogInputSchema.safeParse({ from: "yesterday" }).success).toBe(false);
  });
});

describe("GetCostReportInputSchema", () => {
  it("requires the range and defaults the grouping to day", () => {
    expect(GetCostReportInputSchema.parse(RANGE).groupBy).toBe("day");
    expect(GetCostReportInputSchema.safeParse({ from: RANGE.from }).success).toBe(false);
    expect(GetCostReportInputSchema.safeParse({ ...RANGE, groupBy: "week" }).success).toBe(false);
  });
});

describe("GetProviderHealthInputSchema", () => {
  it("defaults the window to 15 minutes and bounds it at 1 … 1440", () => {
    expect(GetProviderHealthInputSchema.parse({}).windowMinutes).toBe(15);
    expect(GetProviderHealthInputSchema.safeParse({ windowMinutes: 0 }).success).toBe(false);
    expect(GetProviderHealthInputSchema.safeParse({ windowMinutes: 1441 }).success).toBe(false);
    expect(GetProviderHealthInputSchema.safeParse({ windowMinutes: 1.5 }).success).toBe(false);
    expect(GetProviderHealthInputSchema.safeParse({ windowMinutes: "15" }).success).toBe(false);
  });
});

describe("tool inputs are strict", () => {
  it.each([
    ["simulate_routing", SimulateRoutingInputSchema, { text: "x" }],
    ["query_audit_log", QueryAuditLogInputSchema, {}],
    ["get_cost_report", GetCostReportInputSchema, RANGE],
    ["get_provider_health", GetProviderHealthInputSchema, {}],
  ] as const)("%s rejects an extra field", (_name, schema, valid) => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
});

describe("McpToolErrorSchema", () => {
  it.each([
    "gateway_unreachable",
    "gateway_timeout",
    "gateway_unauthorized",
    "gateway_forbidden",
    "gateway_rejected",
    "gateway_error",
    "gateway_contract",
  ])("accepts the code %s", (code) => {
    expect(McpToolErrorSchema.safeParse({ error: { code, message: "m" } }).success).toBe(true);
  });

  it("rejects an unknown code, a long message and extra fields", () => {
    expect(McpToolErrorSchema.safeParse({ error: { code: "nope", message: "m" } }).success).toBe(
      false,
    );
    expect(
      McpToolErrorSchema.safeParse({ error: { code: "gateway_error", message: "m".repeat(501) } })
        .success,
    ).toBe(false);
    expect(
      McpToolErrorSchema.safeParse({ error: { code: "gateway_error", message: "m", key: "k" } })
        .success,
    ).toBe(false);
  });
});

describe("tool-result.example.json", () => {
  it("has a success that parses with the provider health contract", () => {
    expect(ProvidersReportSchema.safeParse(example.success.result.structuredContent).success).toBe(
      true,
    );
  });

  it("has an error whose text parses with the tool error contract", () => {
    const text = example.error.result.content[0]?.text ?? "";
    expect(McpToolErrorSchema.safeParse(JSON.parse(text)).success).toBe(true);
  });
});
