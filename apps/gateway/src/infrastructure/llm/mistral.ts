/**
 * Mistral, the EU-resident provider, through `@ai-sdk/mistral` (research R-04). Its API
 * takes only 9-character alphanumeric tool-call ids, so other ids are aliased per call
 * (009 tool-calling FR-016, research T-R09).
 */
import { createMistral } from "@ai-sdk/mistral";
import type { LlmProviderPort } from "../../application/ports/llm-provider.port.js";
import { createAiSdkProvider } from "./ai-sdk-provider.js";
import { type KeyedProviderSettings, sdkOptions } from "./settings.js";
import { MISTRAL_TOOL_CALL_ID, withToolCallIdAliases } from "./tool-call-ids.js";

export function createMistralAdapter(settings: KeyedProviderSettings): LlmProviderPort {
  const mistral = createMistral(sdkOptions(settings));
  return withToolCallIdAliases(
    createAiSdkProvider({ provider: "mistral", languageModel: (model) => mistral(model) }),
    (id) => MISTRAL_TOOL_CALL_ID.test(id),
  );
}
