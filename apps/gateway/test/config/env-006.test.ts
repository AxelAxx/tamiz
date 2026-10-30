import { describe, expect, it } from "vitest";
import {
  createAuthenticator,
  hashApiKey,
  type StoredKeyLookup,
} from "../../src/infrastructure/auth/api-keys.js";
import { loadConfig } from "../../src/infrastructure/config/env.js";

// Spec 006 FR-003, FR-005, FR-006, FR-008, research R-06 (tasks.md T014).

const BASE = {
  TAMIZ_API_KEYS: `demo:${"0".repeat(64)}`,
  TAMIZ_PRIVACY_URL: "http://privacy.test:8001",
} as const;
const KEY = "a".repeat(40);

function issues(env: Record<string, string>) {
  const result = loadConfig(env);
  if (result.ok) throw new Error("expected the environment to be rejected");
  return result.error.issues.map((issue) => issue.path);
}

describe("database and admin settings", () => {
  it("DATABASE_URL requires TAMIZ_AUDIT_HASH_KEY", () => {
    expect(issues({ ...BASE, DATABASE_URL: "postgres://u:p@db:5432/tamiz" })).toEqual([
      "TAMIZ_AUDIT_HASH_KEY",
    ]);
  });

  it("rejects a non-postgres DATABASE_URL without echoing it", () => {
    const result = loadConfig({
      ...BASE,
      DATABASE_URL: "mysql://secret-host/db",
      TAMIZ_AUDIT_HASH_KEY: KEY,
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret-host");
  });

  it("reads the database URL and the admin keys with their role", () => {
    const result = loadConfig({
      ...BASE,
      DATABASE_URL: "postgresql://u:p@db:5432/tamiz",
      TAMIZ_AUDIT_HASH_KEY: KEY,
      TAMIZ_ADMIN_API_KEYS: `ops:${"1".repeat(64)}`,
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.databaseUrl).toBe("postgresql://u:p@db:5432/tamiz");
    expect(result.value.apiKeys).toEqual([
      { clientId: "demo", keyHash: "0".repeat(64), role: "client" },
      { clientId: "ops", keyHash: "1".repeat(64), role: "admin" },
    ]);
  });

  it("names a malformed admin entry by position", () => {
    expect(issues({ ...BASE, TAMIZ_ADMIN_API_KEYS: "ops:nothex" })).toEqual([
      "TAMIZ_ADMIN_API_KEYS[0]",
    ]);
  });
});

describe("createAuthenticator", () => {
  const records = [
    { clientId: "demo", keyHash: hashApiKey("tmz_demo"), role: "client" as const },
    { clientId: "ops", keyHash: hashApiKey("tmz_ops"), role: "admin" as const },
  ];
  const stored: StoredKeyLookup = {
    async findByHash(hash) {
      if (hash === hashApiKey("tmz_db"))
        return { clientId: "db-client", role: "client", revoked: false };
      if (hash === hashApiKey("tmz_revoked"))
        return { clientId: "gone", role: "admin", revoked: true };
      return undefined;
    },
  };

  it("finds environment keys with their role", async () => {
    const authenticate = createAuthenticator(records);
    expect(await authenticate("tmz_demo")).toEqual({ clientId: "demo", role: "client" });
    expect(await authenticate("tmz_ops")).toEqual({ clientId: "ops", role: "admin" });
    expect(await authenticate("tmz_db")).toBeUndefined();
  });

  it("falls back to the database, and refuses a revoked key", async () => {
    const authenticate = createAuthenticator(records, stored);
    expect(await authenticate("tmz_db")).toEqual({ clientId: "db-client", role: "client" });
    expect(await authenticate("tmz_revoked")).toBeUndefined();
    expect(await authenticate("tmz_nope")).toBeUndefined();
  });
});
