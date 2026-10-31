/**
 * `POST /v1/simulate`: what the gateway would do with a chat completion request, without
 * calling any provider (spec 005 FR-018, FR-019, data-model section 1.3).
 *
 * The request is the chat completion body (`stream` is ignored). The response has the
 * inspection (kinds and positions, never values), the matched rule, the privacy action,
 * the chain and, for `anonymize`, exactly the messages a provider would receive.
 */
import { z } from "zod";
import { ChatMessageSchema } from "./chat-completion.js";
import { PrivacyEntityKindSchema } from "./privacy-service.js";
import {
  PrivacyActionSchema,
  ProviderNameSchema,
  ResidencySchema,
  TargetIdSchema,
  TaskSizeSchema,
  TaskTypeSchema,
} from "./routing-policy.js";

/** Where a piece of inspected text is (009 tool-calling FR-015, research T-R04). */
export const TextLocationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("content"), messageIndex: z.int().min(0) }),
  z.strictObject({
    kind: z.literal("arguments"),
    messageIndex: z.int().min(0),
    toolCallIndex: z.int().min(0),
  }),
  z.strictObject({ kind: z.literal("tool_definition"), toolIndex: z.int().min(0) }),
]);

export const SimulatedEntitySchema = z.strictObject({
  /** The message, for content and arguments locations; absent for tool definitions. */
  messageIndex: z.int().min(0).optional(),
  /** Always set by the gateway since the 009 tool-calling addendum (FR-015). */
  location: TextLocationSchema.optional(),
  kind: PrivacyEntityKindSchema,
  /** UTF-16 offsets into the located text; `end` is exclusive. */
  start: z.int().min(0),
  end: z.int().positive(),
  score: z.number().min(0).max(1),
});

export const SimulatedTargetSchema = z.strictObject({
  id: TargetIdSchema,
  provider: ProviderNameSchema,
  model: z.string(),
  residency: ResidencySchema,
});

export const SimulateResponseSchema = z
  .strictObject({
    sensitivity: z.enum(["unknown", "none", "low", "high", "critical"]),
    detector: z.enum(["ok", "unavailable", "timeout", "contract"]),
    entities: z.array(SimulatedEntitySchema),
    ruleId: z.string(),
    /** The classification the rule matched on (spec 007 FR-010: routing mismatches show it). */
    taskType: TaskTypeSchema,
    size: TaskSizeSchema,
    decision: z.enum(["route", "block"]),
    privacyAction: PrivacyActionSchema,
    /** Empty when blocked. */
    chain: z.array(SimulatedTargetSchema),
    allowedResidencies: z.array(ResidencySchema),
    blockReason: z.enum(["action", "no_target", "detector_unavailable"]).optional(),
    /** Only for `anonymize`: what the provider would receive (placeholders, notice). */
    providerMessages: z.array(ChatMessageSchema).optional(),
    notice: z.string().optional(),
    /** Set when anonymizing was not safe and the request was kept local (FR-011). */
    notAnonymizable: z.enum(["json_structure", "tool_definition"]).optional(),
  })
  .refine((body) => (body.decision === "block") === (body.blockReason !== undefined), {
    message: "blockReason is present exactly when the decision is block",
    path: ["blockReason"],
  });

export type SimulateResponse = z.infer<typeof SimulateResponseSchema>;
export type TextLocation = z.infer<typeof TextLocationSchema>;
