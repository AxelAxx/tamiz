import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CostGroup, TargetWindow } from "../../src/application/audit/aggregates.js";
import type { AuditEntry } from "../../src/domain/model/audit-entry.js";
import { createInMemoryAuditLog } from "../../src/infrastructure/cache/in-memory-audit-log.js";
import {
  createPostgresAuditReader,
  createPostgresAuditStore,
} from "../../src/infrastructure/persistence/audit-log-repository.js";
import {
  connectDatabase,
  type DatabaseHandle,
  runMigrations,
} from "../../src/infrastructure/persistence/db.js";
import { dockerAvailable } from "../helpers/docker.js";
import { sampleEntry } from "../support/audit-entries.js";

// Spec 006 US3-1 … US3-3, US4-2, FR-012, FR-013, SC-005 (tasks.md T029): the SQL cost and
// window aggregates equal the in-memory ones. Needs Docker; CI runs it.

const docker = await dockerAvailable();

/** Four days of traffic with blocked, failed, abandoned and cancelled entries mixed in. */
function entries(): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (let n = 1; n <= 4 * 24 * 60; n += 37) {
    const entry = sampleEntry(n, { latencyMs: 100 + (n % 900) });
    if (n % 11 === 0) {
      const { target: _t, usage: _u, baselineCostUsd: _b, ...blocked } = entry;
      out.push({ ...blocked, outcome: "blocked", costUsd: 0 });
    } else if (n % 13 === 0) {
      out.push({
        ...entry,
        outcome: "failed",
        costUsd: 0,
        abandoned: [{ targetId: "ollama-llama", reason: "timeout" }],
      });
    } else if (n % 17 === 0) {
      out.push({ ...entry, outcome: "cancelled", streamed: true });
    } else {
      out.push(entry);
    }
  }
  return out;
}

it.skipIf(docker)("PostgreSQL aggregate suite is skipped: Docker is not available here", () => {});

describe.skipIf(!docker)("cost and window aggregates on PostgreSQL (Testcontainers)", () => {
  let container: StartedTestContainer;
  let database: DatabaseHandle;
  const memory = createInMemoryAuditLog(100_000);

  beforeAll(async () => {
    container = await new GenericContainer("postgres:17")
      .withEnvironment({ POSTGRES_USER: "t", POSTGRES_PASSWORD: "t", POSTGRES_DB: "t" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    database = connectDatabase(
      `postgres://t:t@${container.getHost()}:${container.getMappedPort(5432)}/t`,
    );
    await runMigrations(database);
    const all = entries();
    await createPostgresAuditStore(database.db).insertBatch(all);
    for (const entry of all) memory.append(entry);
  }, 300_000);

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  it.each<CostGroup>(["day", "route", "model"])(
    "SC-005: cost by %s equals the in-memory aggregate",
    async (groupBy) => {
      const range = { from: "2026-10-01T06:00:00.000Z", to: "2026-10-04T12:00:00.000Z" };
      const fromSql = await createPostgresAuditReader(database.db).cost(range, groupBy);
      const fromMemory = await memory.cost(range, groupBy);
      expect(fromSql.rows.length).toBeGreaterThan(1);
      expect(fromSql).toEqual(fromMemory);
    },
  );

  it("US4-2: the window per target equals the in-memory one", async () => {
    const since = "2026-10-03T00:00:00.000Z";
    // Percentiles are doubles on both sides; compare them to the microsecond.
    const round = (value: number | null) => (value === null ? null : Number(value.toFixed(3)));
    const byId = (rows: ReadonlyArray<TargetWindow>) =>
      [...rows]
        .sort((a, b) => a.targetId.localeCompare(b.targetId))
        .map((w) => ({
          ...w,
          latencyP50Ms: round(w.latencyP50Ms),
          latencyP95Ms: round(w.latencyP95Ms),
        }));
    const fromSql = byId(await createPostgresAuditReader(database.db).window(since));
    const fromMemory = byId(await memory.window(since));
    expect(fromSql.length).toBe(2);
    expect(fromSql).toEqual(fromMemory);
  });
});
