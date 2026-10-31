/**
 * What the provider receives, and how its answer comes back (spec 005 FR-012, FR-013,
 * research R-06, R-10; 009 tool-calling FR-009 … FR-014, data-model section 3).
 *
 * For `anonymize`, every detected value is replaced by its placeholder in every inspected
 * text the provider gets back from us: message contents, tool-call arguments (JSON-safely)
 * and tool results; tool definitions are never rewritten (a value there keeps the request
 * local instead, see `notAnonymizableReason`). The versioned notice is prepended as a system
 * message: `v2` when the request uses tools, `v1` otherwise. `restore` puts the values back
 * into the answer's text and `restoreArguments` into its tool-call arguments, JSON-escaped.
 * The mapping lives only in these closures, so it can never end up on an object that is
 * logged. Any other action sends the messages as they are and restoring is the identity.
 */

import type { InferenceRequest } from "../../domain/model/inference-request.js";
import { type Message, usesTools } from "../../domain/model/inference-request.js";
import { type InspectedText, inspectedTexts } from "../../domain/model/inspected-text.js";
import { anonymizeTexts, escapeJson, restore } from "../../domain/model/placeholders.js";
import { createStreamRestorer, type StreamRestorer } from "../../domain/model/restore-stream.js";
import type { RoutingDecision } from "../../domain/model/routing-decision.js";
import type { Inspection } from "../../domain/model/sensitivity.js";

/** The versioned instruction to keep placeholders verbatim (`prompts/…vN.md`). */
export interface AnonymizationNotice {
  readonly version: string;
  readonly text: string;
}

export interface AnonymizationNotices {
  /** For requests without tools (spec 005, `v1`). */
  readonly plain: AnonymizationNotice;
  /** For requests with tools or tool messages (009 tool-calling FR-014, `v2`). */
  readonly tools: AnonymizationNotice;
}

export interface ProtectedRequest {
  readonly providerMessages: ReadonlyArray<Message>;
  readonly restore: (text: string) => string;
  /** Restores a tool call's arguments (JSON text) with escaped values (FR-012). */
  readonly restoreArguments: (json: string) => string;
  /** A fresh placeholder-safe restorer for one streamed answer (spec 005 FR-016). */
  readonly streamRestorer: () => StreamRestorer;
  /** A fresh restorer for one streamed tool call's arguments (FR-013). */
  readonly argumentsRestorer: () => StreamRestorer;
  /** How many distinct values were replaced; `0` when not anonymized. */
  readonly placeholders: number;
  /** Set when the notice was added. */
  readonly noticeVersion?: string;
}

const identity = (text: string): string => text;
const passThrough = (): StreamRestorer => ({ push: identity, flush: () => "" });

/** The messages with each inspected text replaced by its anonymized version. */
function rebuild(
  messages: ReadonlyArray<Message>,
  located: ReadonlyArray<InspectedText>,
  texts: ReadonlyArray<string>,
): ReadonlyArray<Message> {
  const content = new Map<number, string>();
  const args = new Map<string, string>();
  located.forEach(({ location }, index) => {
    const text = texts[index];
    if (text === undefined) return;
    if (location.kind === "content") content.set(location.messageIndex, text);
    if (location.kind === "arguments") {
      args.set(`${location.messageIndex}:${location.toolCallIndex}`, text);
    }
  });
  return messages.map((message, messageIndex): Message => {
    if (message.role !== "assistant") {
      return { ...message, content: content.get(messageIndex) ?? message.content };
    }
    return {
      ...message,
      content: message.content === null ? null : (content.get(messageIndex) ?? message.content),
      toolCalls: message.toolCalls.map((call, toolCallIndex) => ({
        ...call,
        arguments: args.get(`${messageIndex}:${toolCallIndex}`) ?? call.arguments,
      })),
    };
  });
}

export function protectRequest(
  decision: RoutingDecision,
  inspection: Inspection,
  request: Pick<InferenceRequest, "messages" | "tools">,
  notices: AnonymizationNotices,
): ProtectedRequest {
  if (decision.privacyAction !== "anonymize" || inspection.status !== "ok") {
    return {
      providerMessages: request.messages,
      restore: identity,
      restoreArguments: identity,
      streamRestorer: passThrough,
      argumentsRestorer: passThrough,
      placeholders: 0,
    };
  }
  const located = inspectedTexts(request);
  const jsonTexts = new Set(
    located.flatMap(({ location }, index) => (location.kind === "arguments" ? [index] : [])),
  );
  const anonymized = anonymizeTexts(
    located.map(({ text }) => text),
    inspection.entities,
    jsonTexts,
  );
  const mapping = anonymized.mapping;
  const notice = usesTools(request) ? notices.tools : notices.plain;
  return {
    providerMessages: [
      { role: "system", content: notice.text },
      ...rebuild(request.messages, located, anonymized.texts),
    ],
    restore: (text) => restore(text, mapping),
    restoreArguments: (json) => restore(json, mapping, escapeJson),
    streamRestorer: () => createStreamRestorer(mapping),
    argumentsRestorer: () => createStreamRestorer(mapping, escapeJson),
    placeholders: mapping.length,
    noticeVersion: notice.version,
  };
}
