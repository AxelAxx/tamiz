import { AuditPageSchema, CostReportSchema, McpToolErrorSchema } from "@tamiz/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeGateway } from "./support/fake-gateway.js";
import { AUDIT_ENTRY, AUDIT_PAGES } from "./support/fixtures.js";
import { connect, type Session, textJson } from "./support/mcp-harness.js";

// Spec 009 US3-1 … US3-5 (tasks.md T017).

const RANGE = { from: "2026-10-29T00:00:00Z", to: "2026-10-31T00:00:00Z" };

let session: Session | undefined;

afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe("US3 query_audit_log and get_cost_report", () => {
  it("US3-1 forwards exactly the given filters and returns a contract-valid page", async () => {
    session = await connect();
    const filters = {
      ...RANGE,
      route: "ollama-llama",
      rule: "pinned-local",
      sensitivity: "critical",
      action: "restrict_to_local",
      entity: "DNI",
      outcome: "answered",
      limit: 5,
    };
    const result = await session.client.callTool({ name: "query_audit_log", arguments: filters });
    await session.client.callTool({ name: "query_audit_log", arguments: { rule: "default" } });

    expect(result.isError).not.toBe(true);
    const [full, partial] = session.fake.requests;
    expect(full?.method).toBe("GET");
    expect(full?.path).toBe("/v1/admin/audit");
    expect(full?.query).toEqual({ ...filters, limit: "5" });
    // Filters left out are absent from the query, not sent as "undefined".
    expect(partial?.query).toEqual({ rule: "default", limit: "20" });

    const page = AuditPageSchema.parse(result.structuredContent);
    expect(page).toEqual(AUDIT_PAGES.first);
    expect(page.nextCursor).toBe("page-2");
    expect(textJson(result)).toEqual(result.structuredContent);
  });

  it("US3-2 returns the following page for the next cursor", async () => {
    session = await connect();
    const first = await session.client.callTool({ name: "query_audit_log", arguments: {} });
    const cursor = AuditPageSchema.parse(first.structuredContent).nextCursor;
    const second = await session.client.callTool({
      name: "query_audit_log",
      arguments: { cursor },
    });

    expect(session.fake.requests[1]?.query).toEqual({ cursor: "page-2", limit: "20" });
    expect(AuditPageSchema.parse(second.structuredContent)).toEqual(AUDIT_PAGES.second);
  });

  it("US3-3 asks for 20 entries by default and rejects a page size above 50", async () => {
    session = await connect();
    await session.client.callTool({ name: "query_audit_log", arguments: {} });
    expect(session.fake.requests.map((request) => request.query)).toEqual([{ limit: "20" }]);

    const tooLarge = await session.client.callTool({
      name: "query_audit_log",
      arguments: { limit: 51 },
    });
    expect(tooLarge.isError).toBe(true);
    expect(JSON.stringify(tooLarge.content)).toContain("Input validation error");
    expect(session.fake.requests).toHaveLength(1);
  });

  it.each(["day", "route", "model"] as const)(
    "US3-4 returns a contract-valid cost report grouped by %s",
    async (groupBy) => {
      session = await connect();
      const result = await session.client.callTool({
        name: "get_cost_report",
        arguments: { ...RANGE, groupBy },
      });

      expect(session.fake.requests[0]?.path).toBe("/v1/admin/cost");
      expect(session.fake.requests[0]?.query).toEqual({ ...RANGE, groupBy });
      const report = CostReportSchema.parse(result.structuredContent);
      expect(report.groupBy).toBe(groupBy);
      expect(report.rows.length).toBeGreaterThan(0);
      expect(report.baseline).not.toBeNull();
      expect(report.notServed).toBeDefined();
      expect(report.totals).toBeDefined();
    },
  );

  it("US3-4 groups the cost report by day when no grouping is given", async () => {
    session = await connect();
    await session.client.callTool({ name: "get_cost_report", arguments: RANGE });
    expect(session.fake.requests[0]?.query).toEqual({ ...RANGE, groupBy: "day" });
  });

  it("US2-7 passes the gateway's 400 message for a range that is not ordered", async () => {
    session = await connect();
    const result = await session.client.callTool({
      name: "get_cost_report",
      arguments: { from: RANGE.to, to: RANGE.from },
    });
    expect(McpToolErrorSchema.parse(textJson(result)).error).toEqual({
      code: "gateway_rejected",
      message: "from must be before to",
    });
  });

  it.each([
    ["query_audit_log", {}, { entries: [{ ...AUDIT_ENTRY, prompt: "hola" }], nextCursor: null }],
    ["get_cost_report", RANGE, { rows: [], answer: "hola" }],
  ])(
    "US3-5 turns an answer with fields outside the contract into gateway_contract (%s)",
    async (name, args, body) => {
      const fake = createFakeGateway();
      fake.fail({ kind: "body", body });
      session = await connect({ fake });
      const result = await session.client.callTool({ name, arguments: args });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      const toolError = McpToolErrorSchema.parse(textJson(result));
      expect(toolError.error.code).toBe("gateway_contract");
      // The message names where the answer broke the contract, never the offending value.
      expect(toolError.error.message).not.toContain("hola");
    },
  );
});
