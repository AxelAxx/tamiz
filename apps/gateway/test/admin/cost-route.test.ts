import { readFile } from "node:fs/promises";
import { CostReportSchema } from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import { aggregateCost } from "../../src/application/audit/aggregates.js";
import { createInMemoryAuditLog } from "../../src/infrastructure/cache/in-memory-audit-log.js";
import { ADMIN_AUTH, AUTH, createTestApp } from "../helpers/app.js";
import { sampleEntry } from "../support/audit-entries.js";

// Spec 006 US3-1 … US3-4, FR-012 (tasks.md T029 in memory, T030).

const DAY = 24 * 60;
const RANGE = "from=2026-10-01T00:00:00.000Z&to=2026-10-04T00:00:00.000Z";

/** Three days: 3 entries on day 1, 2 on day 2, 1 on day 3, plus one blocked and one failed. */
function threeDays() {
  const audit = createInMemoryAuditLog();
  for (const n of [1, 2, 3, DAY + 1, DAY + 2, 2 * DAY + 3]) audit.append(sampleEntry(n));
  const {
    target: _target,
    usage: _usage,
    baselineCostUsd: _baseline,
    ...blocked
  } = sampleEntry(10, { outcome: "blocked", costUsd: 0 });
  audit.append(blocked);
  const { usage: _failedUsage, ...failed } = sampleEntry(11, { outcome: "failed", costUsd: 0 });
  audit.append(failed);
  return audit;
}

async function cost(query: string, auth: Record<string, string> = ADMIN_AUTH) {
  const { send } = await createTestApp({ audit: threeDays() });
  const response = await send(`/v1/admin/cost?${query}`, { headers: auth });
  return { response, json: (await response.json()) as Record<string, unknown> };
}

describe("cost aggregates (in memory)", () => {
  it("US3-1: one row per UTC day, ordered, with tokens and both costs", async () => {
    const result = await threeDays().cost(
      { from: "2026-10-01T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z" },
      "day",
    );
    expect(result.rows.map((r) => [r.key, r.requests])).toEqual([
      ["2026-10-01", 3],
      ["2026-10-02", 2],
      ["2026-10-03", 1],
    ]);
    // Day 1: n = 1, 2 (mistral, 0.000007 each) and n = 3 (local, 0).
    expect(result.rows[0]).toMatchObject({
      inputTokens: 120,
      outputTokens: 30,
      costUsd: 0.000014,
      baselineCostUsd: 0.00081,
    });
    expect(result.blocked).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("US3-2: a local answer costs zero and keeps its baseline cost", () => {
    const local = sampleEntry(3);
    expect(local.target?.residency).toBe("local");
    const [row] = aggregateCost([local], "route").rows;
    expect(row).toMatchObject({ key: "ollama-llama", costUsd: 0, baselineCostUsd: 0.00027 });
  });

  it("US3-3: by route and by model; failed requests stay out of the rows", () => {
    const entries = [1, 2, 3, 4, 5, 6].map((n) => sampleEntry(n));
    const failed = sampleEntry(7, { outcome: "failed", costUsd: 0 });
    const byRoute = aggregateCost([...entries, failed], "route");
    expect(byRoute.rows.map((r) => [r.key, r.requests])).toEqual([
      ["mistral-small", 4],
      ["ollama-llama", 2],
    ]);
    expect(byRoute.failed).toBe(1);
    expect(aggregateCost(entries, "model").rows.map((r) => r.key)).toEqual([
      "llama3.1:8b",
      "mistral-small-latest",
    ]);
  });

  it("the range is [from, to)", async () => {
    const result = await threeDays().cost(
      { from: "2026-10-02T00:00:00.000Z", to: "2026-10-03T00:00:00.000Z" },
      "day",
    );
    expect(result.rows.map((r) => r.key)).toEqual(["2026-10-02"]);
  });
});

describe("GET /v1/admin/cost", () => {
  it("US3-1, US3-4: rows, totals, the not-served line and the named baseline", async () => {
    const { response, json } = await cost(`${RANGE}&groupBy=day`);
    expect(response.status).toBe(200);
    const report = CostReportSchema.parse(json);
    expect(report.baseline).toEqual({
      targetId: "anthropic-sonnet",
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
    });
    expect(report.rows).toHaveLength(3);
    expect(report.totals).toEqual({
      key: "total",
      requests: 6,
      inputTokens: 240,
      outputTokens: 60,
      costUsd: 0.000028,
      baselineCostUsd: 0.00162,
    });
    expect(report.notServed).toEqual({ requests: 2, blocked: 1, failed: 1 });
  });

  it("groupBy defaults to day", async () => {
    const { json } = await cost(RANGE);
    expect(json["groupBy"]).toBe("day");
  });

  it.each([
    ["from missing", "to=2026-10-04T00:00:00.000Z"],
    ["to missing", "from=2026-10-01T00:00:00.000Z"],
    ["not a date", "from=yesterday&to=2026-10-04T00:00:00.000Z"],
    ["empty range", "from=2026-10-04T00:00:00.000Z&to=2026-10-01T00:00:00.000Z"],
    ["unknown group", `${RANGE}&groupBy=week`],
  ])("400 when %s", async (_name, query) => {
    const { response, json } = await cost(query);
    expect(response.status).toBe(400);
    expect((json["error"] as { type: string }).type).toBe("invalid_request");
  });

  it("403 for a client key", async () => {
    expect((await cost(RANGE, AUTH)).response.status).toBe(403);
  });

  it("the contract example parses", async () => {
    const example: unknown = JSON.parse(
      await readFile(
        new URL(
          "../../../../specs/006-audit-and-telemetry/contracts/cost-report.example.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(CostReportSchema.safeParse(example).success).toBe(true);
  });
});
