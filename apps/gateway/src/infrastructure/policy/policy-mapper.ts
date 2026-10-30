/**
 * Contract DTO → domain input for the routing policy (spec 002 research R-01, R-02; spec
 * 003 adds `residency` and `resilience`, research R-14; spec 005 adds `privacy`).
 *
 * The schema has already checked the shape; `validatePolicy` then applies the
 * cross-field rules, fills the resilience defaults and applies the brands. This mapper
 * only drops the optional fields Zod reports as `undefined`, which
 * `exactOptionalPropertyTypes` keeps apart from absent.
 */
import type {
  ModelTargetDto,
  PrivacySectionDto,
  ResilienceSettingsDto,
  RoutingPolicyDto,
  RoutingRuleDto,
} from "@tamiz/contracts";
import type {
  PrivacyLevelSettings,
  PrivacySettingsInput,
} from "../../domain/model/privacy-policy.js";
import type {
  ModelTargetInput,
  ResilienceSettingsInput,
  RoutingPolicyInput,
  RoutingRuleInput,
  RuleCondition,
} from "../../domain/model/routing-policy.js";

/** Copies the defined fields only. */
function defined<T extends Record<string, unknown>>(
  value: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

function toTargetInput(dto: ModelTargetDto): ModelTargetInput {
  const { timeoutMs, ...rest } = dto;
  return { ...rest, ...(timeoutMs !== undefined && { timeoutMs }) };
}

function toCondition(when: RoutingRuleDto["when"]): RuleCondition {
  return {
    ...(when.taskType !== undefined && { taskType: when.taskType }),
    ...(when.size !== undefined && { size: when.size }),
    ...(when.requestedModel !== undefined && { requestedModel: when.requestedModel }),
  };
}

function toRuleInput(dto: RoutingRuleDto): RoutingRuleInput {
  return {
    id: dto.id,
    when: toCondition(dto.when),
    route: dto.route,
    ...(dto.orderBy !== undefined && { orderBy: dto.orderBy }),
    ...(dto.timeoutMs !== undefined && { timeoutMs: dto.timeoutMs }),
    ...(dto.residency !== undefined && { residency: dto.residency }),
  };
}

function toResilienceInput(dto: ResilienceSettingsDto): ResilienceSettingsInput {
  const { backoff, circuitBreaker, ...top } = dto;
  return {
    ...defined(top),
    ...(backoff !== undefined && { backoff: defined(backoff) }),
    ...(circuitBreaker !== undefined && { circuitBreaker: defined(circuitBreaker) }),
  };
}

function toPrivacyLevel(dto: PrivacySectionDto["levels"]["none"]): PrivacyLevelSettings {
  return { action: dto.action, ...(dto.residency !== undefined && { residency: dto.residency }) };
}

function toPrivacyInput(dto: PrivacySectionDto): PrivacySettingsInput {
  return {
    onDetectorError: dto.onDetectorError,
    localRoute: dto.localRoute,
    levels: {
      none: toPrivacyLevel(dto.levels.none),
      low: toPrivacyLevel(dto.levels.low),
      high: toPrivacyLevel(dto.levels.high),
      critical: toPrivacyLevel(dto.levels.critical),
    },
  };
}

export function toDomainPolicyInput(dto: RoutingPolicyDto): RoutingPolicyInput {
  return {
    id: dto.id,
    version: dto.version,
    defaultTimeoutMs: dto.defaultTimeoutMs,
    targets: dto.targets.map(toTargetInput),
    rules: dto.rules.map(toRuleInput),
    default: {
      route: dto.default.route,
      ...(dto.default.residency !== undefined && { residency: dto.default.residency }),
    },
    ...(dto.resilience !== undefined && { resilience: toResilienceInput(dto.resilience) }),
    privacy: toPrivacyInput(dto.privacy),
  };
}
