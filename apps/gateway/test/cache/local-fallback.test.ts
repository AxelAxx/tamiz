import { createFakeClock } from "@tamiz/test-utils";
import { describe, expect, it } from "vitest";
import type { CircuitStatePort } from "../../src/application/ports/circuit-state.port.js";
import { millisecondsUnchecked, targetIdUnchecked } from "../../src/domain/model/units.js";
import { createInMemoryCircuitState } from "../../src/infrastructure/cache/in-memory-circuit-state.js";
import { withLocalFallback } from "../../src/infrastructure/cache/redis-circuit-state.js";
import { recordingLogger } from "../helpers/noop-logger.js";

// Spec 003 US7-3, FR-030 (tasks.md T055): when the shared store is unreachable the
// circuit state falls back to memory, requests never fail because of the store, and each
// switch between shared and local mode is logged once. No Docker needed.

const A = targetIdUnchecked("target-a");

/** A shared store that works or throws on demand, recording how often it was used. */
function flakyStore() {
  const clock = createFakeClock();
  const inner = createInMemoryCircuitState(clock);
  const state = { up: true, calls: 0 };
  const guard =
    <A extends unknown[], R>(op: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      state.calls += 1;
      if (!state.up) throw new Error("ECONNREFUSED 127.0.0.1:6379");
      return op(...args);
    };
  const store: CircuitStatePort = {
    snapshot: guard(inner.snapshot),
    recordFailure: guard(inner.recordFailure),
    recordSuccess: guard(inner.recordSuccess),
    open: guard(inner.open),
    tryAcquireTrial: guard(inner.tryAcquireTrial),
  };
  return { store, state };
}

function setup(connected = true) {
  const { store, state } = flakyStore();
  const local = createInMemoryCircuitState(createFakeClock());
  const { logger, entries } = recordingLogger();
  const wrapped = withLocalFallback(store, local, logger);
  if (connected) wrapped.setAvailable(true);
  const warnings = () => entries.filter((entry) => entry.level === "warn");
  return { wrapped, state, warnings, entries };
}

describe("withLocalFallback (FR-030)", () => {
  it("uses the shared store while it is available", async () => {
    const { wrapped, state } = setup();

    expect(await wrapped.recordFailure(A)).toBe(1);
    expect(state.calls).toBe(1);
  });

  it("US7-3: an unavailable store falls back to memory without failing, warning once", async () => {
    const { wrapped, state, warnings } = setup();
    state.up = false;

    wrapped.setAvailable(false, "connection closed");
    await wrapped.recordFailure(A);
    await wrapped.open(A, millisecondsUnchecked(30_000));
    wrapped.setAvailable(false, "connection closed");

    expect((await wrapped.snapshot(A)).trialPending).toBe(true);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]?.message).toMatch(/in-memory/);
  });

  it("an operation that throws while the store is marked available still succeeds from memory", async () => {
    const { wrapped, state } = setup();
    state.up = false;

    await expect(wrapped.tryAcquireTrial(A, millisecondsUnchecked(1_000))).resolves.toBe(true);
    await expect(wrapped.snapshot(A)).resolves.toEqual({ failures: 0, trialPending: false });
  });

  it("logs one warning when the store comes back, and uses it again", async () => {
    const { wrapped, state, warnings } = setup();
    state.up = false;
    wrapped.setAvailable(false, "connection closed");
    state.up = true;
    const before = state.calls;

    wrapped.setAvailable(true);
    wrapped.setAvailable(true);
    await wrapped.recordFailure(A);

    expect(warnings()).toHaveLength(2);
    expect(warnings()[1]?.message).toMatch(/shared/);
    expect(state.calls).toBe(before + 1);
  });

  it("starts in memory, logs the first connection at info, and warns once if it never connects", () => {
    const connected = setup(false);
    connected.wrapped.setAvailable(true);
    expect(connected.warnings()).toHaveLength(0);
    expect(connected.entries.filter((entry) => entry.level === "info")).toHaveLength(1);

    const never = setup(false);
    never.wrapped.setAvailable(false, "ECONNREFUSED");
    never.wrapped.setAvailable(false, "ECONNREFUSED");
    expect(never.warnings()).toHaveLength(1);
  });

  it("logs no store address, key or value", () => {
    const { wrapped, entries } = setup();
    wrapped.setAvailable(false, "connection closed");

    expect(JSON.stringify(entries)).not.toMatch(/redis:\/\/|6379|password/);
  });
});
