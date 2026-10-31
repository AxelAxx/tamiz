/**
 * `Result<T, E>` for the server's expected failures (gateway errors, configuration), as in
 * the gateway's domain (constitution VI). The app imports no gateway code (research R-03),
 * so it keeps its own three-line copy.
 */

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
