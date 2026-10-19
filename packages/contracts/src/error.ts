/**
 * Error envelope returned by every failing gateway response
 * (spec FR-010, data-model section 5).
 *
 * `message` is human-readable and never carries a stack trace or prompt content.
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
});
