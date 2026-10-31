/**
 * OpenAI-compatible chat completion contract (spec FR-006 … FR-008, data-model sections
 * 2 and 3). Spec 003 adds streaming: `stream: true`, `stream_options`, the chunk and the
 * mid-stream error event (FR-021, FR-024, FR-026, research R-10).
 *
 * Field names follow the public OpenAI shape on purpose (`max_tokens`, `finish_reason`).
 * Every object is strict: fields outside this subset (response_format, logprobs,
 * parallel_tool_calls, multimodal content parts) are rejected until a later feature adds
 * them.
 *
 * The 009 tool-calling addendum (FR-001 … FR-005) adds function tools: `tools`,
 * `tool_choice`, assistant `tool_calls`, `tool` messages, `finish_reason: "tool_calls"`
 * and streamed tool-call pieces. Cross-field rules are checked on the request; an issue
 * names the field path, never its value.
 */
import { z } from "zod";
import { UsdSchema } from "./branded.js";
import { ErrorEnvelopeSchema } from "./error.js";

/** A function name as OpenAI accepts it; also what the audit may record (US6-4). */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
export const MAX_TOOLS = 128;

export const ToolNameSchema = z.string().regex(TOOL_NAME_PATTERN);

export const ToolDefinitionSchema = z.strictObject({
  type: z.literal("function"),
  function: z.strictObject({
    name: ToolNameSchema,
    description: z.string().max(1024).optional(),
    /** A JSON Schema object, passed to the provider as it is. */
    parameters: z.record(z.string(), z.unknown()).optional(),
    strict: z.boolean().optional(),
  }),
});

export const ToolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z.strictObject({
    type: z.literal("function"),
    function: z.strictObject({ name: ToolNameSchema }),
  }),
]);

/** In a request, `arguments` must also parse to a JSON object (checked on the request). */
export const ToolCallSchema = z.strictObject({
  id: z.string().min(1).max(128),
  type: z.literal("function"),
  function: z.strictObject({ name: ToolNameSchema, arguments: z.string() }),
});

export const SystemMessageSchema = z.strictObject({
  role: z.literal("system"),
  content: z.string(),
});

export const UserMessageSchema = z.strictObject({
  role: z.literal("user"),
  content: z.string(),
});

export const AssistantMessageSchema = z
  .strictObject({
    role: z.literal("assistant"),
    content: z.string().nullable().optional(),
    tool_calls: z.array(ToolCallSchema).min(1).max(MAX_TOOLS).optional(),
  })
  .refine((message) => typeof message.content === "string" || message.tool_calls !== undefined, {
    message: "an assistant message needs content or tool_calls",
    path: ["content"],
  });

export const ToolMessageSchema = z.strictObject({
  role: z.literal("tool"),
  tool_call_id: z.string().min(1).max(128),
  content: z.string(),
});

export const ChatMessageSchema = z.discriminatedUnion("role", [
  SystemMessageSchema,
  UserMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
]);

/** True when `text` is JSON whose top level is an object. */
export function isJsonObjectText(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

export const ChatCompletionRequestSchema = z
  .strictObject({
    model: z.string().min(1),
    messages: z.array(ChatMessageSchema).min(1),
    tools: z.array(ToolDefinitionSchema).min(1).max(MAX_TOOLS).optional(),
    tool_choice: ToolChoiceSchema.optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
    /** `true` answers with server-sent chat completion chunks (spec 003 FR-021). */
    stream: z.boolean().optional(),
    /** Accepted for compatibility; Tamiz always sends the usage chunk (spec 003 R-10). */
    stream_options: z.strictObject({ include_usage: z.boolean().optional() }).optional(),
    user: z.string().max(256).optional(),
  })
  .superRefine((request, ctx) => {
    const declared = new Set<string>();
    request.tools?.forEach((tool, index) => {
      if (declared.has(tool.function.name)) {
        ctx.addIssue({
          code: "custom",
          message: "tool names must be unique",
          path: ["tools", index, "function", "name"],
        });
      }
      declared.add(tool.function.name);
    });
    const choice = request.tool_choice;
    if (choice !== undefined && request.tools === undefined) {
      ctx.addIssue({ code: "custom", message: "tool_choice needs tools", path: ["tool_choice"] });
    } else if (typeof choice === "object" && !declared.has(choice.function.name)) {
      ctx.addIssue({
        code: "custom",
        message: "tool_choice names a function that is not in tools",
        path: ["tool_choice", "function", "name"],
      });
    }
    const calls = new Set<string>();
    request.messages.forEach((message, index) => {
      if (message.role === "assistant") {
        message.tool_calls?.forEach((call, callIndex) => {
          calls.add(call.id);
          if (!isJsonObjectText(call.function.arguments)) {
            ctx.addIssue({
              code: "custom",
              message: "tool call arguments must be a JSON object",
              path: ["messages", index, "tool_calls", callIndex, "function", "arguments"],
            });
          }
        });
      }
      if (message.role === "tool" && !calls.has(message.tool_call_id)) {
        ctx.addIssue({
          code: "custom",
          message: "tool_call_id matches no tool call of an earlier assistant message",
          path: ["messages", index, "tool_call_id"],
        });
      }
    });
  });

export const FINISH_REASON_VALUES = ["stop", "length", "content_filter", "tool_calls"] as const;

/** The answer: text, tool calls or both; `content` is null when there is no text. */
export const ResponseMessageSchema = z.strictObject({
  role: z.literal("assistant"),
  content: z.string().nullable(),
  tool_calls: z.array(ToolCallSchema).min(1).optional(),
});

export const ChatCompletionChoiceSchema = z.strictObject({
  index: z.number().int().min(0),
  message: ResponseMessageSchema,
  finish_reason: z.enum(FINISH_REASON_VALUES),
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

/** One streamed piece of a tool call; `id`, `type` and `function.name` only in its first. */
export const ToolCallDeltaSchema = z.strictObject({
  index: z.number().int().min(0),
  id: z.string().min(1).optional(),
  type: z.literal("function").optional(),
  function: z
    .strictObject({ name: ToolNameSchema.optional(), arguments: z.string().optional() })
    .optional(),
});

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
        tool_calls: z.array(ToolCallDeltaSchema).min(1).optional(),
      }),
      finish_reason: z.enum(FINISH_REASON_VALUES).nullable(),
    }),
  ),
  usage: ChatCompletionUsageSchema.optional(),
});

/** Sent once, instead of `[DONE]`, when a stream fails after its first token (FR-024). */
export const StreamErrorEventSchema = z.strictObject({ error: ErrorEnvelopeSchema.shape.error });

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type ToolChoice = z.infer<typeof ToolChoiceSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolCallDelta = z.infer<typeof ToolCallDeltaSchema>;
export type ResponseMessage = z.infer<typeof ResponseMessageSchema>;
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
export type ChatCompletionChoice = z.infer<typeof ChatCompletionChoiceSchema>;
export type ChatCompletionUsage = z.infer<typeof ChatCompletionUsageSchema>;
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;
export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>;
export type StreamErrorEvent = z.infer<typeof StreamErrorEventSchema>;
