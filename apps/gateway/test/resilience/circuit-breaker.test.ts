import { createFakeClock } from "@tamiz/test-utils";
import { describe, expect, it } from "vitest";
import {
  type BreakerSettings,
  createCircuitBreaker,
} from "../../src/application/resilience/circuit-breaker.js";
import type { ProviderError } from "../../src/domain/errors.js";
import { millisecondsUnchecked } from "../../src/domain/model/units.js";
import { err, ok, type Result } from "../../src/domain/result.js";
import { createInMemoryCircuitState } from "../../src/infrastructure/cache/in-memory-circuit-state.js";
import { failure, REQUEST_ID, recordingEvents, target } from "./helpers.js";

// Spec 003 US4-1 … US4-6, FR-006 … FR-009, research R-04, R-05 (tasks.md T013). Fake
// clock and the in-memory circuit state: no real waiting.

const START = new Date("2026-01-01T00:00:00Z");
const SETTINGS: BreakerSettings = {
  failureThreshold: 3,
  cooldownMs: millisecondsUnchecked(30_000),
};
const LEASE = millisecondsUnchecked(5_000);
const CONTEXT = { requestId: REQUEST_ID };

function setup() {
  const clock = createFakeClock(START);
  const events = recordingEvents();
  const breaker = createCircuitBreaker({
    state: createInMemoryCircuitState(clock),
    clock,
    events,
    settings: SETTINGS,
  });
  return { clock, events, breaker };
}

const SUCCESS: Result<string, ProviderError> = ok("answer");
const counted = () => err(failure("http_error", { status: 503 }));

describe("createCircuitBreaker", () => {
  it("lets calls through while closed", async () => {
    const { breaker } = setup();

    expect(await breaker.admit(target(), CONTEXT, LEASE)).toEqual({ kind: "call" });
  });

  it("US4-1: the threshold-th consecutive counted failure opens the circuit and emits an event", async () => {
    const { breaker, events } = setup();

    for (let i = 0; i < 3; i += 1) {
      const admission = await breaker.admit(target(), CONTEXT, LEASE);
      await breaker.onResult(target(), CONTEXT, counted(), admission);
    }

    expect(await breaker.admit(target(), CONTEXT, LEASE)).toEqual({
      kind: "skip",
      remainingMs: 30_000,
    });
    expect(events.events).toEqual([
      expect.objectContaining({
        type: "circuit.changed",
        from: "closed",
        to: "open",
        targetId: "mistral-small",
        requestId: "req-resilience",
      }),
    ]);
  });

  it("a success in between resets the consecutive count", async () => {
    const { breaker } = setup();
    const call = { kind: "call" } as const;

    await breaker.onResult(target(), CONTEXT, counted(), call);
    await breaker.onResult(target(), CONTEXT, counted(), call);
    await breaker.onResult(target(), CONTEXT, SUCCESS, call);
    await breaker.onResult(target(), CONTEXT, counted(), call);
    await breaker.onResult(target(), CONTEXT, counted(), call);

    expect(await breaker.admit(target(), CONTEXT, LEASE)).toEqual({ kind: "call" });
  });

  async function open(breaker: ReturnType<typeof setup>["breaker"]) {
    for (let i = 0; i < 3; i += 1) {
      await breaker.onResult(target(), CONTEXT, counted(), { kind: "call" });
    }
  }

  it("US4-2: while open, the target is skipped with the remaining cool-down", async () => {
    const { breaker, clock } = setup();
    await open(breaker);

    clock.advance(12_000);

    expect(await breaker.admit(target(), CONTEXT, LEASE)).toEqual({
      kind: "skip",
      remainingMs: 18_000,
    });
  });

  it("US4-3: after the cool-down exactly one trial is admitted; a concurrent request skips", async () => {
    const { breaker, clock } = setup();
    await open(breaker);
    clock.advance(30_000);

    expect(await breaker.admit(target(), CONTEXT, LEASE)).toEqual({ kind: "trial" });
    expect(await breaker.admit(target(), CONTEXT, LEASE)).toEqual({
      kind: "skip",
      remainingMs: 0,
    });
  });

  it("US4-4: a successful trial closes the circuit and emits half_open → closed", async () => {
    const { breaker, clock, events } = setup();
    await open(breaker);
    clock.advance(30_000);
    const trial = await breaker.admit(target(), CONTEXT, LEASE);

    await breaker.onResult(target(), CONTEXT, SUCCESS, trial);

    expect(await breaker.admit(target(), CONTEXT, LEASE)).toEqual({ kind: "call" });
    expect(events.events.at(-1)).toMatchObject({
      type: "circuit.changed",
      from: "half_open",
      to: "closed",
    });
  });

  it("US4-4: a failed trial reopens the circuit for a full cool-down", async () => {
    const { breaker, clock, events } = setup();
    await open(breaker);
    clock.advance(30_000);
    const trial = await breaker.admit(target(), CONTEXT, LEASE);

    await breaker.onResult(target(), CONTEXT, counted(), trial);

    expect(await breaker.admit(target(), CONTEXT, LEASE)).toEqual({
      kind: "skip",
      remainingMs: 30_000,
    });
    expect(events.events.at(-1)).toMatchObject({ from: "half_open", to: "open" });
  });

  it("a trial that ends because the request deadline aborted it counts as a failure (edge case)", async () => {
    const { breaker, clock } = setup();
    await open(breaker);
    clock.advance(30_000);
    const trial = await breaker.admit(target(), CONTEXT, LEASE);

    await breaker.onResult(target(), CONTEXT, err(failure("aborted")), trial);

    expect((await breaker.admit(target(), CONTEXT, LEASE)).kind).toBe("skip");
  });

  it("US4-5: one target's circuit does not affect another's", async () => {
    const { breaker } = setup();
    await open(breaker);

    expect(await breaker.admit(target("openai-mini"), CONTEXT, LEASE)).toEqual({ kind: "call" });
  });

  it.each([
    ["authentication", failure("authentication", { status: 401 })],
    ["malformed_response", failure("malformed_response")],
    ["a non-retryable http_error", failure("http_error", { status: 400 })],
    ["aborted outside a trial", failure("aborted")],
  ])("US4-6: %s does not count towards opening", async (_name, error) => {
    const { breaker, events } = setup();

    for (let i = 0; i < 10; i += 1) {
      await breaker.onResult(target(), CONTEXT, err(error), { kind: "call" });
    }

    expect(await breaker.admit(target(), CONTEXT, LEASE)).toEqual({ kind: "call" });
    expect(events.events).toEqual([]);
  });

  it.each([
    ["rate_limited", failure("rate_limited")],
    ["timeout", failure("timeout")],
    ["network", failure("network")],
  ])("%s counts towards opening", async (_name, error) => {
    const { breaker } = setup();

    for (let i = 0; i < 3; i += 1) {
      await breaker.onResult(target(), CONTEXT, err(error), { kind: "call" });
    }

    expect((await breaker.admit(target(), CONTEXT, LEASE)).kind).toBe("skip");
  });
});
