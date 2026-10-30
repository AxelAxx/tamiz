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

// Spec 003 research R-01 (tasks.md T001): waiting goes through the clock, so retry waits,
// cool-downs and timeouts are driven by the test instead of real time.
describe("createFakeClock sleep", () => {
  function track(promise: Promise<void>) {
    const state = { settled: false, error: undefined as unknown };
    promise.then(
      () => {
        state.settled = true;
      },
      (error: unknown) => {
        state.settled = true;
        state.error = error;
      },
    );
    return state;
  }

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it("resolves a sleeper only when advance reaches its due time", async () => {
    const clock = createFakeClock();
    const sleeper = track(clock.sleep(1000));

    clock.advance(999);
    await flush();
    expect(sleeper.settled).toBe(false);

    clock.advance(1);
    await flush();
    expect(sleeper.settled).toBe(true);
    expect(clock.pendingSleeps()).toBe(0);
  });

  it("resolves several sleepers in due order, even when registered out of order", async () => {
    const clock = createFakeClock();
    const order: number[] = [];
    void clock.sleep(300).then(() => order.push(300));
    void clock.sleep(100).then(() => order.push(100));
    void clock.sleep(200).then(() => order.push(200));

    clock.advance(1000);
    await flush();

    expect(order).toEqual([100, 200, 300]);
  });

  it("resolves sleep(0) on the next advance(0)", async () => {
    const clock = createFakeClock();
    const sleeper = track(clock.sleep(0));

    clock.advance(0);
    await flush();

    expect(sleeper.settled).toBe(true);
  });

  it("set() past a due time resolves the sleeper", async () => {
    const clock = createFakeClock(new Date("2026-01-01T00:00:00Z"));
    const sleeper = track(clock.sleep(5000));

    clock.set(new Date("2026-01-01T00:00:10Z"));
    await flush();

    expect(sleeper.settled).toBe(true);
  });

  it("an aborted signal rejects with its reason and removes the sleeper", async () => {
    const clock = createFakeClock();
    const controller = new AbortController();
    const sleeper = track(clock.sleep(1000, controller.signal));

    controller.abort(new Error("stop"));
    await flush();

    expect(sleeper.error).toEqual(new Error("stop"));
    expect(clock.pendingSleeps()).toBe(0);
  });

  it("an already aborted signal rejects at once", async () => {
    const clock = createFakeClock();
    const controller = new AbortController();
    controller.abort(new Error("already"));

    await expect(clock.sleep(1000, controller.signal)).rejects.toEqual(new Error("already"));
  });

  it("runAll() moves to the latest due time and resolves every pending sleeper", async () => {
    const clock = createFakeClock(new Date("2026-01-01T00:00:00Z"));
    const first = track(clock.sleep(100));
    const second = track(clock.sleep(2500));

    clock.runAll();
    await flush();

    expect(first.settled && second.settled).toBe(true);
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:02.500Z");
  });

  it("drive() advances through sleeps registered while the promise runs", async () => {
    const clock = createFakeClock(new Date("2026-01-01T00:00:00Z"));
    const work = async () => {
      await clock.sleep(250);
      await Promise.resolve();
      await clock.sleep(500);
      return "done";
    };

    await expect(clock.drive(work())).resolves.toBe("done");
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.750Z");
  });

  it("drive() rejects when the promise can never settle (no sleeper left)", async () => {
    const clock = createFakeClock();

    await expect(clock.drive(new Promise<never>(() => {}))).rejects.toThrow(/never settles/);
  });
});
