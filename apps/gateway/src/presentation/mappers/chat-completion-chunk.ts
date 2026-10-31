/**
 * Routed stream → OpenAI chat completion chunks (spec 003 FR-021, FR-024, FR-026,
 * research R-10, contracts/http.md).
 *
 * Every chunk of a stream shares `id` (`chatcmpl-<requestId>`), `created` and `model`.
 * The first carries the assistant role; the finish is a chunk with `finish_reason`
 * followed by a usage chunk (`choices: []`, with `cost_usd` and `estimated`). A failure
 * after the first token is one error event with the contract's error envelope. Each
 * output is validated against the contract before it is sent.
 *
 * Tool calls (009 tool-calling FR-004) stream as OpenAI does: a call's first piece has its
 * `index`, `id`, `type` and `function.name` with empty arguments; later pieces carry only
 * `index` and `function.arguments`.
 */
import {
  type ChatCompletionChunk,
  ChatCompletionChunkSchema,
  type StreamErrorEvent,
  StreamErrorEventSchema,
} from "@tamiz/contracts";
import type {
  RoutedStream,
  RoutedStreamPart,
} from "../../application/use-cases/stream-inference.js";
import type { ProviderError } from "../../domain/errors.js";
import { domainErrorToEnvelope } from "./error-envelope.js";

export function chunkMapper(routed: RoutedStream, requestId: string) {
  const base = {
    id: `chatcmpl-${requestId}`,
    object: "chat.completion.chunk" as const,
    created: Math.floor(routed.createdAt.getTime() / 1000),
    model: routed.modelName,
  };
  const delta = (content: string, first = false): ChatCompletionChunk =>
    ChatCompletionChunkSchema.parse({
      ...base,
      choices: [
        {
          index: 0,
          delta: first ? { role: "assistant", content } : { content },
          finish_reason: null,
        },
      ],
    });

  return {
    first: (): ChatCompletionChunk => delta(routed.first, true),
    delta: (text: string): ChatCompletionChunk => delta(text),
    toolCall: (
      part: Extract<RoutedStreamPart, { type: "tool-call-start" | "tool-call-delta" }>,
    ): ChatCompletionChunk =>
      ChatCompletionChunkSchema.parse({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                part.type === "tool-call-start"
                  ? {
                      index: part.index,
                      id: part.id,
                      type: "function",
                      function: { name: part.name, arguments: "" },
                    }
                  : { index: part.index, function: { arguments: part.arguments } },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
    /** The finish chunk, then the usage chunk. */
    finish: (part: Extract<RoutedStreamPart, { type: "finish" }>): ChatCompletionChunk[] => [
      ChatCompletionChunkSchema.parse({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: part.finishReason }],
      }),
      ChatCompletionChunkSchema.parse({
        ...base,
        choices: [],
        usage: {
          prompt_tokens: part.usage.promptTokens,
          completion_tokens: part.usage.completionTokens,
          total_tokens: part.usage.promptTokens + part.usage.completionTokens,
          cost_usd: part.cost,
          estimated: part.usage.estimated,
        },
      }),
    ],
    error: (error: ProviderError): StreamErrorEvent =>
      StreamErrorEventSchema.parse({ error: domainErrorToEnvelope(error, requestId).error }),
  };
}
