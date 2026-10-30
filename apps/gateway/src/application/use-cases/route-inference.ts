/**
 * `RouteInference`, non-streaming (spec 002 FR-012, data-model section 4.2; spec 003
 * FR-011 … FR-017, data-model section 3.3).
 *
 * In order: classify → active policy → `decide` → `executeChain` over the decided chain
 * (residency guard, circuit breaker, retry and timeout per target, fallback to the next)
 * → usage and cost of the target that answered → `createdAt` from the clock. Usage is the
 * provider's when it reports one, otherwise estimated with the classifier's estimator
 * (spec 002 FR-033, FR-034). A chain without an answer comes back as a `RoutingFailure`,
 * never as a throw.
 *
 * Spec 005 (FR-011 … FR-013): before deciding, the request's messages are inspected by the
 * privacy service; the decision applies the policy's privacy action. A block never calls a
 * provider; `anonymize` sends placeholders and restores the answer (`protectMessages`).
 * Usage and cost are those of the exchange the provider billed (US2-6).
 */

import { type PrivacyBlockedError, privacyBlockedError } from "../../domain/errors.js";
import { computeCost, type Usage } from "../../domain/model/cost.js";
import type { Abandoned } from "../../domain/model/fallback.js";
import type { InferenceRequest, Message } from "../../domain/model/inference-request.js";
import type { ModelTarget } from "../../domain/model/model-target.js";
import {
  type BlockDecision,
  type Decision,
  decide,
  type RoutingDecision,
} from "../../domain/model/routing-decision.js";
import type { RoutingPolicy } from "../../domain/model/routing-policy.js";
import type { Inspection } from "../../domain/model/sensitivity.js";
import { estimateTokens } from "../../domain/model/task-classifier.js";
import type { Milliseconds, Usd } from "../../domain/model/units.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { CircuitStatePort } from "../ports/circuit-state.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { ProviderCompletion } from "../ports/llm-provider.port.js";
import type { PolicyRepositoryPort } from "../ports/policy-repository.port.js";
import type { RoutingEventsPort } from "../ports/routing-events.port.js";
import type { TracerPort } from "../ports/tracer.port.js";
import type { ProviderRegistry } from "../provider-registry.js";
import { type ChainFailure, executeChain } from "../resilience/execute-chain.js";
import { classifyTask } from "./classify-task.js";
import type { InspectSensitivity } from "./inspect-sensitivity.js";
import {
  type AnonymizationNotice,
  type ProtectedMessages,
  protectMessages,
} from "./protect-messages.js";

export interface RouteInferenceDeps {
  readonly policies: PolicyRepositoryPort;
  readonly providers: ProviderRegistry;
  readonly clock: ClockPort;
  readonly circuitState: CircuitStatePort;
  readonly events: RoutingEventsPort;
  /** Uniform in `[0, 1)`, for backoff jitter (`Math.random` in production). */
  readonly random: () => number;
  /** Where the request's personal data is (spec 005 FR-011). */
  readonly inspect: InspectSensitivity;
  /** Added as a system message when anonymizing (spec 005 research R-06). */
  readonly anonymizationNotice: AnonymizationNotice;
  /** Attempt spans (spec 006 FR-009); none when absent. */
  readonly tracer?: TracerPort;
}

export interface RoutedCompletion {
  readonly decision: RoutingDecision;
  /** The target that answered. */
  readonly target: ModelTarget;
  readonly completion: ProviderCompletion;
  /** Reported by the provider, or estimated when it sent none (`estimated: true`). */
  readonly usage: Usage;
  readonly cost: Usd;
  /** Targets left before the answering one, in order (`x-tamiz-fallback`). */
  readonly abandoned: ReadonlyArray<Abandoned>;
  readonly createdAt: Date;
  /** Set when the request was anonymized: the notice version (`x-tamiz-privacy`). */
  readonly noticeVersion?: string;
}

/**
 * Why no answer came back: the chain was executed and failed (feature 003), or the
 * privacy step blocked the request before any provider was called (spec 005 FR-011).
 */
export type RoutingFailure =
  | { readonly decision: RoutingDecision; readonly failure: ChainFailure }
  | {
      readonly decision: BlockDecision;
      readonly failure: { readonly kind: "blocked"; readonly error: PrivacyBlockedError };
    };

export function blocked(decision: BlockDecision): RoutingFailure {
  const error = privacyBlockedError({
    ruleId: decision.ruleId,
    sensitivity: decision.sensitivity,
    reason: decision.reason,
  });
  return { decision, failure: { kind: "blocked", error } };
}

export type RouteInference = (
  request: InferenceRequest,
) => Promise<Result<RoutedCompletion, RoutingFailure>>;

/** The matched rule's timeout, else the target's, else the policy default (US6-6). */
export function effectiveTimeoutMs(
  decision: RoutingDecision,
  target: ModelTarget,
  policy: RoutingPolicy,
): Milliseconds {
  return decision.ruleTimeoutMs ?? target.timeoutMs ?? policy.defaultTimeoutMs;
}

/** FR-034: the provider's counts, or the classifier's estimate over the exchanged text. */
export function resolveUsage(
  completion: ProviderCompletion,
  messages: ReadonlyArray<Message>,
): Usage {
  if (completion.usage !== undefined) return { ...completion.usage, estimated: false };
  return {
    promptTokens: estimateTokens(messages.map((message) => message.content).join("")),
    completionTokens: estimateTokens(completion.text),
    estimated: true,
  };
}

/** Inspection, classification and decision, with the privacy events (spec 005 FR-015). */
export async function decideWithPrivacy(
  deps: Pick<RouteInferenceDeps, "inspect" | "policies" | "events" | "clock">,
  request: InferenceRequest,
  signal?: AbortSignal,
): Promise<{
  readonly policy: RoutingPolicy;
  readonly inspection: Inspection;
  readonly decision: Decision;
}> {
  const [inspection, policy] = await Promise.all([
    deps.inspect({
      requestId: request.requestId,
      messages: request.messages.map((message) => message.content),
      ...(signal === undefined ? {} : { signal }),
    }),
    deps.policies.getActive(),
  ]);
  const decision = decide(policy, classifyTask(request, inspection));
  deps.events.emit({
    type: "privacy.action",
    requestId: request.requestId,
    sensitivity: decision.sensitivity,
    action: decision.privacyAction,
    ruleId: decision.ruleId,
    at: deps.clock.now().toISOString(),
  });
  return { policy, inspection, decision };
}

/** Anonymizes when the decision says so, and records how many values were replaced. */
export function protectForProvider(
  deps: RouteInferenceDeps,
  request: InferenceRequest,
  decision: RoutingDecision,
  inspection: Inspection,
): ProtectedMessages {
  const sent = protectMessages(decision, inspection, request.messages, deps.anonymizationNotice);
  if (sent.noticeVersion !== undefined) {
    deps.events.emit({
      type: "privacy.anonymized",
      requestId: request.requestId,
      placeholders: sent.placeholders,
      at: deps.clock.now().toISOString(),
    });
  }
  return sent;
}

export function routeInference(deps: RouteInferenceDeps): RouteInference {
  const execute = executeChain<ProviderCompletion>({
    clock: deps.clock,
    random: deps.random,
    events: deps.events,
    circuitState: deps.circuitState,
    ...(deps.tracer === undefined ? {} : { tracer: deps.tracer }),
  });

  return async (request) => {
    const { policy, inspection, decision } = await decideWithPrivacy(deps, request);
    if (decision.kind === "block") return err(blocked(decision));
    const sent = protectForProvider(deps, request, decision, inspection);

    const served = await execute(
      {
        requestId: request.requestId,
        decision,
        resilience: policy.resilience,
        timeoutFor: (target) => effectiveTimeoutMs(decision, target, policy),
      },
      (target, signal, timeoutMs) =>
        deps.providers.resolve(target.provider).complete({
          target,
          messages: sent.providerMessages,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
          timeoutMs,
          signal,
        }),
      (completion) => ({
        "gen_ai.response.model": completion.modelName,
        "gen_ai.response.finish_reasons": [completion.finishReason],
        ...(completion.usage === undefined
          ? {}
          : {
              "gen_ai.usage.input_tokens": completion.usage.promptTokens,
              "gen_ai.usage.output_tokens": completion.usage.completionTokens,
            }),
      }),
    );
    if (!served.ok) return err({ decision, failure: served.error });

    const { target, value: completion, abandoned } = served.value;
    // Usage and cost of what the provider saw and billed (US2-6), before restoring.
    const usage = resolveUsage(completion, sent.providerMessages);
    return ok({
      decision,
      target,
      completion: { ...completion, text: sent.restore(completion.text) },
      usage,
      cost: computeCost(usage, target.pricing),
      abandoned,
      createdAt: deps.clock.now(),
      ...(sent.noticeVersion === undefined ? {} : { noticeVersion: sent.noticeVersion }),
    });
  };
}
