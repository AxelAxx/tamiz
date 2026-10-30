/**
 * Routed completion → chat completion response DTO (spec 002 FR-024, FR-025, research
 * R-15). The body is validated against the contract before it is sent. Usage the
 * provider omitted is reported as zeros until `T-002-07` estimates it.
 */
import { type ChatCompletionResponse, ChatCompletionResponseSchema } from "@tamiz/contracts";
import type { RoutedCompletion } from "../../application/use-cases/route-inference.js";

export function toChatCompletionResponse(
  routed: RoutedCompletion,
  requestId: string,
): ChatCompletionResponse {
  const promptTokens = routed.usage?.promptTokens ?? 0;
  const completionTokens = routed.usage?.completionTokens ?? 0;
  return ChatCompletionResponseSchema.parse({
    id: `chatcmpl-${requestId}`,
    object: "chat.completion",
    created: Math.floor(routed.createdAt.getTime() / 1000),
    model: routed.completion.modelName,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: routed.completion.text },
        finish_reason: routed.completion.finishReason,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  });
}
