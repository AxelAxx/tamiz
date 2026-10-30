/**
 * `RouteInference`, non-streaming (spec 002 FR-012, data-model section 4.2).
 *
 * In order: classify → active policy → `decide` → `chain[0]` → effective timeout →
 * provider call → `createdAt` from the clock. Only `chain[0]` is called in feature 002;
 * the full chain stays in the decision for feature 003. A provider failure comes back
 * as a `RoutingFailure`, never as a throw. `T-002-07` adds the cost step and turns
 * `usage` into reported-or-estimated usage.
 */
import type { ProviderError } from "../../domain/errors.js";
import type { InferenceRequest } from "../../domain/model/inference-request.js";
import type { ModelTarget } from "../../domain/model/model-target.js";
import { decide, type RoutingDecision } from "../../domain/model/routing-decision.js";
import type { RoutingPolicy } from "../../domain/model/routing-policy.js";
import type { Milliseconds } from "../../domain/model/units.js";
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
  /** The provider's reported usage, when it sent one. */
  readonly usage?: ProviderCompletion["usage"];
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
    return ok({
      decision,
      target,
      completion,
      ...(completion.usage === undefined ? {} : { usage: completion.usage }),
      createdAt: deps.clock.now(),
    });
  };
}
