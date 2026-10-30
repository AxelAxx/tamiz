/**
 * `DomainError`: the closed set of typed failures the domain and the use cases return
 * inside a `Result` (spec FR-014, data-model section 6).
 *
 * The union is discriminated on `kind` so a `switch` over it can be checked for
 * exhaustiveness by the compiler (see {@link assertNever}). Mapping a `DomainError` to an
 * HTTP error envelope lives in `presentation/mappers`, never here.
 *
 * Feature 002 adds `provider` and `unauthorized` (spec 002 FR-013, data-model 3.7).
 */
import type { Milliseconds, TargetId } from "./model/brands.js";
import type { ProviderName } from "./model/model-target.js";

/** One offending field or setting: where it is and what was expected. Never the value. */
export interface ErrorIssue {
  readonly path: string;
  readonly message: string;
}

/** Input failed a rule. */
export interface ValidationError {
  readonly kind: "validation";
  readonly message: string;
  readonly issues: ReadonlyArray<ErrorIssue>;
}

/** Environment or policy configuration is invalid. */
export interface ConfigurationError {
  readonly kind: "configuration";
  readonly message: string;
  readonly issues: ReadonlyArray<ErrorIssue>;
}

/** A named thing does not exist. */
export interface NotFoundError {
  readonly kind: "not_found";
  readonly message: string;
  readonly resource: string;
}

/** Why a provider call failed; adapters map upstream failures onto this list (FR-015). */
export const PROVIDER_ERROR_CAUSES = [
  "http_error",
  "timeout",
  "network",
  "malformed_response",
  "rate_limited",
  "authentication",
  // Spec 003 research R-03: the request deadline or a client disconnect ended the call.
  // Never retried, never counted by the circuit breaker, never a fallback reason.
  "aborted",
] as const;
export type ProviderErrorCause = (typeof PROVIDER_ERROR_CAUSES)[number];

/**
 * A provider call failed. Never carries the credential, the request messages or the raw
 * upstream body (FR-017); `status` is the upstream HTTP status when there was one.
 */
export interface ProviderError {
  readonly kind: "provider";
  readonly targetId: TargetId;
  readonly provider: ProviderName;
  readonly cause: ProviderErrorCause;
  readonly retryable: boolean;
  readonly message: string;
  readonly status?: number;
  /** An upstream `retry-after` hint (spec 003 FR-004); a lower bound for the next wait. */
  readonly retryAfterMs?: Milliseconds;
}

/** The caller is not authenticated. */
export interface UnauthorizedError {
  readonly kind: "unauthorized";
  readonly message: string;
}

export type DomainError =
  | ValidationError
  | ConfigurationError
  | NotFoundError
  | ProviderError
  | UnauthorizedError;

export function validationError(
  message: string,
  issues: ReadonlyArray<ErrorIssue>,
): ValidationError {
  return { kind: "validation", message, issues };
}

export function configurationError(
  message: string,
  issues: ReadonlyArray<ErrorIssue>,
): ConfigurationError {
  return { kind: "configuration", message, issues };
}

export function notFoundError(message: string, resource: string): NotFoundError {
  return { kind: "not_found", message, resource };
}

export function providerError(fields: Omit<ProviderError, "kind">): ProviderError {
  return { kind: "provider", ...fields };
}

export function unauthorizedError(message: string): UnauthorizedError {
  return { kind: "unauthorized", message };
}

/**
 * Exhaustiveness helper for `switch (error.kind)`: the `default` branch calls it with the
 * narrowed-to-`never` value, so adding a variant without handling it is a compile error.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${String(value)}`);
}
