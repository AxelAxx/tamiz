/**
 * Builders for valid contract objects with per-field overrides (spec FR-025).
 *
 * Each builder merges its defaults with the overrides and parses the result with the
 * contract schema from `@tamiz/contracts`, so an override that breaks the contract throws
 * at the call site instead of leaking an invalid fixture into a test. Defaults are
 * produced fresh on every call: tests may mutate what they receive.
 */
import {
  type ChatCompletionRequest,
  ChatCompletionRequestSchema,
  type ChatCompletionResponse,
  ChatCompletionResponseSchema,
  type HealthResponse,
  HealthResponseSchema,
} from "@tamiz/contracts";

/**
 * Overrides may be the *input* shape of the contract (for example `uptimeMs` as a plain
 * number rather than the branded `Milliseconds`); the schema brands it on the way out.
 */
export type ChatCompletionRequestOverrides = Partial<ChatCompletionRequest>;
export type ChatCompletionResponseOverrides = Partial<ChatCompletionResponse>;
export type HealthResponseOverrides = Partial<{
  [K in keyof HealthResponse]: K extends "uptimeMs" ? number : HealthResponse[K];
}>;

function defaultChatCompletionRequest(): ChatCompletionRequest {
  return {
    model: "llama3.2",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Summarise this contract in three bullet points." },
    ],
    temperature: 0.2,
    max_tokens: 256,
  };
}

function defaultChatCompletionResponse(): ChatCompletionResponse {
  return {
    id: "chatcmpl-test-0001",
    object: "chat.completion",
    created: 1_767_225_600, // 2026-01-01T00:00:00Z, the fake clock's default start
    model: "llama3.2",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Here are three bullet points." },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 42, completion_tokens: 12, total_tokens: 54 },
  };
}

function defaultHealthResponse(): HealthResponseOverrides & { status: "ok" } {
  return {
    status: "ok",
    version: "0.1.0",
    uptimeMs: 1234,
  };
}

export function chatCompletionRequest(
  overrides: ChatCompletionRequestOverrides = {},
): ChatCompletionRequest {
  return ChatCompletionRequestSchema.parse({ ...defaultChatCompletionRequest(), ...overrides });
}

export function chatCompletionResponse(
  overrides: ChatCompletionResponseOverrides = {},
): ChatCompletionResponse {
  return ChatCompletionResponseSchema.parse({ ...defaultChatCompletionResponse(), ...overrides });
}

export function healthResponse(overrides: HealthResponseOverrides = {}): HealthResponse {
  return HealthResponseSchema.parse({ ...defaultHealthResponse(), ...overrides });
}
