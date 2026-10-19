/**
 * The domain's view of one chat completion request (spec 002 FR-002, research R-01,
 * data-model section 3.2). The presentation mapper builds it from the contract DTO.
 */
import type { ClientId, RequestId } from "./units.js";

export const MESSAGE_ROLES = ["system", "user", "assistant"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export interface Message {
  readonly role: MessageRole;
  readonly content: string;
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
}
