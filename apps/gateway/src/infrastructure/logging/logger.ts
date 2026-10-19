/**
 * Structured JSON logger with privacy redaction (spec FR-016, research R-10).
 *
 * One JSON object per line; `prompt`, `messages` and `authorization` are replaced by
 * {@link REDACTED} at the top level, under `req.headers` / `body`, and one level deep
 * under any key. pino's path syntax has no deep wildcard, so the covered depths are
 * exactly this list (constitution V). The logger is created here and injected; it is
 * never a module-level global.
 */
import pino, { type DestinationStream, type Logger } from "pino";
import type { LogLevel } from "../config/env.js";

export const REDACTED = "[REDACTED]";

export const REDACT_PATHS: ReadonlyArray<string> = [
  "prompt",
  "messages",
  "authorization",
  "req.headers.authorization",
  "body.prompt",
  "body.messages",
  "*.prompt",
  "*.messages",
  "*.authorization",
];

export const SERVICE_NAME = "tamiz-gateway";

export interface LoggerOptions {
  readonly level: LogLevel;
  /** Where lines are written; defaults to stdout. Tests pass an in-memory stream. */
  readonly destination?: DestinationStream;
}

export type GatewayLogger = Logger;

export function createLogger(options: LoggerOptions): GatewayLogger {
  const pinoOptions: pino.LoggerOptions = {
    level: options.level,
    base: { service: SERVICE_NAME },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: { paths: [...REDACT_PATHS], censor: REDACTED },
  };
  return options.destination === undefined
    ? pino(pinoOptions)
    : pino(pinoOptions, options.destination);
}
