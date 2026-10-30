import { createFakeClock, type FakeClock } from "@tamiz/test-utils";
import { describe, expect, it } from "vitest";
import type { CircuitStatePort } from "../../src/application/ports/circuit-state.port.js";
import { millisecondsUnchecked, targetIdUnchecked } from "../../src/domain/model/units.js";

// The behaviour every `CircuitStatePort` adapter must have (spec 003 FR-006 … FR-008,
// research R-04, tasks.md T012). The in-memory adapter runs it here; the Redis adapter
// of `T-003-06` runs the same list against a real store.

const A = targetIdUnchecked("target-a");
const B = targetIdUnchecked("target-b");
const START = new Date("2026-01-01T00:00:00Z");

export type CircuitStateFactory = (
  clock: FakeClock,
) => CircuitStatePort | Promise<CircuitStatePort>;

export function describeCircuitStateContract(name: string, factory: CircuitStateFactory): void {
  describe(`${name} (CircuitStatePort contract)`, () => {
    async function setup() {
      const clock = createFakeClock(START);
      return { clock, state: await factory(clock) };
    }

    it("starts closed: no failures, not open, no trial pending", async () => {
      const { state } = await setup();

      expect(await state.snapshot(A)).toEqual({ failures: 0, trialPending: false });
    });

    it("recordFailure increments and returns the consecutive count", async () => {
      const { state } = await setup();

      expect(await state.recordFailure(A)).toBe(1);
      expect(await state.recordFailure(A)).toBe(2);
      expect((await state.snapshot(A)).failures).toBe(2);
    });

    it("open sets openUntil = now + cooldown, marks a trial pending and resets the count", async () => {
      const { state, clock } = await setup();
      await state.recordFailure(A);

      await state.open(A, millisecondsUnchecked(30_000));

      expect(await state.snapshot(A)).toEqual({
        failures: 0,
        openUntil: clock.now().getTime() + 30_000,
        trialPending: true,
      });
    });

    it("recordSuccess resets the count, the open time and the pending trial", async () => {
      const { state } = await setup();
      await state.recordFailure(A);
      await state.open(A, millisecondsUnchecked(30_000));

      await state.recordSuccess(A);

      expect(await state.snapshot(A)).toEqual({ failures: 0, trialPending: false });
    });

    it("US4-3: tryAcquireTrial grants one trial until the lease expires", async () => {
      const { state, clock } = await setup();
      await state.open(A, millisecondsUnchecked(1_000));

      expect(await state.tryAcquireTrial(A, millisecondsUnchecked(5_000))).toBe(true);
      expect(await state.tryAcquireTrial(A, millisecondsUnchecked(5_000))).toBe(false);
      clock.advance(4_999);
      expect(await state.tryAcquireTrial(A, millisecondsUnchecked(5_000))).toBe(false);
      clock.advance(1);
      expect(await state.tryAcquireTrial(A, millisecondsUnchecked(5_000))).toBe(true);
    });

    it("opening again or recording a success releases the trial lease", async () => {
      const { state } = await setup();
      await state.open(A, millisecondsUnchecked(1_000));
      await state.tryAcquireTrial(A, millisecondsUnchecked(60_000));

      await state.open(A, millisecondsUnchecked(1_000));
      expect(await state.tryAcquireTrial(A, millisecondsUnchecked(60_000))).toBe(true);

      await state.recordSuccess(A);
      expect(await state.tryAcquireTrial(A, millisecondsUnchecked(60_000))).toBe(true);
    });

    it("US4-5: targets are independent", async () => {
      const { state } = await setup();
      await state.recordFailure(A);
      await state.open(A, millisecondsUnchecked(30_000));
      await state.tryAcquireTrial(A, millisecondsUnchecked(5_000));

      expect(await state.snapshot(B)).toEqual({ failures: 0, trialPending: false });
      expect(await state.recordFailure(B)).toBe(1);
      expect(await state.tryAcquireTrial(B, millisecondsUnchecked(5_000))).toBe(true);
    });
  });
}
