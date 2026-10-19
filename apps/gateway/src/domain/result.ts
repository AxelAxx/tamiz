/**
 * `Result<T, E>`: how the domain and the use cases express success or typed failure
 * without exceptions (constitution VI, spec FR-014, data-model section 6).
 *
 * Pure functions only; no classes, no throwing. Exceptions are reserved for the edges
 * (presentation and infrastructure adapters).
 */

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

/** Wraps a value as a success. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Wraps an error as a failure. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Narrows a result to its success branch. */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/** Narrows a result to its failure branch. */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Applies `fn` to the value of a success; a failure passes through unchanged. */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Applies `fn` to the error of a failure; a success passes through unchanged. */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/** Chains a function that itself returns a `Result`; the first failure short-circuits. */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/** Returns the value of a success or `fallback` for a failure. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
