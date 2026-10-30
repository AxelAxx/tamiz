/**
 * Resolves a provider name to its adapter (spec 002 FR-018, data-model section 4.1).
 *
 * Type only: `T-002-04` implements it, and `main.ts` builds it once from validated
 * configuration.
 */
import type { ProviderName } from "../domain/model/model-target.js";
import type { LlmProviderPort } from "./ports/llm-provider.port.js";

export interface ProviderRegistry {
  resolve(provider: ProviderName): LlmProviderPort;
}
