import { describe, expect, it } from "vitest";
import { createFakeClock } from "../src/fake-clock.js";

// Spec 001, US7 scenario 1 (FR-025): a fake clock fixed at a chosen instant that only
// moves when the test says so. It satisfies the gateway's `ClockPort` structurally
// (research R-09), so the shape `{ now(): Date }` is asserted here without importing it.

describe("createFakeClock", () => {
  it("US7-1: two now() reads without advancing are identical", () => {
    const clock = createFakeClock(new Date("2026-03-04T05:06:07.890Z"));

    const first = clock.now();
    const second = clock.now();

    expect(first.getTime()).toBe(second.getTime());
    expect(first.toISOString()).toBe("2026-03-04T05:06:07.890Z");
  });

  it("US7-1: advance(1500) moves now() by exactly 1500 ms", () => {
    const clock = createFakeClock(new Date("2026-03-04T05:06:07.890Z"));
    const before = clock.now().getTime();

    clock.advance(1500);

    expect(clock.now().getTime() - before).toBe(1500);
    expect(clock.now().toISOString()).toBe("2026-03-04T05:06:09.390Z");
  });

  it("set(date) jumps to the given instant", () => {
    const clock = createFakeClock();
    const target = new Date("2030-12-31T23:59:59.000Z");

    clock.set(target);

    expect(clock.now().getTime()).toBe(target.getTime());
    clock.advance(1000);
    expect(clock.now().toISOString()).toBe("2031-01-01T00:00:00.000Z");
  });

  it("defaults to 2026-01-01T00:00:00Z when no start is given", () => {
    const clock = createFakeClock();

    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns a fresh Date on every read so callers cannot mutate the clock", () => {
    const clock = createFakeClock();

    const read = clock.now();
    read.setFullYear(1999);

    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does not mutate the Date passed to the constructor or to set()", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const clock = createFakeClock(start);

    clock.advance(60_000);
    expect(start.toISOString()).toBe("2026-01-01T00:00:00.000Z");

    const target = new Date("2027-01-01T00:00:00Z");
    clock.set(target);
    clock.advance(60_000);
    expect(target.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("satisfies the structural ClockPort shape { now(): Date }", () => {
    interface ClockPortShape {
      now(): Date;
    }
    const clock: ClockPortShape = createFakeClock();

    expect(clock.now()).toBeInstanceOf(Date);
  });
});
