/**
 * Error envelope returned by every failing gateway response
 * (spec FR-010, data-model section 5).
 *
 * `message` is human-readable and never carries a stack trace or prompt content.
 * Feature 002 adds `provider_timeout` (504, spec 002 FR-028); feature 003 adds
 * `provider_unavailable` (503, every circuit open, spec 003 FR-019).
 */
import { z } from "zod";
import { RequestIdSchema } from "./branded.js";

export const ErrorTypeSchema = z.enum([
  "invalid_request",
  "unauthorized",
  "not_found",
  "rate_limited",
  "provider_error",
  "policy_blocked",
  "internal",
  "provider_timeout",
  "provider_unavailable",
]);

export const ErrorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    type: ErrorTypeSchema,
    message: z.string(),
    requestId: RequestIdSchema.optional(),
  }),
});

export type ErrorType = z.infer<typeof ErrorTypeSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/** HTTP status the gateway answers with for each error type. */
export const errorTypeToHttpStatus: Readonly<Record<ErrorType, number>> = Object.freeze({
  invalid_request: 400,
  unauthorized: 401,
  not_found: 404,
  rate_limited: 429,
  policy_blocked: 451,
  provider_error: 502,
  internal: 500,
  provider_timeout: 504,
  provider_unavailable: 503,
});
