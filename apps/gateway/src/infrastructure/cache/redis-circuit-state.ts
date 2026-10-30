/**
 * `CircuitStatePort` over Redis/Valkey, shared between gateway instances (spec 003 FR-029 …
 * FR-031, US7, research R-04, R-11).
 *
 * Keys per target, under a prefix: `failures` (`INCR`), `open` (the open-until time, set
 * with `PX` = cool-down so it expires by itself), `pending` (the half-open trial is due)
 * and `trial` (`SET NX PX` = lease, so exactly one instance gets the trial).
 *
 * When the store is unreachable the state falls back to process memory: requests never
 * fail because of the store, and each switch between shared and local mode is logged
 * once, with an error code but never the store's address (FR-030).
 */
import { Redis } from "ioredis";
import type { CircuitStatePort } from "../../application/ports/circuit-state.port.js";
import type { ClockPort } from "../../application/ports/clock.port.js";
import type { LoggerPort } from "../../application/ports/logger.port.js";
import type { CircuitSnapshot } from "../../domain/model/circuit.js";
import type { TargetId } from "../../domain/model/units.js";
import { createInMemoryCircuitState } from "./in-memory-circuit-state.js";

const DEFAULT_PREFIX = "tamiz:circuit:";

/** The port's operations as Redis commands; failures propagate to the caller. */
export function createRedisStore(redis: Redis, clock: ClockPort, prefix: string): CircuitStatePort {
  const key = (targetId: TargetId, part: "failures" | "open" | "pending" | "trial") =>
    `${prefix}${targetId}:${part}`;

  return {
    async snapshot(targetId): Promise<CircuitSnapshot> {
      const [failures, openUntil, pending] = await redis.mget(
        key(targetId, "failures"),
        key(targetId, "open"),
        key(targetId, "pending"),
      );
      return {
        failures: failures === null || failures === undefined ? 0 : Number(failures),
        ...(openUntil === null || openUntil === undefined ? {} : { openUntil: Number(openUntil) }),
        trialPending: pending === "1",
      };
    },
    recordFailure: (targetId) => redis.incr(key(targetId, "failures")),
    async recordSuccess(targetId) {
      await redis.del(
        key(targetId, "failures"),
        key(targetId, "open"),
        key(targetId, "pending"),
        key(targetId, "trial"),
      );
    },
    async open(targetId, cooldownMs) {
      const results = await redis
        .multi()
        .set(key(targetId, "open"), String(clock.now().getTime() + cooldownMs), "PX", cooldownMs)
        .set(key(targetId, "pending"), "1")
        .del(key(targetId, "failures"), key(targetId, "trial"))
        .exec();
      const failed = results?.find(([error]) => error !== null);
      if (results === null || failed !== undefined) throw new Error("circuit open was not applied");
    },
    async tryAcquireTrial(targetId, leaseMs) {
      return (await redis.set(key(targetId, "trial"), "1", "PX", leaseMs, "NX")) === "OK";
    },
  };
}

export interface FallbackCircuitState extends CircuitStatePort {
  /** Called on store connection events; logs once per switch between modes. */
  setAvailable(available: boolean, reason?: string): void;
}

/**
 * Uses `primary` while it is available and `local` otherwise. An operation that fails
 * against `primary` is answered by `local`; the mode itself follows connection events.
 * Starts local until the first connection.
 */
export function withLocalFallback(
  primary: CircuitStatePort,
  local: CircuitStatePort,
  logger: LoggerPort,
): FallbackCircuitState {
  let shared = false;
  let everConnected = false;
  let warnedUnreachable = false;

  function setAvailable(available: boolean, reason?: string): void {
    const fields = reason === undefined ? {} : { reason };
    if (available) {
      if (shared) return;
      shared = true;
      if (!everConnected) {
        everConnected = true;
        logger.info({}, "circuit state shared through the key-value store");
      } else {
        logger.warn({}, "circuit state store reachable again: using shared state");
      }
      return;
    }
    if (shared) {
      shared = false;
      logger.warn(fields, "circuit state store unreachable: using in-memory state");
    } else if (!everConnected && !warnedUnreachable) {
      warnedUnreachable = true;
      logger.warn(fields, "circuit state store unreachable: using in-memory state");
    }
  }

  const either =
    <A extends unknown[], R>(pick: (port: CircuitStatePort) => (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      if (!shared) return pick(local)(...args);
      try {
        return await pick(primary)(...args);
      } catch {
        return pick(local)(...args);
      }
    };

  return {
    setAvailable,
    snapshot: either((port) => port.snapshot),
    recordFailure: either((port) => port.recordFailure),
    recordSuccess: either((port) => port.recordSuccess),
    open: either((port) => port.open),
    tryAcquireTrial: either((port) => port.tryAcquireTrial),
  };
}

export interface RedisCircuitStateOptions {
  /** `redis://` or `rediss://`; never logged. */
  readonly url: string;
  readonly clock: ClockPort;
  readonly logger: LoggerPort;
  readonly keyPrefix?: string;
}

export interface RedisCircuitState extends CircuitStatePort {
  close(): Promise<void>;
}

/** A short, address-free reason for a connection error (`ECONNREFUSED`, …). */
function reasonOf(error: unknown): string {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : "connection error";
}

export async function createRedisCircuitState(
  options: RedisCircuitStateOptions,
): Promise<RedisCircuitState> {
  const redis = new Redis(options.url, {
    lazyConnect: true,
    // Fail fast instead of queueing: the in-memory fallback answers meanwhile.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    commandTimeout: 1_000,
    retryStrategy: (times) => Math.min(times * 500, 5_000),
  });
  const state = withLocalFallback(
    createRedisStore(redis, options.clock, options.keyPrefix ?? DEFAULT_PREFIX),
    createInMemoryCircuitState(options.clock),
    options.logger,
  );
  redis.on("ready", () => state.setAvailable(true));
  redis.on("error", (error: unknown) => state.setAvailable(false, reasonOf(error)));
  redis.on("close", () => state.setAvailable(false, "connection closed"));
  try {
    await redis.connect();
  } catch {
    // Already reported through the "error" event; ioredis keeps reconnecting.
  }
  return {
    snapshot: state.snapshot,
    recordFailure: state.recordFailure,
    recordSuccess: state.recordSuccess,
    open: state.open,
    tryAcquireTrial: state.tryAcquireTrial,
    close: async () => {
      redis.disconnect();
    },
  };
}
