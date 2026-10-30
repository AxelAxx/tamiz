/** Mistral, the EU-resident provider, through `@ai-sdk/mistral` (research R-04). */
import { createMistral } from "@ai-sdk/mistral";
import type { LlmProviderPort } from "../../application/ports/llm-provider.port.js";
import { createAiSdkProvider } from "./ai-sdk-provider.js";
import { type KeyedProviderSettings, sdkOptions } from "./settings.js";

export function createMistralAdapter(settings: KeyedProviderSettings): LlmProviderPort {
  const mistral = createMistral(sdkOptions(settings));
  return createAiSdkProvider({ provider: "mistral", languageModel: (model) => mistral(model) });
}
