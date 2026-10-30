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
 */

import { type PrivacyBlockedError, privacyBlockedError } from "../../domain/errors.js";
import { computeCost, type Usage } from "../../domain/model/cost.js";
import type { Abandoned } from "../../domain/model/fallback.js";
import type { InferenceRequest, Message } from "../../domain/model/inference-request.js";
import type { ModelTarget } from "../../domain/model/model-target.js";
import {
  type BlockDecision,
  decide,
  type RoutingDecision,
} from "../../domain/model/routing-decision.js";
import type { RoutingPolicy } from "../../domain/model/routing-policy.js";
import { estimateTokens } from "../../domain/model/task-classifier.js";
import type { Milliseconds, Usd } from "../../domain/model/units.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { CircuitStatePort } from "../ports/circuit-state.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { ProviderCompletion } from "../ports/llm-provider.port.js";
import type { PolicyRepositoryPort } from "../ports/policy-repository.port.js";
import type { RoutingEventsPort } from "../ports/routing-events.port.js";
import type { ProviderRegistry } from "../provider-registry.js";
import { type ChainFailure, executeChain } from "../resilience/execute-chain.js";
import { classifyTask } from "./classify-task.js";

export interface RouteInferenceDeps {
  readonly policies: PolicyRepositoryPort;
  readonly providers: ProviderRegistry;
  readonly clock: ClockPort;
  readonly circuitState: CircuitStatePort;
  readonly events: RoutingEventsPort;
  /** Uniform in `[0, 1)`, for backoff jitter (`Math.random` in production). */
  readonly random: () => number;
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

export function routeInference(deps: RouteInferenceDeps): RouteInference {
  const execute = executeChain<ProviderCompletion>({
    clock: deps.clock,
    random: deps.random,
    events: deps.events,
    circuitState: deps.circuitState,
  });

  return async (request) => {
    const classified = classifyTask(request);
    const policy = await deps.policies.getActive();
    const decision = decide(policy, classified);
    if (decision.kind === "block") return err(blocked(decision));

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
          messages: request.messages,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
          timeoutMs,
          signal,
        }),
    );
    if (!served.ok) return err({ decision, failure: served.error });

    const { target, value: completion, abandoned } = served.value;
    const usage = resolveUsage(completion, request.messages);
    return ok({
      decision,
      target,
      completion,
      usage,
      cost: computeCost(usage, target.pricing),
      abandoned,
      createdAt: deps.clock.now(),
    });
  };
}
