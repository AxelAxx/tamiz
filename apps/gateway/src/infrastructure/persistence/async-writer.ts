/**
 * Asynchronous audit writer (spec 006 FR-004, US1-6, research R-02).
 *
 * `append` only queues: a request never waits for the database. Every `intervalMs`
 * (through the clock port) the queue is written in batches of up to `batchSize`. A failed
 * batch is retried once, then dropped; a full queue drops its oldest entry. Every loss is
 * an `audit.dropped` routing event and a `warn` line with the error code, never silent.
 * `close` flushes what is left (called on shutdown).
 */
import type { AuditLogPort } from "../../application/ports/audit-log.port.js";
import type { ClockPort } from "../../application/ports/clock.port.js";
import type { LoggerPort } from "../../application/ports/logger.port.js";
import type { RoutingEventsPort } from "../../application/ports/routing-events.port.js";
import type { AuditEntry } from "../../domain/model/audit-entry.js";
import type { Milliseconds } from "../../domain/model/units.js";
import type { AuditStore } from "./audit-log-repository.js";

export interface AsyncAuditWriterOptions {
  readonly store: AuditStore;
  readonly clock: ClockPort;
  readonly events: RoutingEventsPort;
  readonly logger?: LoggerPort;
  readonly maxQueue?: number;
  readonly batchSize?: number;
  readonly intervalMs?: number;
}

export interface AsyncAuditWriter extends AuditLogPort {
  /** Writes everything queued now. */
  flush(): Promise<void>;
  /** Stops the timer and flushes. */
  close(): Promise<void>;
  pending(): number;
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "unknown";
}

export function createAsyncAuditWriter(options: AsyncAuditWriterOptions): AsyncAuditWriter {
  const maxQueue = options.maxQueue ?? 10_000;
  const batchSize = options.batchSize ?? 100;
  const intervalMs = (options.intervalMs ?? 250) as Milliseconds;
  const queue: AuditEntry[] = [];
  const stop = new AbortController();
  let running: Promise<void> = Promise.resolve();

  const dropped = (count: number, reason: "queue_full" | "store_error", code?: string) => {
    options.events.emit({
      type: "audit.dropped",
      count,
      reason,
      at: options.clock.now().toISOString(),
    });
    options.logger?.warn(
      { count, reason, ...(code === undefined ? {} : { code }) },
      "audit entries dropped",
    );
  };

  async function writeAll(): Promise<void> {
    while (queue.length > 0) {
      const batch = queue.splice(0, batchSize);
      try {
        await options.store.insertBatch(batch);
      } catch {
        try {
          await options.store.insertBatch(batch);
        } catch (error) {
          dropped(batch.length, "store_error", errorCode(error));
        }
      }
    }
  }

  // Flushes never overlap: each one runs after the previous.
  const flush = (): Promise<void> => {
    running = running.then(writeAll, writeAll);
    return running;
  };

  void (async () => {
    while (!stop.signal.aborted) {
      try {
        await options.clock.sleep(intervalMs, stop.signal);
      } catch {
        return;
      }
      await flush();
    }
  })();

  return {
    append(entry) {
      if (queue.length >= maxQueue) {
        queue.shift();
        dropped(1, "queue_full");
      }
      queue.push(entry);
    },
    flush,
    async close() {
      stop.abort();
      await flush();
    },
    pending: () => queue.length,
  };
}
