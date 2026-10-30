/**
 * The operator's declarative routing policy and its cross-field validation (spec 002
 * FR-003, FR-004, research R-02, data-model sections 2.3 and 3.4).
 *
 * The policy file's *shape* (types, enums, unknown keys) is checked by
 * `RoutingPolicySchema` in `@tamiz/contracts` at the edge (`T-002-05`); this module checks
 * what a schema cannot: unique ids, the reserved rule id, chains that reference declared
 * targets without repeats, and the domain's unit rules. In-memory policies built in
 * tests go through the same function, so `decide` can rely on a validated policy.
 *
 * Feature 003 adds resilience settings (defaults filled here) and residency statements on
 * rules and the default chain; a chain entry outside its own statement is rejected
 * (spec 003 FR-012, FR-014, FR-020, research R-06, R-14).
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

/** How a request's execution is bounded and retried (spec 003 FR-002, FR-004, FR-007). */
export interface ResilienceSettings {
  readonly requestDeadlineMs: Milliseconds;
  /** Attempts per target, including the first (1 … 5). */
  readonly maxAttempts: number;
  readonly backoff: { readonly baseDelayMs: Milliseconds; readonly maxDelayMs: Milliseconds };
  readonly circuitBreaker: { readonly failureThreshold: number; readonly cooldownMs: Milliseconds };
}

/** Used for every field the policy file omits (spec 003 Assumptions, research R-14). */
export const DEFAULT_RESILIENCE: ResilienceSettings = {
  requestDeadlineMs: 60_000 as Milliseconds,
  maxAttempts: 2,
  backoff: { baseDelayMs: 250 as Milliseconds, maxDelayMs: 2_000 as Milliseconds },
  circuitBreaker: { failureThreshold: 5, cooldownMs: 30_000 as Milliseconds },
};

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
  /** Where this rule's requests may be processed; absent = everywhere (spec 003 FR-012). */
  readonly residency?: ReadonlyArray<Residency>;
}

export interface RoutingPolicy {
  readonly id: PolicyId;
  readonly version: number;
  readonly defaultTimeoutMs: Milliseconds;
  readonly targets: ReadonlyArray<ModelTarget>;
  readonly rules: ReadonlyArray<RoutingRule>;
  readonly default: {
    readonly route: ReadonlyArray<TargetId>;
    readonly residency?: ReadonlyArray<Residency>;
  };
  readonly resilience: ResilienceSettings;
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
  readonly residency?: ReadonlyArray<Residency>;
}

/** Every field optional; `validatePolicy` fills `DEFAULT_RESILIENCE`. */
export interface ResilienceSettingsInput {
  readonly requestDeadlineMs?: number;
  readonly maxAttempts?: number;
  readonly backoff?: { readonly baseDelayMs?: number; readonly maxDelayMs?: number };
  readonly circuitBreaker?: { readonly failureThreshold?: number; readonly cooldownMs?: number };
}

export interface RoutingPolicyInput {
  readonly id: string;
  readonly version: number;
  readonly defaultTimeoutMs?: number;
  readonly targets: ReadonlyArray<ModelTargetInput>;
  readonly rules: ReadonlyArray<RoutingRuleInput>;
  readonly default: {
    readonly route: ReadonlyArray<string>;
    readonly residency?: ReadonlyArray<Residency>;
  };
  readonly resilience?: ResilienceSettingsInput;
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

/** Declared target id → its residency. */
type Declared = ReadonlyMap<string, Residency>;

function validateChain(
  route: ReadonlyArray<string>,
  path: string,
  declared: Declared,
  issues: Issues,
  residency?: ReadonlyArray<Residency>,
): ReadonlyArray<TargetId> {
  if (route.length === 0) addIssue(issues, path, "expected at least one target id");
  const seen = new Set<string>();
  route.forEach((id, index) => {
    const targetResidency = declared.get(id);
    if (targetResidency === undefined) {
      addIssue(issues, `${path}.${index}`, "expected the id of a declared target");
    } else if (seen.has(id)) {
      addIssue(issues, `${path}.${index}`, "expected each target at most once in a chain");
    } else if (residency !== undefined && !residency.includes(targetResidency)) {
      // The residency is policy data, not request data, so naming it leaks nothing.
      addIssue(
        issues,
        `${path}.${index}`,
        `expected a target whose residency is in the rule's residency list (target residency "${targetResidency}")`,
      );
    }
    seen.add(id);
  });
  return route.map((id) => id as TargetId);
}

function validateResidencyList(
  list: ReadonlyArray<Residency> | undefined,
  path: string,
  issues: Issues,
): ReadonlyArray<Residency> | undefined {
  if (list === undefined) return undefined;
  if (list.length === 0) addIssue(issues, path, "expected at least one residency");
  list.forEach((residency, index) => {
    if (list.indexOf(residency) !== index) {
      addIssue(issues, `${path}.${index}`, "expected each residency at most once");
    }
  });
  return [...list];
}

/** The value, or `fallback` when absent; records an issue when outside `[min, max]`. */
function integerSetting(
  value: number | undefined,
  fallback: number,
  path: string,
  issues: Issues,
  min: number,
  max = Number.POSITIVE_INFINITY,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    const range = Number.isFinite(max)
      ? `between ${min} and ${max}`
      : `greater than or equal to ${min}`;
    addIssue(issues, path, `expected an integer ${range}`);
  }
  return value;
}

function validateResilience(
  input: ResilienceSettingsInput | undefined,
  issues: Issues,
): ResilienceSettings {
  const d = DEFAULT_RESILIENCE;
  const at = (name: string) => `resilience.${name}`;
  const baseDelayMs = integerSetting(
    input?.backoff?.baseDelayMs,
    d.backoff.baseDelayMs,
    at("backoff.baseDelayMs"),
    issues,
    1,
  );
  const maxDelayMs = integerSetting(
    input?.backoff?.maxDelayMs,
    d.backoff.maxDelayMs,
    at("backoff.maxDelayMs"),
    issues,
    1,
  );
  if (maxDelayMs < baseDelayMs) {
    addIssue(issues, at("backoff.maxDelayMs"), "expected at least baseDelayMs");
  }
  const breaker = input?.circuitBreaker;
  // Branding is safe: the policy is only returned when no issue was recorded.
  return {
    requestDeadlineMs: integerSetting(
      input?.requestDeadlineMs,
      d.requestDeadlineMs,
      at("requestDeadlineMs"),
      issues,
      1_000,
    ) as Milliseconds,
    maxAttempts: integerSetting(input?.maxAttempts, d.maxAttempts, at("maxAttempts"), issues, 1, 5),
    backoff: { baseDelayMs: baseDelayMs as Milliseconds, maxDelayMs: maxDelayMs as Milliseconds },
    circuitBreaker: {
      failureThreshold: integerSetting(
        breaker?.failureThreshold,
        d.circuitBreaker.failureThreshold,
        at("circuitBreaker.failureThreshold"),
        issues,
        1,
      ),
      cooldownMs: integerSetting(
        breaker?.cooldownMs,
        d.circuitBreaker.cooldownMs,
        at("circuitBreaker.cooldownMs"),
        issues,
        1_000,
      ) as Milliseconds,
    },
  };
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
  declared: Declared,
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
  const residency = validateResidencyList(input.residency, `${path}.residency`, issues);
  const route = validateChain(input.route, `${path}.route`, declared, issues, residency);
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
    ...(residency === undefined ? {} : { residency }),
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

  const declared: Declared = new Map(
    input.targets.map((target) => [target.id, target.residency] as const),
  );

  const ruleIds = new Set<string>();
  const rules = input.rules.map((rule, index) =>
    validateRule(rule, `rules.${index}`, ruleIds, declared, issues),
  );
  const defaultResidency = validateResidencyList(
    input.default.residency,
    "default.residency",
    issues,
  );
  const defaultRoute = validateChain(
    input.default.route,
    "default.route",
    declared,
    issues,
    defaultResidency,
  );
  const resilience = validateResilience(input.resilience, issues);

  if (issues.length > 0 || defaultTimeoutMs === undefined) {
    return err(validationError("Invalid routing policy", issues));
  }
  return ok({
    id: input.id as PolicyId,
    version: input.version,
    defaultTimeoutMs,
    targets,
    rules,
    default: {
      route: defaultRoute,
      ...(defaultResidency === undefined ? {} : { residency: defaultResidency }),
    },
    resilience,
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
