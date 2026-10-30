import { createAnthropicAdapter } from "../../src/infrastructure/llm/anthropic.js";
import {
  describeAdapterScenarios,
  type JsonBody,
  loadFixture,
  SECRET_API_KEY,
} from "./adapter-scenarios.js";
import { anthropicDialect, describeStreamScenarios } from "./stream-scenarios.js";

// tasks.md T029: Anthropic's messages endpoint at its default base URL. The API has no
// choices and always reports usage, so those two edge cases do not apply.

const success = loadFixture("anthropic-success.json");

describeAdapterScenarios({
  provider: "anthropic",
  url: "https://api.anthropic.com/v1/messages",
  model: "claude-haiku-4-5",
  createAdapter: () => createAnthropicAdapter({ apiKey: SECRET_API_KEY }),
  success,
  expected: {
    text: "Hello from Anthropic.",
    modelName: "claude-haiku-4-5-20251001",
    promptTokens: 12,
    completionTokens: 4,
  },
  withFinishReason: (raw: string): JsonBody => ({ ...success, stop_reason: raw }),
  finishReasons: [
    ["end_turn", "stop"],
    ["stop_sequence", "stop"],
    ["max_tokens", "length"],
    ["refusal", "content_filter"],
    ["tool_use", "stop"],
  ],
  maxTokensField: "max_tokens",
  rejected: { status: 401, cause: "authentication" },
});

// Spec 003 tasks.md T042: the same adapter, streaming.
describeStreamScenarios({
  provider: "anthropic",
  url: "https://api.anthropic.com/v1/messages",
  model: "claude-haiku-4-5",
  createAdapter: () => createAnthropicAdapter({ apiKey: SECRET_API_KEY }),
  dialect: anthropicDialect("claude-haiku-4-5"),
  stopReason: "end_turn",
  usageAlways: true,
});
