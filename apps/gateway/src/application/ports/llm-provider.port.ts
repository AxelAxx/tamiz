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

export interface LlmProviderPort {
  complete(input: ProviderCompletionInput): Promise<Result<ProviderCompletion, ProviderError>>;
}
