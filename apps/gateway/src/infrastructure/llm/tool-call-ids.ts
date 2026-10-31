/**
 * Tool-call ids a provider would reject, aliased within one call (009 tool-calling FR-016,
 * research T-R09).
 *
 * The Mistral API accepts only 9 alphanumeric characters as a tool-call id, while a
 * conversation may hold ids written by OpenAI or Anthropic. Before the call, every id the
 * provider would reject is replaced by a deterministic alias; ids in the answer that are
 * aliases are mapped back, so the client always sees its own ids. Nothing is kept between
 * calls.
 */
import { createHash } from "node:crypto";
import type {
  LlmProviderPort,
  ProviderCompletionInput,
  StreamPart,
} from "../../application/ports/llm-provider.port.js";
import type { Message } from "../../domain/model/inference-request.js";

const ALPHANUMERIC = /[^a-zA-Z0-9]/g;

/** Nine alphanumeric characters derived from the id. */
export function nineCharAlias(id: string): string {
  return createHash("sha256").update(id).digest("base64").replace(ALPHANUMERIC, "").slice(0, 9);
}

export const MISTRAL_TOOL_CALL_ID = /^[a-zA-Z0-9]{9}$/;

function aliasMessages(
  messages: ReadonlyArray<Message>,
  accepts: (id: string) => boolean,
): { readonly messages: ReadonlyArray<Message>; readonly original: Map<string, string> } {
  const original = new Map<string, string>();
  const alias = (id: string) => {
    if (accepts(id)) return id;
    const aliased = nineCharAlias(id);
    original.set(aliased, id);
    return aliased;
  };
  const aliased = messages.map((message): Message => {
    if (message.role === "assistant" && message.toolCalls.length > 0) {
      return {
        ...message,
        toolCalls: message.toolCalls.map((call) => ({ ...call, id: alias(call.id) })),
      };
    }
    if (message.role === "tool") return { ...message, toolCallId: alias(message.toolCallId) };
    return message;
  });
  return { messages: aliased, original };
}

async function* mapStartIds(
  parts: AsyncIterable<StreamPart>,
  back: (id: string) => string,
): AsyncGenerator<StreamPart> {
  for await (const part of parts) {
    yield part.type === "tool-call-start" ? { ...part, id: back(part.id) } : part;
  }
}

export function withToolCallIdAliases(
  provider: LlmProviderPort,
  accepts: (id: string) => boolean,
): LlmProviderPort {
  const prepare = (input: ProviderCompletionInput) => {
    const { messages, original } = aliasMessages(input.messages, accepts);
    return { input: { ...input, messages }, back: (id: string) => original.get(id) ?? id };
  };
  return {
    async complete(raw) {
      const { input, back } = prepare(raw);
      const result = await provider.complete(input);
      if (!result.ok || result.value.toolCalls === undefined) return result;
      const toolCalls = result.value.toolCalls.map((call) => ({ ...call, id: back(call.id) }));
      return { ...result, value: { ...result.value, toolCalls } };
    },
    async stream(raw) {
      const { input, back } = prepare(raw);
      const result = await provider.stream(input);
      if (!result.ok) return result;
      return { ...result, value: { ...result.value, rest: mapStartIds(result.value.rest, back) } };
    },
  };
}
