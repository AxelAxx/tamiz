// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/lib/server/env";

// Spec 008 US1-6, FR-005, data-model §3.3 (tasks.md T001).

const HASH = `scrypt$16384$8$1$${Buffer.from("salt-salt-salt-1").toString("base64")}$${Buffer.alloc(32, 7).toString("base64")}`;
const ADMIN_KEY = "tmz_dashboard-admin-key-test-value-0000000000";
const SECRET = "s".repeat(32);

const complete = {
  TAMIZ_GATEWAY_URL: "http://localhost:3000",
  TAMIZ_DASHBOARD_ADMIN_KEY: ADMIN_KEY,
  TAMIZ_DASHBOARD_PASSPHRASE_HASH: HASH,
  TAMIZ_DASHBOARD_SESSION_SECRET: SECRET,
  TAMIZ_DASHBOARD_PUBLIC_URL: "https://tamiz.example.com/",
};

function issuesOf(source: Record<string, string | undefined>): ReadonlyArray<string> {
  const result = parseEnv(source);
  if (result.ok) throw new Error("expected the configuration to be refused");
  return result.issues;
}

describe("dashboard configuration", () => {
  it("US1-6: accepts a complete set and applies the defaults", () => {
    const result = parseEnv(complete);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      gatewayUrl: "http://localhost:3000",
      adminKey: ADMIN_KEY,
      passphraseHash: HASH,
      sessionSecret: SECRET,
      publicOrigin: "https://tamiz.example.com",
      evalsDir: "./data/evals",
      trustProxy: false,
    });
  });

  it("US1-6: reads the optional evals folder and proxy trust", () => {
    const result = parseEnv({
      ...complete,
      TAMIZ_DASHBOARD_EVALS_DIR: "/srv/evals",
      TAMIZ_DASHBOARD_TRUST_PROXY: "true",
    });
    expect(result.ok && result.value.evalsDir).toBe("/srv/evals");
    expect(result.ok && result.value.trustProxy).toBe(true);
  });

  it("US1-6: lists every missing required variable at once", () => {
    const issues = issuesOf({});
    for (const name of [
      "TAMIZ_GATEWAY_URL",
      "TAMIZ_DASHBOARD_ADMIN_KEY",
      "TAMIZ_DASHBOARD_PASSPHRASE_HASH",
      "TAMIZ_DASHBOARD_SESSION_SECRET",
      "TAMIZ_DASHBOARD_PUBLIC_URL",
    ]) {
      expect(issues.some((issue) => issue.startsWith(`${name}:`))).toBe(true);
    }
    expect(issues).toHaveLength(5);
  });

  it.each([
    ["TAMIZ_GATEWAY_URL", "not a url"],
    ["TAMIZ_GATEWAY_URL", "ftp://gateway.example.com"],
    ["TAMIZ_DASHBOARD_ADMIN_KEY", "has whitespace"],
    ["TAMIZ_DASHBOARD_ADMIN_KEY", ""],
    ["TAMIZ_DASHBOARD_PASSPHRASE_HASH", "plain-passphrase"],
    ["TAMIZ_DASHBOARD_PASSPHRASE_HASH", "scrypt$16384$8$1$onlysalt"],
    ["TAMIZ_DASHBOARD_SESSION_SECRET", "too-short-secret"],
    ["TAMIZ_DASHBOARD_PUBLIC_URL", "tamiz.example.com"],
    ["TAMIZ_DASHBOARD_TRUST_PROXY", "yes"],
  ])("US1-6: refuses a malformed %s", (name, value) => {
    const issues = issuesOf({ ...complete, [name]: value });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(new RegExp(`^${name}: `));
  });

  it("US1-6: lists several malformed variables together", () => {
    const issues = issuesOf({
      ...complete,
      TAMIZ_GATEWAY_URL: "nope",
      TAMIZ_DASHBOARD_SESSION_SECRET: "short",
    });
    expect(issues).toHaveLength(2);
  });

  it("US1-6: never prints a secret value in an issue", () => {
    const secrets = {
      TAMIZ_DASHBOARD_ADMIN_KEY: "leaky key with spaces",
      TAMIZ_DASHBOARD_PASSPHRASE_HASH: "scrypt$leaky-hash-value",
      TAMIZ_DASHBOARD_SESSION_SECRET: "leaky-secret",
    };
    const issues = issuesOf({ ...complete, ...secrets });
    expect(issues).toHaveLength(3);
    const text = issues.join("\n");
    for (const value of Object.values(secrets)) expect(text).not.toContain(value);
  });
});
