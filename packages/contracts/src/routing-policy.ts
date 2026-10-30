/**
 * The routing policy file's shape (spec 002 FR-019, research R-02, data-model section 2.3).
 *
 * This schema checks shape, enums, ranges and unknown keys, so the gateway and the
 * dashboard's policy editor (feature 008) validate the same thing. Cross-field rules
 * (unique ids, chains that name declared targets, the reserved rule id `default`) belong
 * to the gateway domain's `validatePolicy`. The closed lists mirror the domain's tuples
 * (research R-03).
 */
import { z } from "zod";
import { PolicyIdSchema, UsdSchema } from "./branded.js";

export const ProviderNameSchema = z.enum(["ollama", "mistral", "anthropic", "openai"]);
export const ResidencySchema = z.enum(["local", "eu", "us", "global"]);
export const TaskTypeSchema = z.enum([
  "chat",
  "summarize",
  "extract",
  "classify",
  "code",
  "translate",
]);
export const TaskSizeSchema = z.enum(["short", "medium", "long"]);

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SLUG_MESSAGE = "must be 1 to 64 lower-case letters, digits or '-', not starting with '-'";

export const TargetIdSchema = z.string().regex(SLUG_PATTERN, SLUG_MESSAGE);
export const RuleIdSchema = z.string().regex(SLUG_PATTERN, SLUG_MESSAGE);

const TimeoutMsSchema = z.int().positive();

export const PricingSchema = z.strictObject({
  inputUsdPerMillion: UsdSchema,
  outputUsdPerMillion: UsdSchema,
});

export const ModelTargetSchema = z.strictObject({
  id: TargetIdSchema,
  provider: ProviderNameSchema,
  model: z.string().min(1),
  region: z.string().min(1),
  residency: ResidencySchema,
  pricing: PricingSchema,
  timeoutMs: TimeoutMsSchema.optional(),
});

/** Each present list must contain the request's value; `{}` matches every request. */
export const RuleConditionSchema = z.strictObject({
  taskType: z.array(TaskTypeSchema).min(1).optional(),
  size: z.array(TaskSizeSchema).min(1).optional(),
  requestedModel: z.array(z.string().min(1)).min(1).optional(),
});

export const RoutingRuleSchema = z.strictObject({
  id: RuleIdSchema,
  when: RuleConditionSchema,
  route: z.array(TargetIdSchema).min(1),
  orderBy: z.literal("cost").optional(),
  timeoutMs: TimeoutMsSchema.optional(),
});

export const RoutingPolicySchema = z.strictObject({
  id: PolicyIdSchema,
  version: z.int().min(1),
  defaultTimeoutMs: TimeoutMsSchema.default(30_000),
  targets: z.array(ModelTargetSchema).min(1),
  rules: z.array(RoutingRuleSchema),
  default: z.strictObject({ route: z.array(TargetIdSchema).min(1) }),
});

export type ProviderNameDto = z.infer<typeof ProviderNameSchema>;
export type ResidencyDto = z.infer<typeof ResidencySchema>;
export type TaskTypeDto = z.infer<typeof TaskTypeSchema>;
export type TaskSizeDto = z.infer<typeof TaskSizeSchema>;
export type ModelTargetDto = z.infer<typeof ModelTargetSchema>;
export type RuleConditionDto = z.infer<typeof RuleConditionSchema>;
export type RoutingRuleDto = z.infer<typeof RoutingRuleSchema>;
/** The validated policy file; `defaultTimeoutMs` is always present after parsing. */
export type RoutingPolicyDto = z.infer<typeof RoutingPolicySchema>;
