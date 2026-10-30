/**
 * The one `LlmProviderPort` implementation over Vercel AI SDK 6 (spec 002 FR-014 …
 * FR-017, research R-04 … R-06). Each provider adapter only supplies its model factory.
 *
 * This is the only module that knows AI SDK error classes. A call is bounded by the
 * input's `timeoutMs` through an abort signal, and `maxRetries: 0` leaves retrying to
 * feature 003. Errors carry fixed messages: never the credential, the request messages,
 * the upstream URL or the upstream body.
 */
import {
  type FinishReason as AiFinishReason,
  APICallError,
  generateText,
  InvalidResponseDataError,
  JSONParseError,
  type LanguageModel,
  type ModelMessage,
  NoContentGeneratedError,
  TypeValidationError,
} from "ai";
import type {
  FinishReason,
  LlmProviderPort,
  ProviderCompletion,
  ProviderCompletionInput,
} from "../../application/ports/llm-provider.port.js";
import { type ProviderError, type ProviderErrorCause, providerError } from "../../domain/errors.js";
import type { Message } from "../../domain/model/inference-request.js";
import type { ModelTarget, ProviderName } from "../../domain/model/model-target.js";
import { err, ok, type Result } from "../../domain/result.js";

export interface AiSdkProviderOptions {
  readonly provider: ProviderName;
  /** Builds the AI SDK model for a target's provider model name. */
  readonly languageModel: (modelName: string) => LanguageModel;
}

export function createAiSdkProvider(options: AiSdkProviderOptions): LlmProviderPort {
  return {
    async complete(input) {
      const signal = AbortSignal.timeout(input.timeoutMs);
      try {
        const result = await generateText({
          model: options.languageModel(input.target.model),
          messages: input.messages.map(toModelMessage),
          ...(input.temperature !== undefined && { temperature: input.temperature }),
          ...(input.maxTokens !== undefined && { maxOutputTokens: input.maxTokens }),
          abortSignal: signal,
          maxRetries: 0,
        });
        return toCompletion(result, input, options.provider);
      } catch (error) {
        // The signal is ours, so its state says whether the deadline fired, however the
        // SDK or fetch wrapped the abort.
        const failure = signal.aborted ? describeTimeout() : describeError(error);
        return err(toProviderError(input.target, options.provider, failure));
      }
    },
  };
}

function toModelMessage(message: Message): ModelMessage {
  switch (message.role) {
    case "system":
      return { role: "system", content: message.content };
    case "user":
      return { role: "user", content: message.content };
    case "assistant":
      return { role: "assistant", content: message.content };
  }
}

interface GenerateTextOutcome {
  readonly text: string;
  readonly finishReason: AiFinishReason;
  readonly usage: {
    readonly inputTokens: number | undefined;
    readonly outputTokens: number | undefined;
  };
  readonly response: { readonly modelId: string };
}

function toCompletion(
  result: GenerateTextOutcome,
  input: ProviderCompletionInput,
  provider: ProviderName,
): Result<ProviderCompletion, ProviderError> {
  // R-06: "error" is a generation the provider itself reports as failed.
  if (result.finishReason === "error") {
    return err(
      toProviderError(input.target, provider, {
        cause: "malformed_response",
        retryable: false,
        message: "provider reported a failed generation",
      }),
    );
  }
  const { inputTokens, outputTokens } = result.usage;
  return ok({
    text: result.text,
    finishReason: toFinishReason(result.finishReason),
    ...(inputTokens !== undefined &&
      outputTokens !== undefined && {
        usage: { promptTokens: inputTokens, completionTokens: outputTokens },
      }),
    modelName: result.response.modelId,
  });
}

/** R-06: the contract list is closed; tool calls and unknown reasons end as `stop`. */
function toFinishReason(reason: Exclude<AiFinishReason, "error">): FinishReason {
  switch (reason) {
    case "length":
      return "length";
    case "content-filter":
      return "content_filter";
    case "stop":
    case "tool-calls":
    case "other":
      return "stop";
  }
}

interface FailureDescription {
  readonly cause: ProviderErrorCause;
  readonly retryable: boolean;
  readonly message: string;
  readonly status?: number;
}

function describeTimeout(): FailureDescription {
  return { cause: "timeout", retryable: true, message: "provider call timed out" };
}

/** R-05: AI SDK error → cause, retryable flag and upstream status. */
function describeError(error: unknown): FailureDescription {
  if (APICallError.isInstance(error)) return describeApiCallError(error);
  if (
    JSONParseError.isInstance(error) ||
    TypeValidationError.isInstance(error) ||
    InvalidResponseDataError.isInstance(error) ||
    NoContentGeneratedError.isInstance(error)
  ) {
    return malformedResponse();
  }
  if (error instanceof TypeError) {
    return { cause: "network", retryable: true, message: "provider unreachable" };
  }
  return { cause: "http_error", retryable: false, message: "provider call failed" };
}

function describeApiCallError(error: APICallError): FailureDescription {
  const status = error.statusCode;
  if (status === undefined) {
    return { cause: "network", retryable: true, message: "provider unreachable" };
  }
  // The SDK reports a 2xx body it cannot parse or validate as an APICallError.
  if (status >= 200 && status < 300) return malformedResponse();
  if (status === 429) {
    return {
      cause: "rate_limited",
      retryable: true,
      message: "provider rate limited the call (HTTP 429)",
      status,
    };
  }
  if (status >= 500) {
    return {
      cause: "http_error",
      retryable: true,
      message: `provider failed (HTTP ${status})`,
      status,
    };
  }
  if (status === 401 || status === 403) {
    return {
      cause: "authentication",
      retryable: false,
      message: `provider rejected the credential (HTTP ${status})`,
      status,
    };
  }
  return {
    cause: "http_error",
    retryable: false,
    message: `provider rejected the request (HTTP ${status})`,
    status,
  };
}

function malformedResponse(): FailureDescription {
  return {
    cause: "malformed_response",
    retryable: false,
    message: "provider response did not match its documented shape",
  };
}

function toProviderError(
  target: ModelTarget,
  provider: ProviderName,
  failure: FailureDescription,
): ProviderError {
  return providerError({ targetId: target.id, provider, ...failure });
}
