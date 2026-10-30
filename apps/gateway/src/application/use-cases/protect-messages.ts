/**
 * What the provider receives, and how its answer comes back (spec 005 FR-012, FR-013,
 * research R-06, R-10).
 *
 * For `anonymize`, every detected value is replaced by its placeholder in every message,
 * the versioned notice is prepended as a system message, and `restore` puts the values
 * back into the provider's text. The mapping lives only in the `restore` closure, so it
 * can never end up on an object that is logged. Any other action sends the messages as
 * they are and `restore` is the identity.
 */
import type { Message } from "../../domain/model/inference-request.js";
import { anonymizeMessages, restore } from "../../domain/model/placeholders.js";
import { createStreamRestorer, type StreamRestorer } from "../../domain/model/restore-stream.js";
import type { RoutingDecision } from "../../domain/model/routing-decision.js";
import type { Inspection } from "../../domain/model/sensitivity.js";

/** The versioned instruction to keep placeholders verbatim (`prompts/…v1.md`). */
export interface AnonymizationNotice {
  readonly version: string;
  readonly text: string;
}

export interface ProtectedMessages {
  readonly providerMessages: ReadonlyArray<Message>;
  readonly restore: (text: string) => string;
  /** A fresh placeholder-safe restorer for one streamed answer (spec 005 FR-016). */
  readonly streamRestorer: () => StreamRestorer;
  /** How many distinct values were replaced; `0` when not anonymized. */
  readonly placeholders: number;
  /** Set when the notice was added. */
  readonly noticeVersion?: string;
}

const identity = (text: string): string => text;
const passThrough = (): StreamRestorer => ({ push: identity, flush: () => "" });

export function protectMessages(
  decision: RoutingDecision,
  inspection: Inspection,
  messages: ReadonlyArray<Message>,
  notice: AnonymizationNotice,
): ProtectedMessages {
  if (decision.privacyAction !== "anonymize" || inspection.status !== "ok") {
    return {
      providerMessages: messages,
      restore: identity,
      streamRestorer: passThrough,
      placeholders: 0,
    };
  }
  const anonymized = anonymizeMessages(
    messages.map((message) => message.content),
    inspection.entities,
  );
  const mapping = anonymized.mapping;
  return {
    providerMessages: [
      { role: "system", content: notice.text },
      ...messages.map((message, index) => ({
        ...message,
        content: anonymized.messages[index] ?? message.content,
      })),
    ],
    restore: (text) => restore(text, mapping),
    streamRestorer: () => createStreamRestorer(mapping),
    placeholders: mapping.length,
    noticeVersion: notice.version,
  };
}
