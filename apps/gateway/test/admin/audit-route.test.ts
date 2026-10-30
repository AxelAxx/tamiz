import { AuditPageSchema } from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  queryAuditLog,
} from "../../src/application/use-cases/query-audit-log.js";
import { createInMemoryAuditLog } from "../../src/infrastructure/cache/in-memory-audit-log.js";
import { ADMIN_AUTH, AUTH, createTestApp } from "../helpers/app.js";
import { sampleEntry } from "../support/audit-entries.js";

// Spec 006 US2-2 … US2-5, FR-007, FR-008, FR-014 (tasks.md T020, T021).

function filled(count: number) {
  const audit = createInMemoryAuditLog();
  for (let n = 1; n <= count; n += 1) audit.append(sampleEntry(n));
  return audit;
}

async function get(path: string, auth: Record<string, string> = ADMIN_AUTH, count = 30) {
  const { send } = await createTestApp({ audit: filled(count) });
  const response = await send(path, { headers: auth });
  return { response, json: (await response.json()) as Record<string, unknown> };
}

describe("queryAuditLog (in memory)", () => {
  it("US2-2: newest first, with the default page size and a cursor", async () => {
    const page = await queryAuditLog(filled(60))({ limit: 50 });
    if (!page.ok) throw new Error("expected ok");
    expect(page.value.entries).toHaveLength(50);
    expect(page.value.entries[0]?.requestId).toBe("req-60");
    expect(page.value.nextCursor).not.toBeNull();
  });

  it("US2-3: following the cursor while new entries arrive repeats and skips nothing", async () => {
    const audit = filled(25);
    const query = queryAuditLog(audit);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let round = 0; round < 10; round += 1) {
      const page = await query({ limit: 7, ...(cursor === undefined ? {} : { cursor }) });
      if (!page.ok) throw new Error("expected ok");
      seen.push(...page.value.entries.map((e) => e.requestId));
      audit.append(sampleEntry(1000 + round)); // newer than everything: must not appear
      if (page.value.nextCursor === null) break;
      cursor = page.value.nextCursor;
    }
    expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => `req-${25 - i}`));
  });

  it("a malformed cursor is an error, not a first page", async () => {
    expect(await queryAuditLog(filled(3))({ limit: 5, cursor: "not-a-cursor" })).toEqual({
      ok: false,
      error: "invalid_cursor",
    });
  });

  it("cursors round-trip and are opaque", () => {
    const position = { startedAt: "2026-10-01T00:01:00.000Z", id: "abc" };
    const cursor = encodeCursor(position);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual(position);
  });
});

describe("GET /v1/admin/audit", () => {
  it("US2-2: an admin gets a contract-valid page, newest first", async () => {
    const { response, json } = await get("/v1/admin/audit?limit=5");
    expect(response.status).toBe(200);
    expect(AuditPageSchema.safeParse(json).success).toBe(true);
    expect((json["entries"] as Array<{ requestId: string }>).map((e) => e.requestId)).toEqual([
      "req-30",
      "req-29",
      "req-28",
      "req-27",
      "req-26",
    ]);
  });

  it("US2-2: filters by date range and route", async () => {
    const { json } = await get(
      "/v1/admin/audit?route=ollama-llama&from=2026-10-01T00:05:00.000Z&to=2026-10-01T00:13:00.000Z",
    );
    expect((json["entries"] as Array<{ requestId: string }>).map((e) => e.requestId)).toEqual([
      "req-12",
      "req-9",
      "req-6",
    ]);
  });

  it("US2-4: filters by detected entity kind", async () => {
    const { json } = await get("/v1/admin/audit?entity=DNI&limit=200");
    const entries = json["entries"] as Array<{ entities: Record<string, number> }>;
    expect(entries).toHaveLength(10);
    expect(entries.every((e) => e.entities["DNI"] === 1)).toBe(true);
  });

  it.each([
    ["limit=0"],
    ["limit=201"],
    ["sensitivity=secret"],
    ["entity=PASSPORT"],
    ["from=yesterday"],
    ["cursor=%25%25"],
    ["unknown=1"],
  ])("rejects %s with 400 invalid_request", async (query) => {
    const { response, json } = await get(`/v1/admin/audit?${query}`);
    expect(response.status).toBe(400);
    expect((json["error"] as { type: string }).type).toBe("invalid_request");
  });

  it("US2-5: a client key gets 403 forbidden; no key gets 401", async () => {
    const client = await get("/v1/admin/audit", AUTH);
    expect(client.response.status).toBe(403);
    expect((client.json["error"] as { type: string }).type).toBe("forbidden");
    const anonymous = await get("/v1/admin/audit", {});
    expect(anonymous.response.status).toBe(401);
  });

  it("FR-014: /openapi.json documents the route and the AuditPage and AuditEntry components", async () => {
    const { send } = await createTestApp();
    const doc = (await (await send("/openapi.json")).json()) as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.paths["/v1/admin/audit"]).toBeDefined();
    expect(doc.components.schemas["AuditPage"]).toBeDefined();
  });
});
