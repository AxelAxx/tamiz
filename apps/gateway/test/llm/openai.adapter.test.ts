import { createOpenAiAdapter } from "../../src/infrastructure/llm/openai.js";
import {
  chatCompletionShape,
  describeAdapterScenarios,
  loadFixture,
  SECRET_API_KEY,
} from "./adapter-scenarios.js";
import { describeStreamScenarios, openAiDialect } from "./stream-scenarios.js";

// tasks.md T027: the OpenAI chat-completions endpoint at its default base URL.

const success = loadFixture("openai-success.json");

describeAdapterScenarios({
  provider: "openai",
  url: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4o-mini",
  createAdapter: () => createOpenAiAdapter({ apiKey: SECRET_API_KEY }),
  success,
  expected: {
    text: "Hello from OpenAI.",
    modelName: "gpt-4o-mini-2024-07-18",
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
  rejected: { status: 401, cause: "authentication" },
});

// Spec 003 tasks.md T042: the same adapter, streaming.
describeStreamScenarios({
  provider: "openai",
  url: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4o-mini",
  createAdapter: () => createOpenAiAdapter({ apiKey: SECRET_API_KEY }),
  dialect: openAiDialect("gpt-4o-mini"),
  stopReason: "stop",
});
