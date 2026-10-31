import { createOllamaAdapter } from "../../src/infrastructure/llm/ollama.js";
import { chatCompletionShape, describeAdapterScenarios, loadFixture } from "./adapter-scenarios.js";
import { describeStreamScenarios, openAiDialect } from "./stream-scenarios.js";

// tasks.md T030: Ollama's OpenAI-compatible endpoint, no credential. The 401 case
// becomes 404 (an unknown model), a plain non-retryable `http_error`.

const success = loadFixture("ollama-success.json");

describeAdapterScenarios({
  provider: "ollama",
  url: "http://localhost:11434/v1/chat/completions",
  model: "qwen2.5:7b",
  createAdapter: () => createOllamaAdapter({ baseUrl: "http://localhost:11434/v1" }),
  success,
  expected: {
    text: "Hello from Ollama.",
    modelName: "qwen2.5:7b",
    promptTokens: 12,
    completionTokens: 4,
  },
  ...chatCompletionShape(success),
  finishReasons: [
    ["stop", "stop"],
    ["length", "length"],
    ["content_filter", "content_filter"],
    ["tool_calls", "tool_calls"],
  ],
  maxTokensField: "max_tokens",
  rejected: { status: 404, cause: "http_error" },
});

// Spec 003 tasks.md T042: the same adapter, streaming.
describeStreamScenarios({
  provider: "ollama",
  url: "http://localhost:11434/v1/chat/completions",
  model: "qwen2.5:7b",
  createAdapter: () => createOllamaAdapter({ baseUrl: "http://localhost:11434/v1" }),
  dialect: openAiDialect("qwen2.5:7b"),
  stopReason: "stop",
});
