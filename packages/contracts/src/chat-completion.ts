/**
 * OpenAI-compatible chat completion contract (spec FR-006 … FR-008, data-model sections
 * 2 and 3). Spec 003 adds streaming: `stream: true`, `stream_options`, the chunk and the
 * mid-stream error event (FR-021, FR-024, FR-026, research R-10).
 *
 * Field names follow the public OpenAI shape on purpose (`max_tokens`, `finish_reason`).
 * Every object is strict: fields outside this subset (tools, response_format, logprobs,
 * multimodal content parts) are rejected until a later feature adds them.
 */
import { z } from "zod";
import { UsdSchema } from "./branded.js";
import { ErrorEnvelopeSchema } from "./error.js";

export const ChatMessageSchema = z.strictObject({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export const ChatCompletionRequestSchema = z.strictObject({
  model: z.string().min(1),
  messages: z.array(ChatMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  /** `true` answers with server-sent chat completion chunks (spec 003 FR-021). */
  stream: z.boolean().optional(),
  /** Accepted for compatibility; Tamiz always sends the usage chunk (spec 003 R-10). */
  stream_options: z.strictObject({ include_usage: z.boolean().optional() }).optional(),
  user: z.string().max(256).optional(),
});

export const ChatCompletionChoiceSchema = z.strictObject({
  index: z.number().int().min(0),
  message: ChatMessageSchema,
  finish_reason: z.enum(["stop", "length", "content_filter"]),
});

export const ChatCompletionUsageSchema = z.strictObject({
  prompt_tokens: z.number().int().min(0),
  completion_tokens: z.number().int().min(0),
  total_tokens: z.number().int().min(0),
  /** Spec 002 FR-035: the request's cost in US dollars; the gateway always sets it. */
  cost_usd: UsdSchema.optional(),
  /** Spec 002 FR-034: true when the token counts were estimated, not reported. */
  estimated: z.boolean().optional(),
});

export const ChatCompletionResponseSchema = z.strictObject({
  id: z.string().min(1),
  object: z.literal("chat.completion"),
  /** Unix time in seconds. */
  created: z.number().int().min(0),
  model: z.string().min(1),
  choices: z.array(ChatCompletionChoiceSchema).min(1),
  usage: ChatCompletionUsageSchema,
});

export const FINISH_REASON_VALUES = ["stop", "length", "content_filter"] as const;

/** One streamed chunk (OpenAI `chat.completion.chunk`); `choices` is empty on the usage chunk. */
export const ChatCompletionChunkSchema = z.strictObject({
  id: z.string().min(1),
  object: z.literal("chat.completion.chunk"),
  /** Unix time in seconds; the same in every chunk of a stream. */
  created: z.number().int().min(0),
  model: z.string().min(1),
  choices: z.array(
    z.strictObject({
      index: z.number().int().min(0),
      delta: z.strictObject({
        role: z.literal("assistant").optional(),
        content: z.string().optional(),
      }),
      finish_reason: z.enum(FINISH_REASON_VALUES).nullable(),
    }),
  ),
  usage: ChatCompletionUsageSchema.optional(),
});

/** Sent once, instead of `[DONE]`, when a stream fails after its first token (FR-024). */
export const StreamErrorEventSchema = z.strictObject({ error: ErrorEnvelopeSchema.shape.error });

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
export type ChatCompletionChoice = z.infer<typeof ChatCompletionChoiceSchema>;
export type ChatCompletionUsage = z.infer<typeof ChatCompletionUsageSchema>;
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;
export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>;
export type StreamErrorEvent = z.infer<typeof StreamErrorEventSchema>;
