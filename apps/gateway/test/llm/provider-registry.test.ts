import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type { ProviderCompletionInput } from "../../src/application/ports/llm-provider.port.js";
import { PROVIDER_NAMES, type ProviderName } from "../../src/domain/model/model-target.js";
import {
  millisecondsUnchecked,
  targetIdUnchecked,
  usdUnchecked,
} from "../../src/domain/model/units.js";
import { createProviderRegistry } from "../../src/infrastructure/llm/provider-registry.js";
import { loadFixture, SECRET_API_KEY } from "./adapter-scenarios.js";
import { useMswServer } from "./msw.js";

// tasks.md T031, spec FR-018: the registry is built once from explicit settings. Base URL
// overrides are honoured, and an unconfigured provider fails typed, never by throwing.

function inputFor(provider: ProviderName): ProviderCompletionInput {
  return {
    target: {
      id: targetIdUnchecked(`${provider}-target`),
      provider,
      model: "some-model",
      region: "test",
      residency: "local",
      pricing: { inputUsdPerMillion: usdUnchecked(0), outputUsdPerMillion: usdUnchecked(0) },
    },
    messages: [{ role: "user", content: "Hi." }],
    timeoutMs: millisecondsUnchecked(2_000),
  };
}

describe("createProviderRegistry (FR-018)", () => {
  const server = useMswServer();

  it("resolves every configured provider to an adapter that calls its configured base URL", async () => {
    server.use(
      http.post("http://ollama.test/v1/chat/completions", () =>
        HttpResponse.json(loadFixture("ollama-success.json")),
      ),
      http.post("http://mistral.test/v1/chat/completions", () =>
        HttpResponse.json(loadFixture("mistral-success.json")),
      ),
      http.post("http://anthropic.test/v1/messages", () =>
        HttpResponse.json(loadFixture("anthropic-success.json")),
      ),
      http.post("http://openai.test/v1/chat/completions", () =>
        HttpResponse.json(loadFixture("openai-success.json")),
      ),
    );
    const registry = createProviderRegistry({
      ollama: { baseUrl: "http://ollama.test/v1" },
      mistral: { apiKey: SECRET_API_KEY, baseUrl: "http://mistral.test/v1" },
      anthropic: { apiKey: SECRET_API_KEY, baseUrl: "http://anthropic.test/v1" },
      openai: { apiKey: SECRET_API_KEY, baseUrl: "http://openai.test/v1" },
    });

    for (const provider of PROVIDER_NAMES) {
      const result = await registry.resolve(provider).complete(inputFor(provider));
      expect(result.ok, provider).toBe(true);
    }
  });

  it("returns the same adapter for the same provider on every call", () => {
    const registry = createProviderRegistry({ ollama: { baseUrl: "http://ollama.test/v1" } });

    expect(registry.resolve("ollama")).toBe(registry.resolve("ollama"));
  });

  it.each(PROVIDER_NAMES)(
    "resolves unconfigured %s to an adapter that returns authentication, not retryable, without a request",
    async (provider) => {
      const registry = createProviderRegistry({});

      const result = await registry.resolve(provider).complete(inputFor(provider));

      expect(result).toEqual({
        ok: false,
        error: {
          kind: "provider",
          targetId: `${provider}-target`,
          provider,
          cause: "authentication",
          retryable: false,
          message: "provider not configured",
        },
      });
    },
  );
});
