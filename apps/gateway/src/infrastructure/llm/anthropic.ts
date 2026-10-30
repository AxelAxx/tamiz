/** Anthropic through `@ai-sdk/anthropic`, on the Messages API (research R-04). */
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LlmProviderPort } from "../../application/ports/llm-provider.port.js";
import { createAiSdkProvider } from "./ai-sdk-provider.js";
import { type KeyedProviderSettings, sdkOptions } from "./settings.js";

export function createAnthropicAdapter(settings: KeyedProviderSettings): LlmProviderPort {
  const anthropic = createAnthropic(sdkOptions(settings));
  return createAiSdkProvider({ provider: "anthropic", languageModel: (model) => anthropic(model) });
}
