/**
 * Branded identifier and unit types (spec FR-011, research R-07, data-model section 1).
 *
 * Branding is static only: the runtime schema validates the primitive, and the brand
 * stops a `Usd` from being passed where `Milliseconds` is expected (or a raw `string`
 * where a `RequestId` is). Values are created through the constructors, which parse and
 * throw at the edge, or through the `safe*` variants, which return a Zod safe-parse
 * result for callers that prefer `Result`-style handling.
 */
import { z } from "zod";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]+$/;

export const RequestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(IDENTIFIER_PATTERN, "must contain only letters, digits, '_' or '-'")
  .brand<"RequestId">();

export const PolicyIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(IDENTIFIER_PATTERN, "must contain only letters, digits, '_' or '-'")
  .brand<"PolicyId">();

export const UsdSchema = z.number().finite().min(0).brand<"Usd">();

export const MillisecondsSchema = z.number().int().finite().min(0).brand<"Milliseconds">();

/** Correlates a request across headers, logs and audit entries. */
export type RequestId = z.infer<typeof RequestIdSchema>;
/** Identifies a routing policy document. */
export type PolicyId = z.infer<typeof PolicyIdSchema>;
/** A cost in US dollars; finite and never negative. */
export type Usd = z.infer<typeof UsdSchema>;
/** A duration in whole milliseconds; never negative. */
export type Milliseconds = z.infer<typeof MillisecondsSchema>;

/** Parses a request id; throws a `ZodError` on invalid input. */
export function requestId(value: string): RequestId {
  return RequestIdSchema.parse(value);
}

/** Parses a policy id; throws a `ZodError` on invalid input. */
export function policyId(value: string): PolicyId {
  return PolicyIdSchema.parse(value);
}

/** Parses a cost in US dollars; throws a `ZodError` on invalid input. */
export function usd(value: number): Usd {
  return UsdSchema.parse(value);
}

/** Parses a duration in milliseconds; throws a `ZodError` on invalid input. */
export function milliseconds(value: number): Milliseconds {
  return MillisecondsSchema.parse(value);
}

/** Non-throwing variant of {@link requestId}. */
export function safeRequestId(value: unknown): z.ZodSafeParseResult<RequestId> {
  return RequestIdSchema.safeParse(value);
}

/** Non-throwing variant of {@link policyId}. */
export function safePolicyId(value: unknown): z.ZodSafeParseResult<PolicyId> {
  return PolicyIdSchema.safeParse(value);
}

/** Non-throwing variant of {@link usd}. */
export function safeUsd(value: unknown): z.ZodSafeParseResult<Usd> {
  return UsdSchema.safeParse(value);
}

/** Non-throwing variant of {@link milliseconds}. */
export function safeMilliseconds(value: unknown): z.ZodSafeParseResult<Milliseconds> {
  return MillisecondsSchema.safeParse(value);
}
