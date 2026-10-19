import type { LoggerPort } from "../../src/application/ports/logger.port.js";

const noop = (): void => {};

/** A logger that discards everything; for tests that do not assert on log output. */
export const noopLogger: LoggerPort = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

/** A logger that records every call so a test can assert on what was logged. */
export function recordingLogger(): {
  readonly logger: LoggerPort;
  readonly entries: ReadonlyArray<{
    level: "debug" | "info" | "warn" | "error";
    bindings: Readonly<Record<string, unknown>>;
    message: string;
  }>;
} {
  const entries: Array<{
    level: "debug" | "info" | "warn" | "error";
    bindings: Readonly<Record<string, unknown>>;
    message: string;
  }> = [];
  const record =
    (level: "debug" | "info" | "warn" | "error") =>
    (bindings: Readonly<Record<string, unknown>>, message: string): void => {
      entries.push({ level, bindings, message });
    };
  return {
    logger: {
      debug: record("debug"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
    },
    entries,
  };
}
