/**
 * OpenAI-compatible chat completion contract, non-streaming subset
 * (spec FR-006 … FR-008, data-model sections 2 and 3).
 *
 * Field names follow the public OpenAI shape on purpose (`max_tokens`, `finish_reason`).
 * Every object is strict: fields outside this subset (tools, response_format, logprobs,
 * multimodal content parts, `stream: true`) are rejected until a later feature adds them.
 */
import { z } from "zod";

export const ChatMessageSchema = z.strictObject({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export const ChatCompletionRequestSchema = z.strictObject({
  model: z.string().min(1),
  messages: z.array(ChatMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  /** Streaming is out of scope until feature 003; only `false` is accepted. */
  stream: z.literal(false).optional(),
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

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
export type ChatCompletionChoice = z.infer<typeof ChatCompletionChoiceSchema>;
export type ChatCompletionUsage = z.infer<typeof ChatCompletionUsageSchema>;
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;
