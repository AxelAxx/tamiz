import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/infrastructure/config/env.js";

// Spec 002 research R-12, data-model section 5 (tasks.md T039): the policy file and the
// provider settings join the 001 environment schema. Secrets are never echoed.

const SECRET = "sk-test-SECRET-env-002";

describe("loadConfig, feature 002 settings", () => {
  it("defaults the policy file and the Ollama base URL, and leaves keyed providers unset", () => {
    const result = loadConfig({});

    expect(result.ok && result.value.policyFile).toBe("policies/default.yaml");
    expect(result.ok && result.value.providers).toEqual({
      ollama: { baseUrl: "http://localhost:11434/v1" },
    });
  });

  it("parses provider keys and base URL overrides into providers", () => {
    const result = loadConfig({
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
    const result = loadConfig({ MISTRAL_API_KEY: "", MISTRAL_BASE_URL: "" });

    expect(result.ok && result.value.providers).toEqual({
      ollama: { baseUrl: "http://localhost:11434/v1" },
    });
  });

  it("ignores a base URL override without its key: the provider stays unconfigured", () => {
    const result = loadConfig({ ANTHROPIC_BASE_URL: "https://anthropic-proxy.example/v1" });

    expect(result.ok && result.value.providers).not.toHaveProperty("anthropic");
  });

  it("rejects an invalid URL with a configuration issue that does not echo it", () => {
    const result = loadConfig({ OPENAI_BASE_URL: "not a url SECRET", OLLAMA_BASE_URL: "nope" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.map((issue) => issue.path).sort()).toEqual([
      "OLLAMA_BASE_URL",
      "OPENAI_BASE_URL",
    ]);
    expect(JSON.stringify(result.error)).not.toContain("SECRET");
  });
});
