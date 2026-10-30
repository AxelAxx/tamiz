/**
 * Contract DTO → domain input for the routing policy (spec 002 research R-01, R-02).
 *
 * The schema has already checked the shape; `validatePolicy` then applies the
 * cross-field rules and the brands. This mapper only drops the optional fields Zod
 * reports as `undefined`, which `exactOptionalPropertyTypes` keeps apart from absent.
 */
import type { ModelTargetDto, RoutingPolicyDto, RoutingRuleDto } from "@tamiz/contracts";
import type {
  ModelTargetInput,
  RoutingPolicyInput,
  RoutingRuleInput,
  RuleCondition,
} from "../../domain/model/routing-policy.js";

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
  };
}

export function toDomainPolicyInput(dto: RoutingPolicyDto): RoutingPolicyInput {
  return {
    id: dto.id,
    version: dto.version,
    defaultTimeoutMs: dto.defaultTimeoutMs,
    targets: dto.targets.map(toTargetInput),
    rules: dto.rules.map(toRuleInput),
    default: { route: dto.default.route },
  };
}
