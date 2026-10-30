/**
 * `RouteInference`, non-streaming (spec 002 FR-012, data-model section 4.2).
 *
 * In order: classify → active policy → `decide` → `chain[0]` → effective timeout →
 * provider call → `createdAt` from the clock. Only `chain[0]` is called in feature 002;
 * the full chain stays in the decision for feature 003. A provider failure comes back
 * as a `RoutingFailure`, never as a throw. Usage is the provider's when it reports one,
 * otherwise estimated with the classifier's estimator, and it is priced with the
 * target's pricing (spec 002 FR-033, FR-034).
 */
import type { ProviderError } from "../../domain/errors.js";
import { computeCost, type Usage } from "../../domain/model/cost.js";
import type { InferenceRequest, Message } from "../../domain/model/inference-request.js";
import type { ModelTarget } from "../../domain/model/model-target.js";
import { decide, type RoutingDecision } from "../../domain/model/routing-decision.js";
import type { RoutingPolicy } from "../../domain/model/routing-policy.js";
import { estimateTokens } from "../../domain/model/task-classifier.js";
import type { Milliseconds, Usd } from "../../domain/model/units.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { ProviderCompletion } from "../ports/llm-provider.port.js";
import type { PolicyRepositoryPort } from "../ports/policy-repository.port.js";
import type { ProviderRegistry } from "../provider-registry.js";
import { classifyTask } from "./classify-task.js";

export interface RouteInferenceDeps {
  readonly policies: PolicyRepositoryPort;
  readonly providers: ProviderRegistry;
  readonly clock: ClockPort;
}

export interface RoutedCompletion {
  readonly decision: RoutingDecision;
  readonly target: ModelTarget;
  readonly completion: ProviderCompletion;
  /** Reported by the provider, or estimated when it sent none (`estimated: true`). */
  readonly usage: Usage;
  readonly cost: Usd;
  readonly createdAt: Date;
}

export interface RoutingFailure {
  readonly decision: RoutingDecision;
  readonly target: ModelTarget;
  readonly error: ProviderError;
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
  return async (request) => {
    const classified = classifyTask(request);
    const policy = await deps.policies.getActive();
    const decision = decide(policy, classified);
    const target = decision.chain[0];
    if (target === undefined) {
      // `decide` returns a non-empty chain for every validated policy (research R-08).
      throw new Error(`Policy ${policy.id} produced an empty chain; was it validated?`);
    }

    const result = await deps.providers.resolve(target.provider).complete({
      target,
      messages: request.messages,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
      timeoutMs: effectiveTimeoutMs(decision, target, policy),
    });
    if (!result.ok) {
      return err({ decision, target, error: result.error });
    }

    const completion = result.value;
    const usage = resolveUsage(completion, request.messages);
    return ok({
      decision,
      target,
      completion,
      usage,
      cost: computeCost(usage, target.pricing),
      createdAt: deps.clock.now(),
    });
  };
}
