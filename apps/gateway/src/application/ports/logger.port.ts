/**
 * The subset of a structured logger that the application and presentation layers use.
 *
 * Declared here so that `presentation/` can log without importing the pino adapter in
 * `infrastructure/logging/logger.ts` (only `main.ts` may import infrastructure). The pino
 * logger satisfies this shape structurally; tests pass a no-op or recording logger.
 *
 * Bindings are structured fields; never put prompt content in them. The adapter redacts
 * the agreed keys (`prompt`, `messages`, `authorization`) as a second line of defence.
 */
export type LogBindings = Readonly<Record<string, unknown>>;

export type LogFn = (bindings: LogBindings, message: string) => void;

export interface LoggerPort {
  readonly debug: LogFn;
  readonly info: LogFn;
  readonly warn: LogFn;
  readonly error: LogFn;
}
