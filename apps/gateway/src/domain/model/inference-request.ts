/**
 * The domain's view of one chat completion request (spec 002 FR-002, research R-01,
 * data-model section 3.2). The presentation mapper builds it from the contract DTO.
 *
 * The 009 tool-calling addendum (data-model 1.1) adds function tools: assistant messages
 * may carry tool calls, `tool` messages carry results, and the request may declare tools
 * and a tool choice. The edge validates the invariants: every `tool` message answers an
 * earlier call, an assistant message has content or calls, a tool choice needs tools.
 */
import type { ClientId, RequestId } from "./units.js";

export const MESSAGE_ROLES = ["system", "user", "assistant", "tool"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export interface ToolDefinition {
  readonly name: string;
  readonly description?: string;
  /** A JSON Schema object, passed to the provider as it is. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly strict?: boolean;
}

export type ToolChoice = "auto" | "none" | "required" | { readonly name: string };

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  /** JSON text: what is inspected, anonymized and restored; parsed only by the adapter. */
  readonly arguments: string;
}

export type Message =
  | { readonly role: "system" | "user"; readonly content: string }
  | {
      readonly role: "assistant";
      /** Null when the assistant only called tools. */
      readonly content: string | null;
      /** Empty when it called none. */
      readonly toolCalls: ReadonlyArray<ToolCall>;
    }
  | {
      readonly role: "tool";
      readonly toolCallId: string;
      /** The name of the call it answers (filled by the mapper from that call). */
      readonly toolName: string;
      readonly content: string;
    };

/** A plain text message, as every request had before tool calling. */
export function textMessage(role: "system" | "user" | "assistant", content: string): Message {
  return role === "assistant" ? { role, content, toolCalls: [] } : { role, content };
}

/** The text of a message, `""` for an assistant message without text. */
export function contentOf(message: Message): string {
  return message.content ?? "";
}

export interface InferenceRequest {
  readonly requestId: RequestId;
  readonly clientId: ClientId;
  /** The client's `model` field, verbatim: a hint that rules may match, never a command. */
  readonly requestedModel: string;
  /** At least one message (validated at the edge). */
  readonly messages: ReadonlyArray<Message>;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: ReadonlyArray<ToolDefinition>;
  readonly toolChoice?: ToolChoice;
}

/** True when the request declares tools or carries tool calls or results. */
export function usesTools(request: Pick<InferenceRequest, "messages" | "tools">): boolean {
  if (request.tools !== undefined && request.tools.length > 0) return true;
  return request.messages.some(
    (message) =>
      message.role === "tool" || (message.role === "assistant" && message.toolCalls.length > 0),
  );
}
