import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/infrastructure/config/env.js";

// Spec 001, US4 scenarios 2 and 3 (FR-015): configuration is loaded through a schema and
// an invalid environment yields a typed failure, never an exception.

const here = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8")) as {
  readonly version: string;
};

describe("loadConfig", () => {
  it("US4-2: returns ok with the documented defaults for an empty environment", () => {
    const result = loadConfig({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      port: 3000,
      host: "0.0.0.0",
      logLevel: "info",
      nodeEnv: "development",
      version: packageJson.version,
      policyFile: "policies/default.yaml",
      providers: { ollama: { baseUrl: "http://localhost:11434/v1" } },
    });
  });

  it("returns a frozen config object", () => {
    const result = loadConfig({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it("reads explicit values and coerces PORT to a number", () => {
    const result = loadConfig({
      PORT: "8080",
      HOST: "127.0.0.1",
      LOG_LEVEL: "debug",
      NODE_ENV: "production",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.port).toBe(8080);
    expect(result.value.host).toBe("127.0.0.1");
    expect(result.value.logLevel).toBe("debug");
    expect(result.value.nodeEnv).toBe("production");
  });

  it("APP_VERSION overrides the package version", () => {
    const result = loadConfig({ APP_VERSION: "9.9.9-container" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe("9.9.9-container");
  });

  it("ignores unrelated environment variables", () => {
    const result = loadConfig({ PATH: "/usr/bin", HOME: "/home/x" });
    expect(result.ok).toBe(true);
  });

  it("US4-3: returns a configuration error listing every invalid variable", () => {
    const result = loadConfig({ PORT: "abc", LOG_LEVEL: "loud" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("configuration");
    const paths = result.error.issues.map((issue) => issue.path).sort();
    expect(paths).toEqual(["LOG_LEVEL", "PORT"]);
  });

  it("US4-3: issue messages state the expected format and never echo the value", () => {
    const result = loadConfig({ PORT: "abc", LOG_LEVEL: "loud", NODE_ENV: "staging" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const byPath = new Map(result.error.issues.map((issue) => [issue.path, issue.message]));
    expect(byPath.get("PORT")).toMatch(/1.*65535/);
    expect(byPath.get("LOG_LEVEL")).toMatch(/fatal.*error.*warn.*info.*debug.*trace/);
    expect(byPath.get("NODE_ENV")).toMatch(/development.*test.*production/);
    for (const message of byPath.values()) {
      expect(message).not.toContain("abc");
      expect(message).not.toContain("loud");
      expect(message).not.toContain("staging");
    }
  });

  it("rejects a port outside 1-65535 and a non-integer port", () => {
    expect(loadConfig({ PORT: "0" }).ok).toBe(false);
    expect(loadConfig({ PORT: "65536" }).ok).toBe(false);
    expect(loadConfig({ PORT: "80.5" }).ok).toBe(false);
  });
});
