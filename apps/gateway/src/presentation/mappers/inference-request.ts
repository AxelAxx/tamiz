/**
 * Chat completion request DTO → domain `InferenceRequest` (spec 002 FR-002, FR-016,
 * research R-01). The contract already validated the body; the ids come from the
 * request-id middleware and the authenticated key. The client's `user` field is never
 * forwarded (US6-7).
 *
 * Tool calling (009 tool-calling FR-001 … FR-003): a `tool` message gets the name of the
 * call it answers, which the contract guarantees is in an earlier assistant message.
 */
import type {
  ChatCompletionRequest,
  ChatMessage,
  ToolChoice as ToolChoiceDto,
} from "@tamiz/contracts";
import type {
  InferenceRequest,
  Message,
  ToolChoice,
} from "../../domain/model/inference-request.js";
import { clientIdUnchecked, requestIdUnchecked } from "../../domain/model/units.js";

export function toMessages(dtos: ReadonlyArray<ChatMessage>): ReadonlyArray<Message> {
  const callNames = new Map<string, string>();
  return dtos.map((dto): Message => {
    if (dto.role === "system" || dto.role === "user") {
      return { role: dto.role, content: dto.content };
    }
    if (dto.role === "tool") {
      return {
        role: "tool",
        toolCallId: dto.tool_call_id,
        toolName: callNames.get(dto.tool_call_id) ?? "",
        content: dto.content,
      };
    }
    const toolCalls = (dto.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    }));
    for (const call of toolCalls) callNames.set(call.id, call.name);
    return { role: "assistant", content: dto.content ?? null, toolCalls };
  });
}

function toToolChoice(dto: ToolChoiceDto): ToolChoice {
  return typeof dto === "string" ? dto : { name: dto.function.name };
}

export function toInferenceRequest(
  dto: ChatCompletionRequest,
  requestId: string,
  clientId: string,
): InferenceRequest {
  return {
    requestId: requestIdUnchecked(requestId),
    clientId: clientIdUnchecked(clientId),
    requestedModel: dto.model,
    messages: toMessages(dto.messages),
    ...(dto.temperature !== undefined && { temperature: dto.temperature }),
    ...(dto.max_tokens !== undefined && { maxTokens: dto.max_tokens }),
    ...(dto.tools !== undefined && {
      tools: dto.tools.map(({ function: definition }) => ({
        name: definition.name,
        ...(definition.description !== undefined && { description: definition.description }),
        ...(definition.parameters !== undefined && { parameters: definition.parameters }),
        ...(definition.strict !== undefined && { strict: definition.strict }),
      })),
    }),
    ...(dto.tool_choice !== undefined && { toolChoice: toToolChoice(dto.tool_choice) }),
  };
}

/** Domain messages → the contract's message shape (the simulator's `providerMessages`). */
export function toChatMessages(messages: ReadonlyArray<Message>): ChatMessage[] {
  return messages.map((message): ChatMessage => {
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role !== "assistant") return { role: message.role, content: message.content };
    if (message.toolCalls.length === 0) {
      return { role: "assistant", content: message.content ?? "" };
    }
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  });
}
