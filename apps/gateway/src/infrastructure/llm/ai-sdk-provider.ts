/**
 * The one `LlmProviderPort` implementation over Vercel AI SDK 6 (spec 002 FR-014 …
 * FR-017, research R-04 … R-06; spec 003 FR-025, FR-027, FR-028, research R-03, R-09).
 * Each provider adapter only supplies its model factory.
 *
 * This is the only module that knows AI SDK error classes. A call is bounded by the
 * input's `timeoutMs` and ended early by the input's `signal` (request deadline, client
 * disconnect); `maxRetries: 0` leaves retrying to the resilience layer. A stream resolves
 * at its first token; afterwards `timeoutMs` bounds every gap between parts. Errors carry
 * fixed messages: never the credential, the request messages, the upstream URL or the
 * upstream body.
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
  streamText,
  type TextStreamPart,
  type ToolSet,
  TypeValidationError,
} from "ai";
import type {
  FinishReason,
  LlmProviderPort,
  ProviderCompletion,
  ProviderCompletionInput,
  StartedStream,
  StreamPart,
} from "../../application/ports/llm-provider.port.js";
import { type ProviderError, type ProviderErrorCause, providerError } from "../../domain/errors.js";
import type { Message } from "../../domain/model/inference-request.js";
import type { ModelTarget, ProviderName } from "../../domain/model/model-target.js";
import type { Milliseconds } from "../../domain/model/units.js";
import { err, ok, type Result } from "../../domain/result.js";

export interface AiSdkProviderOptions {
  readonly provider: ProviderName;
  /** Builds the AI SDK model for a target's provider model name. */
  readonly languageModel: (modelName: string) => LanguageModel;
}

/** Why one of our own signals ended a call. */
type AbortCause = "timeout" | "aborted";

/**
 * The signal a call runs under: our timer (re-armed by `arm`) or the caller's signal,
 * whichever fires first. It remembers which one did, so the outcome is classified
 * correctly however the SDK or fetch wraps the abort.
 */
function callSignal(timeoutMs: number, outer?: AbortSignal) {
  const controller = new AbortController();
  let cause: AbortCause | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = (reason: AbortCause) => {
    if (controller.signal.aborted) return;
    cause = reason;
    controller.abort();
  };
  const onOuterAbort = () => fire("aborted");
  if (outer?.aborted) fire("aborted");
  else outer?.addEventListener("abort", onOuterAbort, { once: true });
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => fire("timeout"), timeoutMs);
  };
  arm();
  return {
    signal: controller.signal,
    arm,
    cause: () => cause,
    cancel: () => fire("aborted"),
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuterAbort);
    },
  };
}

type CallSignal = ReturnType<typeof callSignal>;
type FullStreamIterator = AsyncIterator<TextStreamPart<ToolSet>>;

/**
 * The next stream part, or `"aborted"` as soon as our signal fires. The transport does
 * not always end a body read on abort (a mocked or stalled body keeps waiting), so the
 * adapter never relies on it: the timeout holds whatever the transport does.
 */
function nextPart(
  iterator: FullStreamIterator,
  signal: AbortSignal,
): Promise<IteratorResult<TextStreamPart<ToolSet>> | "aborted"> {
  if (signal.aborted) return Promise.resolve("aborted");
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve("aborted");
    signal.addEventListener("abort", onAbort, { once: true });
    iterator.next().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function createAiSdkProvider(options: AiSdkProviderOptions): LlmProviderPort {
  const failure = (
    input: ProviderCompletionInput,
    call: CallSignal,
    error: unknown,
  ): ProviderError => {
    const cause = call.cause();
    return toProviderError(
      input.target,
      options.provider,
      cause === undefined ? describeError(error) : describeAbort(cause),
    );
  };

  const settings = (input: ProviderCompletionInput, call: CallSignal) => ({
    model: options.languageModel(input.target.model),
    messages: input.messages.map(toModelMessage),
    ...(input.temperature !== undefined && { temperature: input.temperature }),
    ...(input.maxTokens !== undefined && { maxOutputTokens: input.maxTokens }),
    abortSignal: call.signal,
    maxRetries: 0,
  });

  /** Everything after the first token: deltas, then one finish or one error. */
  async function* rest(
    input: ProviderCompletionInput,
    call: CallSignal,
    iterator: FullStreamIterator,
  ): AsyncGenerator<StreamPart> {
    let ended = false;
    const end = (part: StreamPart) => {
      ended = true;
      return part;
    };
    try {
      for (;;) {
        let next: IteratorResult<TextStreamPart<ToolSet>> | "aborted";
        try {
          next = await nextPart(iterator, call.signal);
        } catch (error) {
          yield end({ type: "error", error: failure(input, call, error) });
          return;
        }
        if (next === "aborted") {
          yield end({ type: "error", error: failure(input, call, undefined) });
          return;
        }
        call.arm();
        if (next.done) {
          yield end({ type: "error", error: malformedError(input, options.provider) });
          return;
        }
        const part = next.value;
        switch (part.type) {
          case "text-delta":
            if (part.text !== "") yield { type: "delta", text: part.text };
            break;
          case "finish":
            yield end(toFinishPart(part, input, options.provider));
            return;
          case "error":
            yield end({ type: "error", error: failure(input, call, part.error) });
            return;
          case "abort":
            yield end({ type: "error", error: failure(input, call, undefined) });
            return;
          default:
            break;
        }
      }
    } finally {
      // The consumer stopped early (client disconnect): end the upstream call too.
      if (!ended) call.cancel();
      call.dispose();
    }
  }

  return {
    async complete(input) {
      const call = callSignal(input.timeoutMs, input.signal);
      try {
        const result = await generateText(settings(input, call));
        return toCompletion(result, input, options.provider);
      } catch (error) {
        return err(failure(input, call, error));
      } finally {
        call.dispose();
      }
    },

    async stream(input): Promise<Result<StartedStream, ProviderError>> {
      const call = callSignal(input.timeoutMs, input.signal);
      try {
        const iterator = streamText(settings(input, call)).fullStream[Symbol.asyncIterator]();
        for (;;) {
          const next = await nextPart(iterator, call.signal);
          if (next === "aborted") {
            call.dispose();
            return err(failure(input, call, undefined));
          }
          if (next.done) {
            call.dispose();
            return err(malformedError(input, options.provider));
          }
          const part = next.value;
          switch (part.type) {
            case "text-delta":
              if (part.text === "") break;
              call.arm();
              return ok({
                first: part.text,
                modelName: input.target.model,
                rest: rest(input, call, iterator),
              });
            case "finish": {
              // A complete answer with no text at all.
              call.dispose();
              const finish = toFinishPart(part, input, options.provider);
              if (finish.type === "error") return err(finish.error);
              return ok({ first: "", modelName: input.target.model, rest: once(finish) });
            }
            case "error":
              call.dispose();
              return err(failure(input, call, part.error));
            case "abort":
              call.dispose();
              return err(failure(input, call, undefined));
            default:
              break;
          }
        }
      } catch (error) {
        call.dispose();
        return err(failure(input, call, error));
      }
    },
  };
}

async function* once(part: StreamPart): AsyncGenerator<StreamPart> {
  yield part;
}

/**
 * The end of a stream. A finish without a raw reason means the provider closed the stream
 * without saying why (the SDK fills in "other"), and "error" is a failed generation: both
 * are malformed, never a successful completion (spec 003 edge case).
 */
function toFinishPart(
  part: Extract<TextStreamPart<ToolSet>, { type: "finish" }>,
  input: ProviderCompletionInput,
  provider: ProviderName,
): StreamPart {
  if (part.finishReason === "error" || part.rawFinishReason === undefined) {
    return { type: "error", error: malformedError(input, provider) };
  }
  const { inputTokens, outputTokens } = part.totalUsage;
  return {
    type: "finish",
    finishReason: toFinishReason(part.finishReason),
    ...(inputTokens !== undefined &&
      outputTokens !== undefined && {
        usage: { promptTokens: inputTokens, completionTokens: outputTokens },
      }),
  };
}

function malformedError(input: ProviderCompletionInput, provider: ProviderName): ProviderError {
  return toProviderError(input.target, provider, malformedResponse());
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
  readonly retryAfterMs?: Milliseconds;
}

function describeAbort(cause: AbortCause): FailureDescription {
  return cause === "timeout"
    ? { cause: "timeout", retryable: true, message: "provider call timed out" }
    : { cause: "aborted", retryable: false, message: "provider call aborted" };
}

/** An upstream `retry-after` in seconds or as an HTTP date (spec 003 FR-004). */
function retryAfterMs(error: APICallError): Milliseconds | undefined {
  const value = error.responseHeaders?.["retry-after"];
  if (value === undefined) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? (Math.round(ms) as Milliseconds) : undefined;
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
  if (status >= 200 && status < 300) {
    // A 2xx body cut off by the transport (a stream that broke mid-way) is a network
    // failure; one the SDK cannot parse or validate is malformed.
    if (error.cause instanceof TypeError) {
      return { cause: "network", retryable: true, message: "provider connection failed" };
    }
    return malformedResponse();
  }
  const hint = retryAfterMs(error);
  const withHint = hint === undefined ? {} : { retryAfterMs: hint };
  if (status === 429) {
    return {
      cause: "rate_limited",
      retryable: true,
      message: "provider rate limited the call (HTTP 429)",
      status,
      ...withHint,
    };
  }
  if (status >= 500) {
    return {
      cause: "http_error",
      retryable: true,
      message: `provider failed (HTTP ${status})`,
      status,
      ...withHint,
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
