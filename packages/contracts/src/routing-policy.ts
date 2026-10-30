/**
 * The routing policy file's shape (spec 002 FR-019, research R-02, data-model section 2.3).
 *
 * This schema checks shape, enums, ranges and unknown keys, so the gateway and the
 * dashboard's policy editor (feature 008) validate the same thing. Cross-field rules
 * (unique ids, chains that name declared targets, the reserved rule id `default`) belong
 * to the gateway domain's `validatePolicy`. The closed lists mirror the domain's tuples
 * (research R-03).
 *
 * Feature 005 adds the required `privacy` section (spec 005 FR-002): an action per
 * sensitivity level, the local route, and what a failed inspection does.
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

/** Where a rule's (or the default chain's) data may be processed (spec 003 FR-012). */
export const ResidencyListSchema = z
  .array(ResidencySchema)
  .min(1)
  .refine((list) => new Set(list).size === list.length, "expected each residency at most once");

/** Spec 003 FR-020, research R-14: every field optional; the gateway fills the defaults. */
export const ResilienceSettingsSchema = z.strictObject({
  requestDeadlineMs: z.int().min(1_000).optional(),
  maxAttempts: z.int().min(1).max(5).optional(),
  backoff: z
    .strictObject({
      baseDelayMs: z.int().min(1).optional(),
      maxDelayMs: z.int().min(1).optional(),
    })
    .optional(),
  circuitBreaker: z
    .strictObject({
      failureThreshold: z.int().min(1).optional(),
      cooldownMs: z.int().min(1_000).optional(),
    })
    .optional(),
});

export const SensitivityLevelSchema = z.enum(["none", "low", "high", "critical"]);
export const PrivacyActionSchema = z.enum(["allow", "anonymize", "restrict_to_local", "block"]);

/** What happens to requests of one sensitivity level (spec 005 FR-002, research R-11). */
export const PrivacyLevelSchema = z.strictObject({
  action: PrivacyActionSchema,
  residency: ResidencyListSchema.optional(),
});

export const PrivacySectionSchema = z.strictObject({
  /** A failed inspection never allows: the gateway fails closed. */
  onDetectorError: z.enum(["restrict_to_local", "block"]),
  localRoute: z.array(TargetIdSchema).min(1),
  levels: z.strictObject({
    none: PrivacyLevelSchema,
    low: PrivacyLevelSchema,
    high: PrivacyLevelSchema,
    critical: PrivacyLevelSchema,
  }),
});

export const RoutingRuleSchema = z.strictObject({
  id: RuleIdSchema,
  when: RuleConditionSchema,
  route: z.array(TargetIdSchema).min(1),
  orderBy: z.literal("cost").optional(),
  timeoutMs: TimeoutMsSchema.optional(),
  residency: ResidencyListSchema.optional(),
});

export const RoutingPolicySchema = z.strictObject({
  id: PolicyIdSchema,
  version: z.int().min(1),
  defaultTimeoutMs: TimeoutMsSchema.default(30_000),
  targets: z.array(ModelTargetSchema).min(1),
  rules: z.array(RoutingRuleSchema),
  default: z.strictObject({
    route: z.array(TargetIdSchema).min(1),
    residency: ResidencyListSchema.optional(),
  }),
  resilience: ResilienceSettingsSchema.optional(),
  privacy: PrivacySectionSchema,
});

export type ProviderNameDto = z.infer<typeof ProviderNameSchema>;
export type ResidencyDto = z.infer<typeof ResidencySchema>;
export type TaskTypeDto = z.infer<typeof TaskTypeSchema>;
export type TaskSizeDto = z.infer<typeof TaskSizeSchema>;
export type ModelTargetDto = z.infer<typeof ModelTargetSchema>;
export type RuleConditionDto = z.infer<typeof RuleConditionSchema>;
export type RoutingRuleDto = z.infer<typeof RoutingRuleSchema>;
export type ResilienceSettingsDto = z.infer<typeof ResilienceSettingsSchema>;
export type SensitivityLevelDto = z.infer<typeof SensitivityLevelSchema>;
export type PrivacyActionDto = z.infer<typeof PrivacyActionSchema>;
export type PrivacySectionDto = z.infer<typeof PrivacySectionSchema>;
/** The validated policy file; `defaultTimeoutMs` is always present after parsing. */
export type RoutingPolicyDto = z.infer<typeof RoutingPolicySchema>;
