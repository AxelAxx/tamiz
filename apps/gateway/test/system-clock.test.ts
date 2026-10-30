import { describe, expect, it } from "vitest";
import { millisecondsUnchecked } from "../src/domain/model/units.js";
import { systemClock } from "../src/infrastructure/clock/system-clock.js";

// Spec 003 research R-01 (tasks.md T004): the real clock's sleep. The only test of
// feature 003 that waits in real time, for 20 ms.

describe("systemClock.sleep", () => {
  it("resolves after at least the given time", async () => {
    const started = performance.now();

    await systemClock.sleep(millisecondsUnchecked(20));

    expect(performance.now() - started).toBeGreaterThanOrEqual(19);
  });

  it("rejects at once with the signal's reason when aborted", async () => {
    const controller = new AbortController();
    const started = performance.now();

    const pending = systemClock.sleep(millisecondsUnchecked(10_000), controller.signal);
    controller.abort(new Error("stop"));

    await expect(pending).rejects.toEqual(new Error("stop"));
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("rejects at once when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already"));

    await expect(
      systemClock.sleep(millisecondsUnchecked(10_000), controller.signal),
    ).rejects.toEqual(new Error("already"));
  });
});
