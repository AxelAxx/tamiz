import { AuditEntrySchema } from "@tamiz/contracts";
import { sql } from "drizzle-orm";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntry } from "../../src/domain/model/audit-entry.js";
import { hashApiKey } from "../../src/infrastructure/auth/api-keys.js";
import { createPostgresApiKeyRepository } from "../../src/infrastructure/persistence/api-key-repository.js";
import {
  createPostgresAuditStore,
  fromRow,
} from "../../src/infrastructure/persistence/audit-log-repository.js";
import {
  connectDatabase,
  type DatabaseHandle,
  runMigrations,
} from "../../src/infrastructure/persistence/db.js";
import { auditEntries } from "../../src/infrastructure/persistence/schema.js";
import { dockerAvailable } from "../helpers/docker.js";

// Spec 006 US2-1, FR-005, FR-006 (tasks.md T012, T014). Needs Docker (Testcontainers,
// `postgres:17`): reported as skipped, with the reason, when it is unavailable; CI runs it.

const docker = await dockerAvailable();

const ENTRY: AuditEntry = {
  id: "5f0c8a3e-2b7d-4c1a-9e6f-1d2c3b4a5e60",
  requestId: "req-1",
  clientId: "demo",
  startedAt: "2026-10-30T10:15:02.120Z",
  endedAt: "2026-10-30T10:15:03.480Z",
  latencyMs: 1360,
  requestHash: "b".repeat(64),
  policyId: "default",
  policyVersion: 3,
  ruleId: "default",
  taskType: "chat",
  size: "short",
  sensitivity: "high",
  entities: { PERSON: 1, EMAIL: 1 },
  privacyAction: "anonymize",
  noticeVersion: "v1",
  outcome: "answered",
  streamed: false,
  target: {
    id: "mistral-small",
    provider: "mistral",
    model: "mistral-small-latest",
    residency: "eu",
  },
  abandoned: [{ targetId: "openai-mini", reason: "timeout" }],
  usage: { inputTokens: 40, outputTokens: 10, estimated: false },
  costUsd: 0.000007,
  baselineCostUsd: 0.00027,
  baselineTargetId: "anthropic-sonnet",
};

it.skipIf(docker)("PostgreSQL suites are skipped: Docker is not available here", () => {});

describe.skipIf(!docker)("PostgreSQL persistence (Testcontainers)", () => {
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
  }, 180_000);

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  it("US2-1: migrations create the tables from empty, and a second run changes nothing", async () => {
    await runMigrations(database);
    await runMigrations(database);
    const tables = await database.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    expect(tables.map((row) => row["table_name"])).toEqual(["api_keys", "audit_entries"]);
  });

  it("stores an entry and reads it back equal and contract-valid", async () => {
    await createPostgresAuditStore(database.db).insertBatch([ENTRY]);
    const rows = await database.db.select().from(auditEntries);
    const [row] = rows;
    if (row === undefined) throw new Error("expected a row");
    const back = fromRow(row);
    expect(back).toEqual(ENTRY);
    expect(AuditEntrySchema.safeParse(back).success).toBe(true);
  });

  it("009 tool-calling FR-018: stores the tools summary and reads it back", async () => {
    const withTools = {
      ...ENTRY,
      id: "6f1c2b3a-0d4e-4f5a-8b6c-7d8e9f0a1b2c",
      tools: { declared: 2, toolMessages: 1, called: ["get_patient", "send_reminder"] },
    };
    await createPostgresAuditStore(database.db).insertBatch([withTools]);
    const rows = await database.db.select().from(auditEntries);
    const row = rows.find((candidate) => candidate.id === withTools.id);
    if (row === undefined) throw new Error("expected a row");
    expect(fromRow(row)).toEqual(withTools);
    expect(rows.find((candidate) => candidate.id === ENTRY.id)?.tools).toBeNull();
  });

  it("FR-006: finds a key by hash with its role, and refuses it once revoked", async () => {
    const keys = createPostgresApiKeyRepository(database.db);
    const keyHash = hashApiKey("tmz_db-key");
    await keys.insert({ clientId: "ops", keyHash, role: "admin" });

    expect(await keys.findByHash(keyHash)).toEqual({
      clientId: "ops",
      role: "admin",
      revoked: false,
    });
    await keys.revoke(keyHash, new Date());
    expect((await keys.findByHash(keyHash))?.revoked).toBe(true);
    expect(await keys.findByHash(hashApiKey("tmz_other"))).toBeUndefined();
  });
});
