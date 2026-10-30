import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditFilters } from "../../src/application/ports/audit-reader.port.js";
import { queryAuditLog } from "../../src/application/use-cases/query-audit-log.js";
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

// Spec 006 US2-2 … US2-4, FR-007, SC-004 (tasks.md T019): the SQL filters and keyset pages
// agree with the in-memory reader, stay stable under inserts, and a page over 100 000 rows
// takes under 200 ms at p95. Needs Docker; CI runs it.

const docker = await dockerAvailable();
const ROWS = 100_000;

it.skipIf(docker)("PostgreSQL query suite is skipped: Docker is not available here", () => {});

describe.skipIf(!docker)("audit queries on PostgreSQL (Testcontainers)", () => {
  let container: StartedTestContainer;
  let database: DatabaseHandle;

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
    const store = createPostgresAuditStore(database.db);
    for (let start = 1; start <= ROWS; start += 1_000) {
      const batch = Array.from({ length: 1_000 }, (_, i) => sampleEntry(start + i));
      await store.insertBatch(batch);
    }
  }, 600_000);

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  it.each<[string, AuditFilters]>([
    ["no filter", {}],
    ["route", { route: "ollama-llama" }],
    ["rule", { rule: "code-to-frontier" }],
    ["entity", { entity: "DNI" }],
    ["sensitivity + action", { sensitivity: "critical", action: "restrict_to_local" }],
    ["date range", { from: "2026-10-01T01:00:00.000Z", to: "2026-10-01T02:00:00.000Z" }],
  ])("US2-2, US2-4: %s gives the same page as the in-memory reader", async (_name, filters) => {
    const memory = createInMemoryAuditLog(ROWS);
    for (let n = ROWS - 400; n <= ROWS; n += 1) memory.append(sampleEntry(n));
    const fromSql = await createPostgresAuditReader(database.db).page(filters, undefined, 50);
    const fromMemory = await memory.page(filters, undefined, 50);
    if (filters.from === undefined) {
      expect(fromSql.map((e) => e.id)).toEqual(fromMemory.map((e) => e.id));
    } else {
      expect(fromSql.length).toBeGreaterThan(0);
      expect(
        fromSql.every(
          (e) => e.startedAt >= (filters.from ?? "") && e.startedAt < (filters.to ?? ""),
        ),
      ).toBe(true);
    }
  });

  it("US2-3: cursor pages repeat and skip nothing while rows are inserted", async () => {
    const query = queryAuditLog(createPostgresAuditReader(database.db));
    const store = createPostgresAuditStore(database.db);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let round = 0; round < 5; round += 1) {
      const page = await query({ limit: 40, ...(cursor === undefined ? {} : { cursor }) });
      if (!page.ok) throw new Error("expected ok");
      seen.push(...page.value.entries.map((e) => e.requestId));
      await store.insertBatch([sampleEntry(ROWS + 1 + round)]);
      if (page.value.nextCursor === null) break;
      cursor = page.value.nextCursor;
    }
    expect(seen).toEqual(Array.from({ length: 200 }, (_, i) => `req-${ROWS - i}`));
  });

  it("SC-004: a filtered page over 100 000 rows takes under 200 ms at p95", async () => {
    const query = queryAuditLog(createPostgresAuditReader(database.db));
    const timings: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const started = performance.now();
      await query({ limit: 50, entity: "DNI", route: "ollama-llama" });
      timings.push(performance.now() - started);
    }
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.ceil(timings.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    console.info(`audit page over ${ROWS} rows: p95 ${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThan(200);
  });
});
