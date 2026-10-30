import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/infrastructure/config/env.js";

// Spec 005 US3-5, FR-007 … FR-009 (tasks.md T016).

const KEYS = { TAMIZ_API_KEYS: `demo:${"0".repeat(64)}` } as const;

function issues(env: Record<string, string>) {
  const result = loadConfig(env);
  if (result.ok) throw new Error("expected the environment to be rejected");
  return result.error.issues;
}

describe("privacy service settings", () => {
  it("US3-5: TAMIZ_PRIVACY_URL is required and named when missing", () => {
    expect(issues(KEYS).map((issue) => issue.path)).toEqual(["TAMIZ_PRIVACY_URL"]);
  });

  it("rejects a non-http URL without echoing it", () => {
    const found = issues({ ...KEYS, TAMIZ_PRIVACY_URL: "ftp://secret-host/analyze" });
    expect(found.map((issue) => issue.path)).toEqual(["TAMIZ_PRIVACY_URL"]);
    expect(JSON.stringify(found)).not.toContain("secret-host");
  });

  it.each([
    ["TAMIZ_PRIVACY_TIMEOUT_MS", "50"],
    ["TAMIZ_PRIVACY_TIMEOUT_MS", "60000"],
    ["TAMIZ_PRIVACY_CACHE_MAX_ENTRIES", "-1"],
    ["TAMIZ_PRIVACY_CACHE_TTL_MS", "10"],
  ])("rejects %s=%s", (name, value) => {
    const env = { ...KEYS, TAMIZ_PRIVACY_URL: "http://privacy:8001", [name]: value };
    expect(issues(env).map((issue) => issue.path)).toEqual([name]);
  });

  it("reads the values and fills the defaults", () => {
    const result = loadConfig({
      ...KEYS,
      TAMIZ_PRIVACY_URL: "https://privacy.internal",
      TAMIZ_PRIVACY_CACHE_MAX_ENTRIES: "0",
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.privacy).toEqual({
      url: "https://privacy.internal",
      timeoutMs: 2_000,
      cacheMaxEntries: 0,
      cacheTtlMs: 600_000,
    });
  });
});
