import { randomUUID } from "node:crypto";
import { createFakeClock } from "@tamiz/test-utils";
import {
  GenericContainer,
  getContainerRuntimeClient,
  type StartedTestContainer,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { millisecondsUnchecked, targetIdUnchecked } from "../../src/domain/model/units.js";
import {
  createRedisCircuitState,
  type RedisCircuitState,
} from "../../src/infrastructure/cache/redis-circuit-state.js";
import { recordingLogger } from "../helpers/noop-logger.js";
import { describeCircuitStateContract } from "./circuit-state-contract.js";

// Spec 003 US7-1 … US7-3, FR-029, FR-030, SC-008 (tasks.md T055): the circuit state on
// Redis/Valkey. The store-backed cases need Docker (Testcontainers, `valkey/valkey:8`)
// and are reported as skipped, with the reason in their name, when it is unavailable;
// CI on ubuntu-latest has Docker. The unreachable-store case needs no Docker.

const A = targetIdUnchecked("target-a");

async function dockerAvailable(): Promise<boolean> {
  try {
    await getContainerRuntimeClient();
    return true;
  } catch {
    return false;
  }
}

const docker = await dockerAvailable();
const opened: RedisCircuitState[] = [];

async function open(url: string, clock = createFakeClock(), logger = recordingLogger().logger) {
  const state = await createRedisCircuitState({
    url,
    clock,
    logger,
    keyPrefix: `tamiz-test:${randomUUID()}:`,
  });
  opened.push(state);
  return state;
}

afterAll(async () => {
  await Promise.all(opened.map((state) => state.close()));
});

describe("createRedisCircuitState without a reachable store (US7-3)", () => {
  it("serves every operation from memory, warning once, and never throws", async () => {
    const { logger, entries } = recordingLogger();
    const state = await open("redis://127.0.0.1:9", createFakeClock(), logger);

    expect(await state.recordFailure(A)).toBe(1);
    await state.open(A, millisecondsUnchecked(30_000));
    expect((await state.snapshot(A)).trialPending).toBe(true);
    expect(await state.tryAcquireTrial(A, millisecondsUnchecked(1_000))).toBe(true);
    expect(entries.filter((entry) => entry.level === "warn")).toHaveLength(1);
  });
});

describe.skipIf(!docker)("createRedisCircuitState on Valkey (Testcontainers)", () => {
  let container: StartedTestContainer;
  let url: string;

  beforeAll(async () => {
    container = await new GenericContainer("valkey/valkey:8").withExposedPorts(6379).start();
    url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  describeCircuitStateContract("Redis circuit state", (clock) => open(url, clock), {
    realTime: true,
  });

  it("US7-1, SC-008: a circuit opened by one instance is open for another within 1 s", async () => {
    const prefix = `tamiz-test:${randomUUID()}:`;
    const clock = createFakeClock();
    const first = await createRedisCircuitState({
      url,
      clock,
      logger: recordingLogger().logger,
      keyPrefix: prefix,
    });
    const second = await createRedisCircuitState({
      url,
      clock,
      logger: recordingLogger().logger,
      keyPrefix: prefix,
    });
    opened.push(first, second);
    const started = Date.now();

    await first.open(A, millisecondsUnchecked(30_000));
    const seen = await second.snapshot(A);

    expect(seen.openUntil).toBe(clock.now().getTime() + 30_000);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("US7-2: the open state expires by itself after the cool-down, leaving the trial pending", async () => {
    const state = await open(url);

    await state.open(A, millisecondsUnchecked(300));
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(await state.snapshot(A)).toEqual({ failures: 0, trialPending: true });
  });

  it("FR-029: exactly one of two instances gets the half-open trial", async () => {
    const prefix = `tamiz-test:${randomUUID()}:`;
    const make = () =>
      createRedisCircuitState({
        url,
        clock: createFakeClock(),
        logger: recordingLogger().logger,
        keyPrefix: prefix,
      });
    const [first, second] = await Promise.all([make(), make()]);
    opened.push(first, second);
    await first.open(A, millisecondsUnchecked(1_000));

    const grants = await Promise.all([
      first.tryAcquireTrial(A, millisecondsUnchecked(5_000)),
      second.tryAcquireTrial(A, millisecondsUnchecked(5_000)),
    ]);

    expect(grants.filter(Boolean)).toHaveLength(1);
  });

  it("US7-3: when the store goes away, operations continue from memory with one warning", async () => {
    const own = await new GenericContainer("valkey/valkey:8").withExposedPorts(6379).start();
    const { logger, entries } = recordingLogger();
    const state = await open(
      `redis://${own.getHost()}:${own.getMappedPort(6379)}`,
      createFakeClock(),
      logger,
    );
    expect(await state.recordFailure(A)).toBe(1);

    await own.stop();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await state.recordFailure(A)).toBe(1);
    expect(entries.filter((entry) => entry.level === "warn")).toHaveLength(1);
  }, 120_000);
});

it.skipIf(docker)("Redis-backed cases skipped: Docker is not available on this machine", () => {});
