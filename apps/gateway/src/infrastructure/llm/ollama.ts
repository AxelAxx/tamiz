/**
 * Ollama through its OpenAI-compatible `/v1` endpoint and `@ai-sdk/openai-compatible`,
 * so no community provider package is needed (research R-04).
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LlmProviderPort } from "../../application/ports/llm-provider.port.js";
import { createAiSdkProvider } from "./ai-sdk-provider.js";
import type { OllamaSettings } from "./settings.js";

export function createOllamaAdapter(settings: OllamaSettings): LlmProviderPort {
  const ollama = createOpenAICompatible({ name: "ollama", baseURL: settings.baseUrl });
  return createAiSdkProvider({
    provider: "ollama",
    languageModel: (model) => ollama.chatModel(model),
  });
}
