/**
 * Routed completion → chat completion response DTO (spec 002 FR-024, FR-025, research
 * R-15, FR-035). The body is validated against the contract before it is sent;
 * `usage` always carries `cost_usd` and whether the counts were `estimated`. An answer
 * with tool calls has `content: null` when it has no text (009 tool-calling FR-004).
 */
import { type ChatCompletionResponse, ChatCompletionResponseSchema } from "@tamiz/contracts";
import type { ProviderCompletion } from "../../application/ports/llm-provider.port.js";
import type { RoutedCompletion } from "../../application/use-cases/route-inference.js";

function toResponseMessage({ text, toolCalls = [] }: ProviderCompletion) {
  if (toolCalls.length === 0) return { role: "assistant", content: text };
  return {
    role: "assistant",
    content: text === "" ? null : text,
    tool_calls: toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    })),
  };
}

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
        message: toResponseMessage(routed.completion),
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
