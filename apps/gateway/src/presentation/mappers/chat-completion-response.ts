/**
 * Routed completion → chat completion response DTO (spec 002 FR-024, FR-025, research
 * R-15, FR-035). The body is validated against the contract before it is sent;
 * `usage` always carries `cost_usd` and whether the counts were `estimated`.
 */
import { type ChatCompletionResponse, ChatCompletionResponseSchema } from "@tamiz/contracts";
import type { RoutedCompletion } from "../../application/use-cases/route-inference.js";

export function toChatCompletionResponse(
  routed: RoutedCompletion,
  requestId: string,
): ChatCompletionResponse {
  const { promptTokens, completionTokens, estimated } = routed.usage;
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
      cost_usd: routed.cost,
      estimated,
    },
  });
}
