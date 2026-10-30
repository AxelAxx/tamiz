/**
 * The routing decision (spec 002 US3, FR-005 … FR-007, research R-08, data-model
 * section 3.5).
 *
 * `decide` is total and pure over a policy returned by `validatePolicy`: rules are tried
 * in declaration order, the first whose condition matches supplies the chain, and no
 * match falls back to the default chain. The chain is computed in full; only `chain[0]`
 * is executed in feature 002, feature 003 walks the rest.
 */
import { type ModelTarget, RESIDENCIES, type Residency } from "./model-target.js";
import {
  DEFAULT_RULE_ID,
  type RoutingPolicy,
  type RoutingRule,
  targetById,
} from "./routing-policy.js";
import type { Sensitivity } from "./sensitivity.js";
import type { ClassifiedRequest, TaskSize, TaskType } from "./task-classifier.js";
import type { Milliseconds, PolicyId, RuleId } from "./units.js";

/** Feature 005 adds `anonymize`, `restrict_to_local` and `block`. */
export const PRIVACY_ACTIONS = ["allow"] as const;
export type PrivacyAction = (typeof PRIVACY_ACTIONS)[number];

/** The part of a classified request the decision reads. */
export type DecisionInput = Pick<
  ClassifiedRequest,
  "requestedModel" | "taskType" | "size" | "sensitivity"
>;

export interface RoutingDecision {
  readonly policyId: PolicyId;
  readonly policyVersion: number;
  readonly ruleId: RuleId | typeof DEFAULT_RULE_ID;
  /** Copied from the matched rule when it sets a timeout. */
  readonly ruleTimeoutMs?: Milliseconds;
  /** Non-empty, no duplicates, every target declared in the policy. */
  readonly chain: ReadonlyArray<ModelTarget>;
  readonly taskType: TaskType;
  readonly size: TaskSize;
  readonly sensitivity: Sensitivity;
  readonly privacyAction: PrivacyAction;
  /**
   * Where this request's data may be processed: the matched rule's or the default
   * chain's residency list, or every residency (spec 003 FR-012). Feature 005 narrows it.
   */
  readonly allowedResidencies: ReadonlyArray<Residency>;
}

function includesIfPresent<T>(values: ReadonlyArray<T> | undefined, value: T): boolean {
  return values === undefined || values.includes(value);
}

/** True when each present field of the rule's condition contains the request's value. */
export function matches(rule: RoutingRule, request: DecisionInput): boolean {
  const { when } = rule;
  return (
    includesIfPresent(when.taskType, request.taskType) &&
    includesIfPresent(when.size, request.size) &&
    includesIfPresent(when.requestedModel, request.requestedModel)
  );
}

function totalPrice(target: ModelTarget): number {
  return target.pricing.inputUsdPerMillion + target.pricing.outputUsdPerMillion;
}

/** The rule's targets, sorted by input + output price when `orderBy: "cost"` (stable). */
export function orderTargets(rule: RoutingRule, policy: RoutingPolicy): ReadonlyArray<ModelTarget> {
  const targets = rule.route.map((id) => targetById(policy, id));
  if (rule.orderBy !== "cost") return targets;
  return targets.sort((a, b) => totalPrice(a) - totalPrice(b));
}

/** Decides the ordered chain of targets for a classified request. */
export function decide(policy: RoutingPolicy, request: DecisionInput): RoutingDecision {
  const rule = policy.rules.find((candidate) => matches(candidate, request));
  const chain =
    rule === undefined
      ? policy.default.route.map((id) => targetById(policy, id))
      : orderTargets(rule, policy);
  return {
    policyId: policy.id,
    policyVersion: policy.version,
    ruleId: rule === undefined ? DEFAULT_RULE_ID : rule.id,
    ...(rule?.timeoutMs === undefined ? {} : { ruleTimeoutMs: rule.timeoutMs }),
    chain,
    taskType: request.taskType,
    size: request.size,
    sensitivity: request.sensitivity,
    privacyAction: "allow",
    allowedResidencies:
      (rule === undefined ? policy.default.residency : rule.residency) ?? RESIDENCIES,
  };
}
