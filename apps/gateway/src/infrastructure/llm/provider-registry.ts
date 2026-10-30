/**
 * Builds the `ProviderRegistry` once from explicit settings (spec 002 FR-018, tasks.md
 * T034). A provider without settings resolves to an adapter that fails typed, so a
 * misrouted call never throws; `T-002-05` adds the boot check that normally prevents it.
 */
import type {
  LlmProviderPort,
  ProviderCompletionInput,
} from "../../application/ports/llm-provider.port.js";
import type { ProviderRegistry } from "../../application/provider-registry.js";
import { providerError } from "../../domain/errors.js";
import type { ProviderName } from "../../domain/model/model-target.js";
import { err } from "../../domain/result.js";
import { createAnthropicAdapter } from "./anthropic.js";
import { createMistralAdapter } from "./mistral.js";
import { createOllamaAdapter } from "./ollama.js";
import { createOpenAiAdapter } from "./openai.js";
import type { ProviderSettings } from "./settings.js";

export function createProviderRegistry(settings: ProviderSettings): ProviderRegistry {
  const adapters: Readonly<Record<ProviderName, LlmProviderPort>> = {
    ollama: settings.ollama ? createOllamaAdapter(settings.ollama) : notConfigured("ollama"),
    mistral: settings.mistral ? createMistralAdapter(settings.mistral) : notConfigured("mistral"),
    anthropic: settings.anthropic
      ? createAnthropicAdapter(settings.anthropic)
      : notConfigured("anthropic"),
    openai: settings.openai ? createOpenAiAdapter(settings.openai) : notConfigured("openai"),
  };
  return { resolve: (provider) => adapters[provider] };
}

function notConfigured(provider: ProviderName): LlmProviderPort {
  const fail = async (input: ProviderCompletionInput) =>
    err(
      providerError({
        targetId: input.target.id,
        provider,
        cause: "authentication",
        retryable: false,
        message: "provider not configured",
      }),
    );
  return { complete: fail, stream: fail };
}
