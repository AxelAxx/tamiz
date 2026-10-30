/**
 * How the application calls a model (spec 002 FR-009, data-model section 4.1).
 *
 * One adapter per provider implements this port in `infrastructure/llm/` (`T-002-04`).
 * An adapter never throws for an upstream failure: it returns a typed `ProviderError`,
 * and it bounds the call by `timeoutMs`, never by a library default (US6-6).
 */
import type { ProviderError } from "../../domain/errors.js";
import type { Message } from "../../domain/model/inference-request.js";
import type { ModelTarget } from "../../domain/model/model-target.js";
import type { Milliseconds } from "../../domain/model/units.js";
import type { Result } from "../../domain/result.js";

/** Mirrored by the contract's `finish_reason` enum; the drift test of T054 imports it. */
export const FINISH_REASONS = ["stop", "length", "content_filter"] as const;
export type FinishReason = (typeof FINISH_REASONS)[number];

export interface ProviderCompletionInput {
  readonly target: ModelTarget;
  readonly messages: ReadonlyArray<Message>;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeoutMs: Milliseconds;
  /** Ends the call early: request deadline or client disconnect (spec 003 research R-03). */
  readonly signal?: AbortSignal;
}

/** Token counts as the provider reported them. */
export interface ProviderUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/** A normalised completion: the first choice only. */
export interface ProviderCompletion {
  readonly text: string;
  readonly finishReason: FinishReason;
  /** Absent when the provider omits usage; `T-002-07` estimates it then. */
  readonly usage?: ProviderUsage;
  /** The model name the provider says served the call. */
  readonly modelName: string;
}

/** What follows the first token of a stream (spec 003 research R-09). */
export type StreamPart =
  | { readonly type: "delta"; readonly text: string }
  /** The provider finished; usage is absent when it reported none. */
  | { readonly type: "finish"; readonly finishReason: FinishReason; readonly usage?: ProviderUsage }
  /** The stream failed after its first token; nothing follows. */
  | { readonly type: "error"; readonly error: ProviderError };

/**
 * A stream that has produced its first token. A failure before that point is a plain
 * `ProviderError` from `stream()`, so fallback rules apply only before the first token
 * (spec 003 FR-023, FR-024).
 */
export interface StartedStream {
  readonly first: string;
  /** The target's model name: the same in every chunk of the stream. */
  readonly modelName: string;
  /** Deltas, then exactly one `finish` or one `error`. */
  readonly rest: AsyncIterable<StreamPart>;
}

export interface LlmProviderPort {
  complete(input: ProviderCompletionInput): Promise<Result<ProviderCompletion, ProviderError>>;
  /**
   * Resolves at the first token or with the failure before it. `timeoutMs` bounds the
   * wait for the first token and every gap between later parts (spec 003 FR-025).
   */
  stream(input: ProviderCompletionInput): Promise<Result<StartedStream, ProviderError>>;
}
