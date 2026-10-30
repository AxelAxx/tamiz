/**
 * Branded units and identifiers owned by the domain (spec 002 research R-01,
 * data-model section 3.1).
 *
 * The domain imports nothing, not even types from `@tamiz/contracts`, so it declares its
 * own brands. Their rules match the contract brands of feature 001 (and the policy
 * schema of feature 002) so that converting a value already validated at the edge never
 * fails. Validating constructors return a `Result`; the `*Unchecked` variants only brand
 * and are meant for mappers that hold a value the edge schema already checked.
 *
 * Issues name the offending path (default `value`) and what was expected, never the
 * value itself.
 */
import { type ValidationError, validationError } from "../errors.js";
import { err, ok, type Result } from "../result.js";
import type {
  ClientId,
  Milliseconds,
  PolicyId,
  RequestId,
  RuleId,
  TargetId,
  Usd,
} from "./brands.js";

// The brand types live in `brands.ts` (no imports) so `errors.ts` can use them without a
// cycle; they are re-exported here, the module the rest of the domain imports.
export type { ClientId, Milliseconds, PolicyId, RequestId, RuleId, TargetId, Usd };

/** Charset of the 001 `RequestId` / `PolicyId` contract brands. */
const EDGE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;
/** Target and rule ids as written by a policy author: lower-case slugs. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

function invalid(path: string, expected: string): Result<never, ValidationError> {
  return err(validationError(`Invalid ${path}`, [{ path, message: `expected ${expected}` }]));
}

function identifier<T extends string>(
  value: string,
  maxLength: number,
  path: string,
): Result<T, ValidationError> {
  if (value.length < 1 || value.length > maxLength || !EDGE_IDENTIFIER.test(value)) {
    return invalid(path, `1 to ${maxLength} letters, digits, '_' or '-'`);
  }
  return ok(value as T);
}

function slug<T extends string>(value: string, path: string): Result<T, ValidationError> {
  if (!SLUG.test(value)) {
    return invalid(path, "1 to 64 lower-case letters, digits or '-', not starting with '-'");
  }
  return ok(value as T);
}

/** Validates a cost or price in US dollars. */
export function usd(value: number, path = "value"): Result<Usd, ValidationError> {
  if (!Number.isFinite(value) || value < 0) {
    return invalid(path, "a finite number greater than or equal to 0");
  }
  return ok(value as Usd);
}

/** Validates a duration in whole milliseconds. */
export function milliseconds(value: number, path = "value"): Result<Milliseconds, ValidationError> {
  if (!Number.isInteger(value) || value < 0) {
    return invalid(path, "an integer greater than or equal to 0");
  }
  return ok(value as Milliseconds);
}

/** Validates a policy id (1 to 64 characters, 001 charset). */
export function policyId(value: string, path = "value"): Result<PolicyId, ValidationError> {
  return identifier<PolicyId>(value, 64, path);
}

/** Validates a target id (lower-case slug). */
export function targetId(value: string, path = "value"): Result<TargetId, ValidationError> {
  return slug<TargetId>(value, path);
}

/** Validates a rule id (lower-case slug). */
export function ruleId(value: string, path = "value"): Result<RuleId, ValidationError> {
  return slug<RuleId>(value, path);
}

/** Validates a request id (1 to 128 characters, 001 charset). */
export function requestId(value: string, path = "value"): Result<RequestId, ValidationError> {
  return identifier<RequestId>(value, 128, path);
}

/** Validates a client id (1 to 64 characters, 001 charset). */
export function clientId(value: string, path = "value"): Result<ClientId, ValidationError> {
  return identifier<ClientId>(value, 64, path);
}

/** Brands a value already validated at the edge. */
export function usdUnchecked(value: number): Usd {
  return value as Usd;
}

/** Brands a value already validated at the edge. */
export function millisecondsUnchecked(value: number): Milliseconds {
  return value as Milliseconds;
}

/** Brands a value already validated at the edge. */
export function policyIdUnchecked(value: string): PolicyId {
  return value as PolicyId;
}

/** Brands a value already validated at the edge. */
export function targetIdUnchecked(value: string): TargetId {
  return value as TargetId;
}

/** Brands a value already validated at the edge. */
export function ruleIdUnchecked(value: string): RuleId {
  return value as RuleId;
}

/** Brands a value already validated at the edge. */
export function requestIdUnchecked(value: string): RequestId {
  return value as RequestId;
}

/** Brands a value already validated at the edge. */
export function clientIdUnchecked(value: string): ClientId {
  return value as ClientId;
}
