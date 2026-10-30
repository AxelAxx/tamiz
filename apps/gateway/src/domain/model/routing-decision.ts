/**
 * The routing decision (spec 002 US3, FR-005 … FR-007, research R-08, data-model
 * section 3.5; spec 005 FR-003, research R-04).
 *
 * `decide` is total and pure over a policy returned by `validatePolicy`: rules are tried
 * in declaration order, the first whose condition matches supplies the chain, and no
 * match falls back to the default chain. Then the privacy step (`applyPrivacy`) turns the
 * request's inspection into an action: the chain is kept, filtered by residency, replaced
 * by the local route, or the request is blocked. A blocked request has no chain at all.
 */
import { type ModelTarget, RESIDENCIES, type Residency } from "./model-target.js";
import { applyPrivacy, type BlockReason, type RouteAction } from "./privacy-policy.js";
import {
  DEFAULT_RULE_ID,
  type RoutingPolicy,
  type RoutingRule,
  targetById,
} from "./routing-policy.js";
import { type EntityKind, entityCounts, type Sensitivity, sensitivityOf } from "./sensitivity.js";
import type { ClassifiedRequest, TaskSize, TaskType } from "./task-classifier.js";
import type { Milliseconds, PolicyId, RuleId } from "./units.js";

export { PRIVACY_ACTIONS, type PrivacyAction } from "./privacy-policy.js";

/** The part of a classified request the decision reads. */
export type DecisionInput = Pick<
  ClassifiedRequest,
  "requestedModel" | "taskType" | "size" | "inspection"
>;

/** The request goes to `chain`, in order (feature 003 executes it). */
export interface RoutingDecision {
  readonly kind: "route";
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
  /** How many of each kind were detected (spec 006 audit); never values or positions. */
  readonly entityCounts: Readonly<Partial<Record<EntityKind, number>>>;
  readonly privacyAction: RouteAction;
  /**
   * Where this request's data may be processed: the rule's (or default chain's) residency
   * list narrowed by the level's (spec 003 FR-012, spec 005 FR-003); `[local]` for
   * `restrict_to_local`.
   */
  readonly allowedResidencies: ReadonlyArray<Residency>;
}

/** No provider may be called (spec 005 FR-003, FR-011). */
export interface BlockDecision {
  readonly kind: "block";
  readonly policyId: PolicyId;
  readonly policyVersion: number;
  readonly ruleId: RuleId | typeof DEFAULT_RULE_ID;
  readonly taskType: TaskType;
  readonly size: TaskSize;
  readonly sensitivity: Sensitivity;
  readonly entityCounts: Readonly<Partial<Record<EntityKind, number>>>;
  readonly privacyAction: "block";
  readonly reason: BlockReason;
}

export type Decision = RoutingDecision | BlockDecision;

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

/** Decides the ordered chain of targets for a classified request, or blocks it. */
export function decide(policy: RoutingPolicy, request: DecisionInput): Decision {
  const rule = policy.rules.find((candidate) => matches(candidate, request));
  const ruleChain =
    rule === undefined
      ? policy.default.route.map((id) => targetById(policy, id))
      : orderTargets(rule, policy);
  const ruleResidency = rule === undefined ? policy.default.residency : rule.residency;
  const common = {
    policyId: policy.id,
    policyVersion: policy.version,
    ruleId: rule === undefined ? DEFAULT_RULE_ID : rule.id,
    taskType: request.taskType,
    size: request.size,
    sensitivity: sensitivityOf(request.inspection),
    entityCounts: entityCounts(request.inspection),
  } as const;
  const outcome = applyPrivacy({
    chain: ruleChain,
    ...(ruleResidency === undefined ? {} : { ruleResidency }),
    privacy: policy.privacy,
    localChain: policy.privacy.localRoute.map((id) => targetById(policy, id)),
    inspection: request.inspection,
  });
  if (outcome.kind === "block") {
    return { kind: "block", ...common, privacyAction: "block", reason: outcome.reason };
  }
  return {
    kind: "route",
    ...common,
    ...(rule?.timeoutMs === undefined ? {} : { ruleTimeoutMs: rule.timeoutMs }),
    chain: outcome.chain,
    privacyAction: outcome.action,
    allowedResidencies: outcome.allowedResidencies,
  };
}

/** Every residency, for callers that build decisions by hand (tests, simulations). */
export const ALL_RESIDENCIES: ReadonlyArray<Residency> = RESIDENCIES;
