/**
 * JSON logs on standard error (spec 009 FR-004, FR-005, research R-05).
 *
 * Standard output is the stdio transport's protocol channel, so the default destination is
 * file descriptor 2 for every transport. Keys and authorization headers are redacted; the
 * server never logs them on purpose, this is the second line of defence (SC-003).
 */
import pino, { type DestinationStream, type Logger as PinoLogger } from "pino";

export const SERVICE_NAME = "tamiz-mcp-server";

export const REDACT_PATHS: ReadonlyArray<string> = [
  "authorization",
  "key",
  "*.authorization",
  "*.key",
  "headers.authorization",
  "req.headers.authorization",
];

export type Logger = PinoLogger;

export interface LoggerOptions {
  readonly level: string;
  /** Defaults to standard error. Tests pass an in-memory stream. */
  readonly destination?: DestinationStream;
}

export function createLogger(options: LoggerOptions): Logger {
  return pino(
    {
      level: options.level,
      base: { service: SERVICE_NAME },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: [...REDACT_PATHS], censor: "[REDACTED]" },
    },
    // Synchronous, so the reason for an exit at start reaches stderr before the process ends.
    options.destination ?? pino.destination({ fd: 2, sync: true }),
  );
}
