/**
 * `DomainError`: the closed set of typed failures the domain and the use cases return
 * inside a `Result` (spec FR-014, data-model section 6).
 *
 * The union is discriminated on `kind` so a `switch` over it can be checked for
 * exhaustiveness by the compiler (see {@link assertNever}). Mapping a `DomainError` to an
 * HTTP error envelope lives in `presentation/mappers`, never here.
 */

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

export type DomainError = ValidationError | ConfigurationError | NotFoundError;

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

/**
 * Exhaustiveness helper for `switch (error.kind)`: the `default` branch calls it with the
 * narrowed-to-`never` value, so adding a variant without handling it is a compile error.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${String(value)}`);
}
