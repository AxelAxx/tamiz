/**
 * Zod mirror of the privacy service's contract (`services/privacy/openapi.json`; spec 005
 * FR-007, FR-010, research R-03, data-model section 1.1).
 *
 * The Python service owns the contract (constitution II); these schemas are what the
 * gateway checks its answers against. A drift test in the gateway compares them with the
 * committed OpenAPI document. Responses are parsed with `z.object` (unknown fields are
 * ignored, so the service can add fields); requests are strict.
 */
import { z } from "zod";

export const PrivacyEntityKindSchema = z.enum([
  "DNI",
  "NIE",
  "CIF",
  "IBAN",
  "NSS",
  "PHONE",
  "EMAIL",
  "CREDIT_CARD",
  "PERSON",
  "LOCATION",
]);

export const PrivacySensitivitySchema = z.enum(["none", "low", "high", "critical"]);

export const PrivacyAnalyzeRequestSchema = z.strictObject({
  text: z.string(),
  language: z.literal("es").optional(),
  min_score: z.number().min(0).max(1).nullable().optional(),
  entities: z.array(PrivacyEntityKindSchema).min(1).nullable().optional(),
});

/** Offsets are Unicode code points into the analyzed text; `end` is exclusive. */
export const PrivacyFindingSchema = z.object({
  kind: PrivacyEntityKindSchema,
  start: z.int().min(0),
  end: z.int().positive(),
  score: z.number().min(0).max(1),
});

export const PrivacyAnalyzeResponseSchema = z.object({
  findings: z.array(PrivacyFindingSchema),
  counts: z.partialRecord(PrivacyEntityKindSchema, z.int().min(0)),
  sensitivity_level: PrivacySensitivitySchema,
});

export const PrivacyErrorEnvelopeSchema = z.object({
  error: z.object({
    type: z.string(),
    message: z.string(),
    field: z.string().nullable().optional(),
  }),
});

export type PrivacyEntityKindDto = z.infer<typeof PrivacyEntityKindSchema>;
export type PrivacySensitivityDto = z.infer<typeof PrivacySensitivitySchema>;
export type PrivacyAnalyzeRequestDto = z.infer<typeof PrivacyAnalyzeRequestSchema>;
export type PrivacyFindingDto = z.infer<typeof PrivacyFindingSchema>;
export type PrivacyAnalyzeResponseDto = z.infer<typeof PrivacyAnalyzeResponseSchema>;
