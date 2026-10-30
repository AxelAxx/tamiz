import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/infrastructure/config/env.js";

/** A valid `TAMIZ_API_KEYS` (required since spec 002 T-002-06); a test hash, not a secret. */
const BASE = { TAMIZ_API_KEYS: `demo:${"0".repeat(64)}` } as const;

// Spec 002 research R-12, data-model section 5 (tasks.md T039): the policy file and the
// provider settings join the 001 environment schema. Secrets are never echoed.

const SECRET = "sk-test-SECRET-env-002";

describe("loadConfig, feature 002 settings", () => {
  it("defaults the policy file and the Ollama base URL, and leaves keyed providers unset", () => {
    const result = loadConfig(BASE);

    expect(result.ok && result.value.policyFile).toBe("policies/default.yaml");
    expect(result.ok && result.value.providers).toEqual({
      ollama: { baseUrl: "http://localhost:11434/v1" },
    });
  });

  it("parses provider keys and base URL overrides into providers", () => {
    const result = loadConfig({
      ...BASE,
      TAMIZ_POLICY_FILE: "policies/local-only.yaml",
      OLLAMA_BASE_URL: "http://ollama:11434/v1",
      MISTRAL_API_KEY: SECRET,
      MISTRAL_BASE_URL: "https://mistral-proxy.example/v1",
      ANTHROPIC_API_KEY: SECRET,
      OPENAI_API_KEY: SECRET,
      OPENAI_BASE_URL: "https://openai-proxy.example/v1",
    });

    expect(result.ok && result.value.policyFile).toBe("policies/local-only.yaml");
    expect(result.ok && result.value.providers).toEqual({
      ollama: { baseUrl: "http://ollama:11434/v1" },
      mistral: { apiKey: SECRET, baseUrl: "https://mistral-proxy.example/v1" },
      anthropic: { apiKey: SECRET },
      openai: { apiKey: SECRET, baseUrl: "https://openai-proxy.example/v1" },
    });
  });

  it("treats an empty key as unset, so `MISTRAL_API_KEY=` means not configured", () => {
    const result = loadConfig({ ...BASE, MISTRAL_API_KEY: "", MISTRAL_BASE_URL: "" });

    expect(result.ok && result.value.providers).toEqual({
      ollama: { baseUrl: "http://localhost:11434/v1" },
    });
  });

  it("ignores a base URL override without its key: the provider stays unconfigured", () => {
    const result = loadConfig({
      ...BASE,
      ANTHROPIC_BASE_URL: "https://anthropic-proxy.example/v1",
    });

    expect(result.ok && result.value.providers).not.toHaveProperty("anthropic");
  });

  it("rejects an invalid URL with a configuration issue that does not echo it", () => {
    const result = loadConfig({
      ...BASE,
      OPENAI_BASE_URL: "not a url SECRET",
      OLLAMA_BASE_URL: "nope",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.map((issue) => issue.path).sort()).toEqual([
      "OLLAMA_BASE_URL",
      "OPENAI_BASE_URL",
    ]);
    expect(JSON.stringify(result.error)).not.toContain("SECRET");
  });

  it("US5-4: requires TAMIZ_API_KEYS and names a malformed entry by position, never its text", () => {
    const missing = loadConfig({});
    const malformed = loadConfig({ TAMIZ_API_KEYS: `demo:${"0".repeat(64)},Bad_Entry-SECRET` });

    expect(!missing.ok && missing.error.issues.map((issue) => issue.path)).toEqual([
      "TAMIZ_API_KEYS",
    ]);
    expect(!malformed.ok && malformed.error.issues.map((issue) => issue.path)).toEqual([
      "TAMIZ_API_KEYS[1]",
    ]);
    expect(JSON.stringify(malformed)).not.toContain("SECRET");
  });
});
