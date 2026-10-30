/** OpenAI through `@ai-sdk/openai`, on the Chat Completions API (research R-04). */
import { createOpenAI } from "@ai-sdk/openai";
import type { LlmProviderPort } from "../../application/ports/llm-provider.port.js";
import { createAiSdkProvider } from "./ai-sdk-provider.js";
import { type KeyedProviderSettings, sdkOptions } from "./settings.js";

export function createOpenAiAdapter(settings: KeyedProviderSettings): LlmProviderPort {
  const openai = createOpenAI(sdkOptions(settings));
  // `.chat()`: the SDK's default OpenAI model uses the Responses API.
  return createAiSdkProvider({ provider: "openai", languageModel: (model) => openai.chat(model) });
}
