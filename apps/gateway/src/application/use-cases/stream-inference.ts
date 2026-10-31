/**
 * `StreamInference` (spec 003 US6, FR-021 … FR-027, research R-08, R-09, data-model
 * section 3.3).
 *
 * The same order as `routeInference`: classify → active policy → `decide` →
 * `executeChain`, with `provider.stream` as the attempt. A stream attempt succeeds at its
 * first token, so residency, breaker, retry and fallback rules apply exactly as for a
 * completion up to that point (FR-023). After it, parts are passed through: a failure
 * ends the stream with one error part, is never fallen back, and counts for the target's
 * circuit (FR-024). The finish carries usage (reported, or estimated from the streamed
 * text) and its cost (FR-026). The client's signal reaches the provider (FR-027).
 *
 * Spec 005: the same inspection and privacy actions as `routeInference` happen before the
 * stream starts. For `anonymize` the streamed text goes through a placeholder-safe
 * restorer (FR-016, FR-017): a placeholder split across chunks is held until complete and
 * restored once; plain text passes at once; what is held is flushed before the finish or
 * the error part.
 *
 * Tool calling (009 tool-calling FR-013, FR-017, research T-R07, T-R08): tool-call starts
 * and argument pieces pass through with one JSON-escaping restorer per call index; held
 * text is flushed before a call starts, and every call's held arguments are flushed in index
 * order before the finish or the error part.
 */
import type { ProviderError } from "../../domain/errors.js";
import { computeCost, type Usage } from "../../domain/model/cost.js";
import type { Abandoned } from "../../domain/model/fallback.js";
import type { InferenceRequest, ToolCall } from "../../domain/model/inference-request.js";
import type { ModelTarget } from "../../domain/model/model-target.js";
import type { StreamRestorer } from "../../domain/model/restore-stream.js";
import type { RoutingDecision } from "../../domain/model/routing-decision.js";
import type { RoutingPolicy } from "../../domain/model/routing-policy.js";
import type { Usd } from "../../domain/model/units.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { FinishReason, StartedStream } from "../ports/llm-provider.port.js";
import { createCircuitBreaker } from "../resilience/circuit-breaker.js";
import { executeChain } from "../resilience/execute-chain.js";
import type { ProtectedRequest } from "./protect-request.js";
import {
  blocked,
  decideWithPrivacy,
  effectiveTimeoutMs,
  protectForProvider,
  type RouteInferenceDeps,
  type RoutingFailure,
  resolveUsage,
  toolOptions,
} from "./route-inference.js";

export type RoutedStreamPart =
  | { readonly type: "delta"; readonly text: string }
  | {
      readonly type: "tool-call-start";
      readonly index: number;
      readonly id: string;
      readonly name: string;
    }
  | { readonly type: "tool-call-delta"; readonly index: number; readonly arguments: string }
  | {
      readonly type: "finish";
      readonly finishReason: FinishReason;
      readonly usage: Usage;
      readonly cost: Usd;
    }
  | { readonly type: "error"; readonly error: ProviderError };

export interface RoutedStream {
  readonly decision: RoutingDecision;
  /** The target that produced the first token. */
  readonly target: ModelTarget;
  /** Targets left before it, in order (`x-tamiz-fallback`). */
  readonly abandoned: ReadonlyArray<Abandoned>;
  /** The same in every chunk of the stream. */
  readonly modelName: string;
  readonly first: string;
  /** Deltas, then exactly one `finish` or one `error`. */
  readonly parts: AsyncIterable<RoutedStreamPart>;
  readonly createdAt: Date;
  /** Set when the request was anonymized: the notice version (`x-tamiz-privacy`). */
  readonly noticeVersion?: string;
}

export type StreamInference = (
  request: InferenceRequest,
  signal?: AbortSignal,
) => Promise<Result<RoutedStream, RoutingFailure>>;

export function streamInference(deps: RouteInferenceDeps): StreamInference {
  const execute = executeChain<StartedStream>({
    clock: deps.clock,
    random: deps.random,
    events: deps.events,
    circuitState: deps.circuitState,
    ...(deps.tracer === undefined ? {} : { tracer: deps.tracer }),
  });

  /** Passes the parts through, prices the finish, records a mid-stream failure. */
  async function* routedParts(
    request: InferenceRequest,
    policy: RoutingPolicy,
    target: ModelTarget,
    started: StartedStream,
    sent: ProtectedRequest,
    restorer: StreamRestorer,
  ): AsyncGenerator<RoutedStreamPart> {
    let text = started.first;
    const calls: Array<{ id: string; name: string; arguments: string }> = [];
    const argumentRestorers: StreamRestorer[] = [];
    /** Everything still held, text first, then each call's arguments in index order. */
    function* flushAll(): Generator<RoutedStreamPart> {
      const held = restorer.flush();
      if (held !== "") yield { type: "delta", text: held };
      for (const [index, argumentRestorer] of argumentRestorers.entries()) {
        const rest = argumentRestorer.flush();
        if (rest !== "") yield { type: "tool-call-delta", index, arguments: rest };
      }
    }
    for await (const part of started.rest) {
      switch (part.type) {
        case "delta": {
          text += part.text;
          const restored = restorer.push(part.text);
          if (restored !== "") yield { type: "delta", text: restored };
          break;
        }
        case "tool-call-start": {
          const held = restorer.flush();
          if (held !== "") yield { type: "delta", text: held };
          calls[part.index] = { id: part.id, name: part.name, arguments: "" };
          argumentRestorers[part.index] = sent.argumentsRestorer();
          yield part;
          break;
        }
        case "tool-call-delta": {
          const call = calls[part.index];
          const argumentRestorer = argumentRestorers[part.index];
          if (call === undefined || argumentRestorer === undefined) break;
          call.arguments += part.arguments;
          const restored = argumentRestorer.push(part.arguments);
          if (restored !== "")
            yield { type: "tool-call-delta", index: part.index, arguments: restored };
          break;
        }
        case "finish": {
          yield* flushAll();
          const toolCalls: ReadonlyArray<ToolCall> = calls.filter((call) => call !== undefined);
          const usage = resolveUsage(
            {
              text,
              toolCalls,
              finishReason: part.finishReason,
              modelName: started.modelName,
              ...(part.usage === undefined ? {} : { usage: part.usage }),
            },
            sent.providerMessages,
          );
          yield {
            type: "finish",
            finishReason: part.finishReason,
            usage,
            cost: computeCost(usage, target.pricing),
          };
          return;
        }
        case "error": {
          yield* flushAll();
          // A client that went away is not a provider failure.
          if (part.error.cause !== "aborted")
            await recordFailure(request, policy, target, part.error);
          yield part;
          return;
        }
      }
    }
  }

  async function recordFailure(
    request: InferenceRequest,
    policy: RoutingPolicy,
    target: ModelTarget,
    error: ProviderError,
  ): Promise<void> {
    deps.events.emit({
      type: "stream.failed",
      requestId: request.requestId,
      targetId: target.id,
      provider: target.provider,
      residency: target.residency,
      at: deps.clock.now().toISOString(),
      reason: error.cause,
    });
    const breaker = createCircuitBreaker({
      state: deps.circuitState,
      clock: deps.clock,
      events: deps.events,
      settings: policy.resilience.circuitBreaker,
    });
    await breaker.onResult(target, { requestId: request.requestId }, err(error), { kind: "call" });
  }

  return async (request, signal) => {
    const { policy, inspection, decision } = await decideWithPrivacy(deps, request, signal);
    if (decision.kind === "block") return err(blocked(decision));
    const sent = protectForProvider(deps, request, decision, inspection);

    const served = await execute(
      {
        requestId: request.requestId,
        decision,
        resilience: policy.resilience,
        timeoutFor: (target) => effectiveTimeoutMs(decision, target, policy),
        ...(signal === undefined ? {} : { signal }),
      },
      (target, attemptSignal, timeoutMs) =>
        deps.providers.resolve(target.provider).stream({
          target,
          messages: sent.providerMessages,
          ...toolOptions(request),
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
          timeoutMs,
          // The attempt's signal bounds the wait for the first token; the client's signal
          // must keep reaching the provider for the rest of the stream.
          signal: signal === undefined ? attemptSignal : AbortSignal.any([attemptSignal, signal]),
        }),
      // A stream attempt ends at the first token; usage is on the request span.
      (started) => ({ "gen_ai.response.model": started.modelName }),
    );
    if (!served.ok) return err({ decision, failure: served.error });

    const { target, value: started, abandoned } = served.value;
    const restorer = sent.streamRestorer();
    return ok({
      decision,
      target,
      abandoned,
      modelName: started.modelName,
      first: restorer.push(started.first),
      parts: routedParts(request, policy, target, started, sent, restorer),
      createdAt: deps.clock.now(),
      ...(sent.noticeVersion === undefined ? {} : { noticeVersion: sent.noticeVersion }),
    });
  };
}
