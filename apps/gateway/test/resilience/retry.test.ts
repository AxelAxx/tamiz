import { createFakeClock } from "@tamiz/test-utils";
import { describe, expect, it } from "vitest";
import { type RetrySettings, withRetry } from "../../src/application/resilience/retry.js";
import type { ProviderError } from "../../src/domain/errors.js";
import { millisecondsUnchecked } from "../../src/domain/model/units.js";
import { err, ok, type Result } from "../../src/domain/result.js";
import { failure, REQUEST_ID, recordingEvents, sequence, target } from "./helpers.js";

// Spec 003 US3-1 … US3-5, FR-003, FR-004 (tasks.md T003). Fake clock and a seeded random:
// no real waiting.

const START = new Date("2026-01-01T00:00:00Z");
const SETTINGS: RetrySettings = {
  maxAttempts: 2,
  baseDelayMs: millisecondsUnchecked(250),
  maxDelayMs: millisecondsUnchecked(2000),
};

type Outcome = Result<string, ProviderError>;

function setup(
  script: ReadonlyArray<Outcome>,
  options: { settings?: Partial<RetrySettings>; random?: () => number; deadlineMs?: number } = {},
) {
  const clock = createFakeClock(START);
  const events = recordingEvents();
  const calls: number[] = [];
  const retry = withRetry<string>({
    clock,
    random: options.random ?? sequence(0.5),
    events,
    settings: { ...SETTINGS, ...options.settings },
  });
  const run = () =>
    clock.drive(
      retry(
        {
          requestId: REQUEST_ID,
          target: target(),
          deadline: new Date(START.getTime() + (options.deadlineMs ?? 60_000)),
        },
        async (attempt) => {
          calls.push(attempt);
          const outcome = script[Math.min(attempt - 1, script.length - 1)];
          if (outcome === undefined) throw new Error("empty script");
          return outcome;
        },
      ),
    );
  return { clock, events, calls, run };
}

const elapsed = (clock: { now(): Date }) => clock.now().getTime() - START.getTime();

describe("withRetry", () => {
  it("US3-1: a retryable failure then a success calls the same target twice", async () => {
    const { run, calls } = setup([err(failure("http_error", { status: 503 })), ok("answer")]);

    expect(await run()).toEqual(ok("answer"));
    expect(calls).toEqual([1, 2]);
  });

  it("US3-2: a retryable failure on every attempt stops at maxAttempts with the last error", async () => {
    const last = failure("timeout");
    const { run, calls } = setup(
      [err(failure("network")), err(failure("rate_limited")), err(last)],
      {
        settings: { maxAttempts: 3 },
      },
    );

    expect(await run()).toEqual(err(last));
    expect(calls).toEqual([1, 2, 3]);
  });

  it.each([
    ["authentication", failure("authentication", { status: 401 })],
    ["malformed_response", failure("malformed_response")],
    ["a non-retryable http_error", failure("http_error", { status: 400 })],
    ["aborted", failure("aborted")],
  ])("US3-3: %s is not retried", async (_name, error) => {
    const { run, calls, clock } = setup([err(error), ok("never")]);

    expect(await run()).toEqual(err(error));
    expect(calls).toEqual([1]);
    expect(elapsed(clock)).toBe(0);
  });

  it("US3-4: waits are random × min(maxDelay, base × 2^(n-1)) with full jitter", async () => {
    const randoms = [0.5, 0.25, 1, 0.999];
    const { run, events } = setup([err(failure("network"))], {
      settings: { maxAttempts: 5 },
      random: sequence(...randoms),
    });

    await run();

    const waits = events.events
      .filter((event) => event.type === "retry.scheduled")
      .map((event) => ("waitMs" in event ? event.waitMs : undefined));
    // caps: 250, 500, 1000, 2000 (2000 is also maxDelay)
    expect(waits).toEqual([125, 125, 1000, 1998]);
  });

  it("US3-4: every wait stays within its bound for 200 random values", async () => {
    let state = 42;
    const lcg = () => {
      state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
      return state / 2 ** 31;
    };
    const { run, events } = setup([err(failure("network"))], {
      settings: { maxAttempts: 5 },
      random: lcg,
      // 50 rounds share one clock; keep the deadline out of the way.
      deadlineMs: 10_000_000,
    });

    for (let round = 0; round < 50; round += 1) await run();

    const scheduled = events.events.filter((event) => event.type === "retry.scheduled");
    expect(scheduled).toHaveLength(200);
    for (const event of scheduled) {
      if (event.type !== "retry.scheduled") continue;
      const cap = Math.min(2000, 250 * 2 ** (event.attempt - 1));
      expect(event.waitMs).toBeGreaterThanOrEqual(0);
      expect(event.waitMs).toBeLessThanOrEqual(cap);
    }
  });

  it("raises the wait to an upstream retry-after hint, capped by maxDelay", async () => {
    const small = setup([err(failure("rate_limited", { retryAfterMs: 900 })), ok("answer")]);
    await small.run();
    expect(elapsed(small.clock)).toBe(900);

    const large = setup([err(failure("rate_limited", { retryAfterMs: 10_000 })), ok("answer")]);
    await large.run();
    expect(elapsed(large.clock)).toBe(2000);
  });

  it("US3-5: does not start a wait that would end past the deadline", async () => {
    const { run, calls, clock, events } = setup(
      [err(failure("http_error", { status: 502 })), ok("never")],
      { random: sequence(1), deadlineMs: 200 },
    );

    const result = await run();

    expect(result).toEqual(
      err(
        expect.objectContaining({
          cause: "aborted",
          retryable: false,
          message: "request deadline reached",
        }),
      ),
    );
    expect(calls).toEqual([1]);
    expect(elapsed(clock)).toBe(0);
    expect(events.events.filter((event) => event.type === "retry.scheduled")).toHaveLength(0);
  });

  it("emits one retry.scheduled event per wait, with the request, target and residency", async () => {
    const { run, events } = setup([err(failure("timeout")), ok("answer")]);

    await run();

    expect(events.events).toEqual([
      {
        type: "retry.scheduled",
        requestId: "req-resilience",
        targetId: "mistral-small",
        provider: "mistral",
        residency: "eu",
        at: "2026-01-01T00:00:00.000Z",
        attempt: 1,
        waitMs: 125,
        reason: "timeout",
      },
    ]);
  });

  it("an abort during the wait ends with `aborted` and no further attempt", async () => {
    const clock = createFakeClock(START);
    const controller = new AbortController();
    const calls: number[] = [];
    const retry = withRetry<string>({
      clock,
      random: sequence(1),
      events: recordingEvents(),
      settings: SETTINGS,
    });

    const pending = retry(
      {
        requestId: REQUEST_ID,
        target: target(),
        deadline: new Date(START.getTime() + 60_000),
        signal: controller.signal,
      },
      async (attempt) => {
        calls.push(attempt);
        return err(failure("network"));
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    expect(await pending).toEqual(err(expect.objectContaining({ cause: "aborted" })));
    expect(calls).toEqual([1]);
  });
});
