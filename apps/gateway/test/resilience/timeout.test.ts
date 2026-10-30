import { createFakeClock } from "@tamiz/test-utils";
import { describe, expect, it } from "vitest";
import { withTimeout } from "../../src/application/resilience/timeout.js";
import { millisecondsUnchecked } from "../../src/domain/model/units.js";
import { err, ok } from "../../src/domain/result.js";
import { failure, target } from "./helpers.js";

// Spec 003 FR-001, FR-005, research R-02, R-03 (tasks.md T002): an attempt is bounded by
// the clock port, its signal is aborted on expiry, and an outside abort is `aborted`.

const MS = millisecondsUnchecked(1000);

describe("withTimeout", () => {
  it("returns the run's result when it settles first and releases the timer", async () => {
    const clock = createFakeClock();
    const timed = withTimeout(clock);

    const result = await clock.drive(timed(target(), MS, async () => ok("answer")));

    expect(result).toEqual(ok("answer"));
    expect(clock.pendingSleeps()).toBe(0);
  });

  it("passes a provider failure through unchanged", async () => {
    const clock = createFakeClock();
    const error = failure("http_error", { status: 503 });

    const result = await clock.drive(withTimeout(clock)(target(), MS, async () => err(error)));

    expect(result).toEqual(err(error));
  });

  it("returns a retryable timeout when the time elapses first, and aborts the run", async () => {
    const clock = createFakeClock();
    let runSignal: AbortSignal | undefined;
    const run = (signal: AbortSignal) => {
      runSignal = signal;
      return new Promise<never>(() => {});
    };

    const result = await clock.drive(withTimeout(clock)(target(), MS, run));

    expect(result).toEqual(
      err(
        expect.objectContaining({
          kind: "provider",
          cause: "timeout",
          retryable: true,
          targetId: "mistral-small",
          provider: "mistral",
        }),
      ),
    );
    expect(runSignal?.aborted).toBe(true);
    expect(clock.now().getTime() - Date.parse("2026-01-01T00:00:00Z")).toBe(1000);
  });

  it("returns a non-retryable `aborted` when the outer signal aborts first", async () => {
    const clock = createFakeClock();
    const outer = new AbortController();
    let runSignal: AbortSignal | undefined;

    const pending = withTimeout(clock)(
      target(),
      MS,
      (signal) => {
        runSignal = signal;
        return new Promise<never>(() => {});
      },
      outer.signal,
    );
    outer.abort(new Error("client went away"));
    const result = await pending;

    expect(result).toEqual(err(expect.objectContaining({ cause: "aborted", retryable: false })));
    expect(runSignal?.aborted).toBe(true);
    expect(clock.pendingSleeps()).toBe(0);
  });

  it("does not start the run when the outer signal is already aborted", async () => {
    const clock = createFakeClock();
    const outer = new AbortController();
    outer.abort();
    let calls = 0;

    const result = await withTimeout(clock)(
      target(),
      MS,
      async () => {
        calls += 1;
        return ok("never");
      },
      outer.signal,
    );

    expect(calls).toBe(0);
    expect(result).toEqual(err(expect.objectContaining({ cause: "aborted" })));
  });
});
