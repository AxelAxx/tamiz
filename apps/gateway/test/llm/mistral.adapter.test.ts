import { createMistralAdapter } from "../../src/infrastructure/llm/mistral.js";
import {
  chatCompletionShape,
  describeAdapterScenarios,
  loadFixture,
  SECRET_API_KEY,
} from "./adapter-scenarios.js";

// tasks.md T028: Mistral's chat-completions endpoint at its default base URL. Mistral
// has no content-filter finish reason; `model_length` is its second "length". Its
// non-streaming response schema requires `usage` (a body without it is malformed), so
// the "usage absent" edge case does not apply.

const success = loadFixture("mistral-success.json");
const { withoutUsage: _notApplicable, ...shape } = chatCompletionShape(success);

describeAdapterScenarios({
  provider: "mistral",
  url: "https://api.mistral.ai/v1/chat/completions",
  model: "mistral-small-latest",
  createAdapter: () => createMistralAdapter({ apiKey: SECRET_API_KEY }),
  success,
  expected: {
    text: "Hola desde Mistral.",
    modelName: "mistral-small-2409",
    promptTokens: 12,
    completionTokens: 4,
  },
  ...shape,
  finishReasons: [
    ["stop", "stop"],
    ["length", "length"],
    ["model_length", "length"],
    ["tool_calls", "stop"],
  ],
  maxTokensField: "max_tokens",
  rejected: { status: 401, cause: "authentication" },
});
