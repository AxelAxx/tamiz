/**
 * The operator's declarative routing policy and its cross-field validation (spec 002
 * FR-003, FR-004, research R-02, data-model sections 2.3 and 3.4).
 *
 * The policy file's *shape* (types, enums, unknown keys) is checked by
 * `RoutingPolicySchema` in `@tamiz/contracts` at the edge (`T-002-05`); this module checks
 * what a schema cannot: unique ids, the reserved rule id, chains that reference declared
 * targets without repeats, and the domain's unit rules. In-memory policies built in
 * tests go through the same function, so `decide` can rely on a validated policy.
 */
import { type ErrorIssue, type ValidationError, validationError } from "../errors.js";
import { err, ok, type Result } from "../result.js";
import type { ModelTarget, ProviderName, Residency } from "./model-target.js";
import type { TaskSize, TaskType } from "./task-classifier.js";
import {
  type Milliseconds,
  milliseconds,
  type PolicyId,
  policyId,
  type RuleId,
  ruleId,
  type TargetId,
  targetId,
  type Usd,
  usd,
} from "./units.js";

/** Rule id reserved for "no rule matched, the default chain was used". */
export const DEFAULT_RULE_ID = "default";
/** Used when the policy file omits `defaultTimeoutMs`. */
export const DEFAULT_POLICY_TIMEOUT_MS = 30_000;

export const ORDER_BY = ["cost"] as const;
export type OrderBy = (typeof ORDER_BY)[number];

/** Each present field must contain the request's value; `{}` matches every request. */
export interface RuleCondition {
  readonly taskType?: ReadonlyArray<TaskType>;
  readonly size?: ReadonlyArray<TaskSize>;
  readonly requestedModel?: ReadonlyArray<string>;
}

export interface RoutingRule {
  readonly id: RuleId;
  readonly when: RuleCondition;
  readonly route: ReadonlyArray<TargetId>;
  readonly orderBy?: OrderBy;
  /** Per-rule (per task type) timeout; wins over the target and policy timeouts. */
  readonly timeoutMs?: Milliseconds;
}

export interface RoutingPolicy {
  readonly id: PolicyId;
  readonly version: number;
  readonly defaultTimeoutMs: Milliseconds;
  readonly targets: ReadonlyArray<ModelTarget>;
  readonly rules: ReadonlyArray<RoutingRule>;
  readonly default: { readonly route: ReadonlyArray<TargetId> };
}

/** Unbranded input: the shape the policy schema produces, before domain validation. */
export interface ModelTargetInput {
  readonly id: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly region: string;
  readonly residency: Residency;
  readonly pricing: { readonly inputUsdPerMillion: number; readonly outputUsdPerMillion: number };
  readonly timeoutMs?: number;
}

export interface RoutingRuleInput {
  readonly id: string;
  readonly when: RuleCondition;
  readonly route: ReadonlyArray<string>;
  readonly orderBy?: OrderBy;
  readonly timeoutMs?: number;
}

export interface RoutingPolicyInput {
  readonly id: string;
  readonly version: number;
  readonly defaultTimeoutMs?: number;
  readonly targets: ReadonlyArray<ModelTargetInput>;
  readonly rules: ReadonlyArray<RoutingRuleInput>;
  readonly default: { readonly route: ReadonlyArray<string> };
}

type Issues = ErrorIssue[];

function addIssue(issues: Issues, path: string, message: string): void {
  issues.push({ path, message });
}

/** Keeps the value of a `Result`, or records its issues and returns `undefined`. */
function take<T>(issues: Issues, result: Result<T, ValidationError>): T | undefined {
  if (result.ok) return result.value;
  issues.push(...result.error.issues);
  return undefined;
}

function positiveTimeout(value: number, path: string, issues: Issues): Milliseconds | undefined {
  if (!Number.isInteger(value) || value <= 0) {
    addIssue(issues, path, "expected an integer greater than 0");
    return undefined;
  }
  return take(issues, milliseconds(value, path));
}

function validateTarget(
  input: ModelTargetInput,
  path: string,
  seen: Set<string>,
  issues: Issues,
): ModelTarget {
  if (seen.has(input.id)) {
    addIssue(issues, `${path}.id`, "expected a unique target id");
  } else {
    take(issues, targetId(input.id, `${path}.id`));
  }
  seen.add(input.id);
  if (input.model.trim() === "")
    addIssue(issues, `${path}.model`, "expected a non-empty model name");
  if (input.region.trim() === "") addIssue(issues, `${path}.region`, "expected a non-empty region");
  const pricingPath = `${path}.pricing`;
  take(issues, usd(input.pricing.inputUsdPerMillion, `${pricingPath}.inputUsdPerMillion`));
  take(issues, usd(input.pricing.outputUsdPerMillion, `${pricingPath}.outputUsdPerMillion`));
  if (input.timeoutMs !== undefined) positiveTimeout(input.timeoutMs, `${path}.timeoutMs`, issues);

  // Branding is safe here: the policy is only returned when no issue was recorded.
  const { timeoutMs, pricing, ...rest } = input;
  return {
    ...rest,
    id: input.id as TargetId,
    pricing: {
      inputUsdPerMillion: pricing.inputUsdPerMillion as Usd,
      outputUsdPerMillion: pricing.outputUsdPerMillion as Usd,
    },
    ...(timeoutMs === undefined ? {} : { timeoutMs: timeoutMs as Milliseconds }),
  };
}

function validateChain(
  route: ReadonlyArray<string>,
  path: string,
  declared: ReadonlySet<string>,
  issues: Issues,
): ReadonlyArray<TargetId> {
  if (route.length === 0) addIssue(issues, path, "expected at least one target id");
  const seen = new Set<string>();
  route.forEach((id, index) => {
    if (!declared.has(id)) {
      addIssue(issues, `${path}.${index}`, "expected the id of a declared target");
    } else if (seen.has(id)) {
      addIssue(issues, `${path}.${index}`, "expected each target at most once in a chain");
    }
    seen.add(id);
  });
  return route.map((id) => id as TargetId);
}

function validateCondition(when: RuleCondition, path: string, issues: Issues): RuleCondition {
  const copy: { -readonly [K in keyof RuleCondition]: RuleCondition[K] } = {};
  if (when.taskType !== undefined) {
    if (when.taskType.length === 0)
      addIssue(issues, `${path}.taskType`, "expected at least one task type");
    copy.taskType = [...when.taskType];
  }
  if (when.size !== undefined) {
    if (when.size.length === 0) addIssue(issues, `${path}.size`, "expected at least one task size");
    copy.size = [...when.size];
  }
  if (when.requestedModel !== undefined) {
    if (when.requestedModel.length === 0) {
      addIssue(issues, `${path}.requestedModel`, "expected at least one model name");
    }
    copy.requestedModel = [...when.requestedModel];
  }
  return copy;
}

function validateRule(
  input: RoutingRuleInput,
  path: string,
  seen: Set<string>,
  declared: ReadonlySet<string>,
  issues: Issues,
): RoutingRule {
  if (input.id === DEFAULT_RULE_ID) {
    addIssue(
      issues,
      `${path}.id`,
      `expected a rule id other than the reserved '${DEFAULT_RULE_ID}'`,
    );
  } else if (seen.has(input.id)) {
    addIssue(issues, `${path}.id`, "expected a unique rule id");
  } else {
    take(issues, ruleId(input.id, `${path}.id`));
  }
  seen.add(input.id);
  const when = validateCondition(input.when, `${path}.when`, issues);
  const route = validateChain(input.route, `${path}.route`, declared, issues);
  const timeoutMs =
    input.timeoutMs === undefined
      ? undefined
      : positiveTimeout(input.timeoutMs, `${path}.timeoutMs`, issues);
  return {
    id: input.id as RuleId,
    when,
    route,
    ...(input.orderBy === undefined ? {} : { orderBy: input.orderBy }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

/** Applies the cross-field rules of FR-004; every issue names its path, never the value. */
export function validatePolicy(input: RoutingPolicyInput): Result<RoutingPolicy, ValidationError> {
  const issues: Issues = [];
  take(issues, policyId(input.id, "id"));
  if (!Number.isInteger(input.version) || input.version < 1) {
    addIssue(issues, "version", "expected an integer greater than or equal to 1");
  }
  const defaultTimeoutMs = positiveTimeout(
    input.defaultTimeoutMs ?? DEFAULT_POLICY_TIMEOUT_MS,
    "defaultTimeoutMs",
    issues,
  );

  if (input.targets.length === 0) addIssue(issues, "targets", "expected at least one target");
  const targetIds = new Set<string>();
  const targets = input.targets.map((target, index) =>
    validateTarget(target, `targets.${index}`, targetIds, issues),
  );

  const ruleIds = new Set<string>();
  const rules = input.rules.map((rule, index) =>
    validateRule(rule, `rules.${index}`, ruleIds, targetIds, issues),
  );
  const defaultRoute = validateChain(input.default.route, "default.route", targetIds, issues);

  if (issues.length > 0 || defaultTimeoutMs === undefined) {
    return err(validationError("Invalid routing policy", issues));
  }
  return ok({
    id: input.id as PolicyId,
    version: input.version,
    defaultTimeoutMs,
    targets,
    rules,
    default: { route: defaultRoute },
  });
}

/**
 * Looks a target up by id. Total for a policy returned by {@link validatePolicy}; a
 * missing id means the policy was built by hand without validation, a programming error
 * that is not recoverable, so it throws instead of returning a `Result`.
 */
export function targetById(policy: RoutingPolicy, id: TargetId): ModelTarget {
  const target = policy.targets.find((candidate) => candidate.id === id);
  if (target === undefined) {
    throw new Error(`Invariant violated: target '${id}' is not declared in policy '${policy.id}'`);
  }
  return target;
}
