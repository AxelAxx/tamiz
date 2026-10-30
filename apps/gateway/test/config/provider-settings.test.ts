import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RoutingPolicy } from "../../src/domain/model/routing-policy.js";
import { checkProviderSettings } from "../../src/infrastructure/config/provider-settings.js";
import { loadPolicyFile } from "../../src/infrastructure/policy/file-policy-loader.js";

// Spec 002 US2-3, FR-021 (tasks.md T039): every provider a target uses must be
// configured; the message names the target and the setting, never a configured value.

const SECRET = "sk-test-SECRET-provider-settings";

async function defaultPolicy(): Promise<RoutingPolicy> {
  const result = await loadPolicyFile(resolve(import.meta.dirname, "../../policies/default.yaml"));
  if (!result.ok) throw new Error("the default policy must load");
  return result.value;
}

describe("checkProviderSettings (FR-021)", () => {
  it("returns ok when every provider used by a target is configured", async () => {
    const result = checkProviderSettings(await defaultPolicy(), {
      providers: {
        ollama: { baseUrl: "http://localhost:11434/v1" },
        mistral: { apiKey: SECRET },
        anthropic: { apiKey: SECRET },
        openai: { apiKey: SECRET },
      },
    });

    expect(result.ok).toBe(true);
  });

  it("names the target and the missing setting, and never a configured value (US2-3)", async () => {
    const result = checkProviderSettings(await defaultPolicy(), {
      providers: {
        ollama: { baseUrl: "http://localhost:11434/v1" },
        anthropic: { apiKey: SECRET, baseUrl: "https://proxy.example/SECRET" },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("configuration");
    expect(result.error.issues.map((issue) => issue.message)).toEqual([
      "target mistral-small: provider mistral needs MISTRAL_API_KEY",
      "target openai-mini: provider openai needs OPENAI_API_KEY",
    ]);
    expect(result.error.issues.map((issue) => issue.path)).toEqual([
      "targets.1.provider",
      "targets.2.provider",
    ]);
    expect(JSON.stringify(result.error)).not.toContain("SECRET");
  });

  it("asks for OLLAMA_BASE_URL when Ollama has no settings", async () => {
    const result = checkProviderSettings(await defaultPolicy(), {
      providers: {
        mistral: { apiKey: SECRET },
        anthropic: { apiKey: SECRET },
        openai: { apiKey: SECRET },
      },
    });

    expect(!result.ok && result.error.issues.map((issue) => issue.message)).toEqual([
      "target ollama-llama: provider ollama needs OLLAMA_BASE_URL",
    ]);
  });
});
