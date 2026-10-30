import { describe, expect, it } from "vitest";
import { err, ok } from "../../src/domain/result.js";
import { chainSetup, chainTarget, decisionFor } from "./chain-helpers.js";
import { failure } from "./helpers.js";

// Spec 003 US1-1 … US1-4, US2-1, US2-2, US2-4, US3-5, US4-2, US4-7, US5-1, US5-2, SC-001,
// FR-011 … FR-017 (tasks.md T023). Fake clock, seeded random, in-memory circuit state.

const EU = chainTarget("eu-primary", "eu");
const US = chainTarget("us-second", "us");
const LOCAL = chainTarget("local-third", "local");

const fail503 = (on = EU) => err(failure("http_error", { status: 503, on }));

describe("executeChain", () => {
  it("US1-1: a primary failing on every attempt falls back to the second target", async () => {
    const { run, clock, calls } = chainSetup();

    const result = await clock.drive(
      run(decisionFor([EU, US]), { "eu-primary": [fail503()], "us-second": [ok("from us")] }),
    );

    expect(result).toEqual(
      ok({
        target: US,
        value: "from us",
        abandoned: [{ targetId: "eu-primary", reason: "http_error" }],
      }),
    );
    expect(calls).toEqual(["eu-primary", "eu-primary", "us-second"]);
  });

  it("US1-2: a non-retryable failure is not retried and the chain advances", async () => {
    const { run, clock, calls } = chainSetup();

    const result = await clock.drive(
      run(decisionFor([EU, US]), {
        "eu-primary": [err(failure("authentication", { status: 401, on: EU }))],
        "us-second": [ok("from us")],
      }),
    );

    expect(result.ok && result.value.abandoned).toEqual([
      { targetId: "eu-primary", reason: "authentication" },
    ]);
    expect(calls).toEqual(["eu-primary", "us-second"]);
  });

  it("US1-3: a healthy primary answers with nothing abandoned", async () => {
    const { run, clock } = chainSetup();

    const result = await clock.drive(run(decisionFor([EU, US]), { "eu-primary": [ok("from eu")] }));

    expect(result).toEqual(ok({ target: EU, value: "from eu", abandoned: [] }));
  });

  it("US1-4: every target failing returns the last error, the last target and the earlier ones", async () => {
    const { run, clock } = chainSetup();
    const lastTimeout = err(failure("timeout", { on: LOCAL }));

    const result = await clock.drive(
      run(decisionFor([EU, US, LOCAL]), {
        "eu-primary": [fail503()],
        "us-second": [err(failure("network", { on: US }))],
        "local-third": [lastTimeout],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("exhausted");
    expect(result.error.target).toBe(LOCAL);
    expect(result.error.error).toMatchObject({ kind: "provider", cause: "timeout" });
    expect(result.error.abandoned).toEqual([
      { targetId: "eu-primary", reason: "http_error" },
      { targetId: "us-second", reason: "network" },
    ]);
  });

  it("US2-1: the next target outside the allowed residencies is never called", async () => {
    const { run, clock, calls, events } = chainSetup();

    const result = await clock.drive(
      run(decisionFor([EU, US], ["local", "eu"]), {
        "eu-primary": [fail503()],
        "us-second": [ok("must not happen")],
      }),
    );

    expect(calls).not.toContain("us-second");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      kind: "residency",
      target: US,
      error: {
        kind: "residency_violation",
        targetId: "us-second",
        residency: "us",
        allowed: ["local", "eu"],
      },
      abandoned: [{ targetId: "eu-primary", reason: "http_error" }],
    });
    expect(events.events.filter((event) => event.type === "residency.blocked")).toHaveLength(1);
  });

  it("US2-2: a primary outside the allowed residencies blocks before any call", async () => {
    const { run, clock, calls } = chainSetup();

    const result = await clock.drive(
      run(decisionFor([US, EU], ["eu"]), { "us-second": [ok("no")] }),
    );

    expect(calls).toEqual([]);
    expect(result.ok || result.error.kind).toBe("residency");
  });

  it("US2-4: with every residency allowed, each event carries the target's residency", async () => {
    const { run, clock, events } = chainSetup();

    await clock.drive(
      run(decisionFor([EU, US]), { "eu-primary": [fail503()], "us-second": [ok("from us")] }),
    );

    const byTarget = new Map(events.events.map((event) => [event.targetId, event.residency]));
    expect(byTarget.get(EU.id)).toBe("eu");
    expect(byTarget.get(US.id)).toBe("us");
  });

  it("US4-2: a target whose circuit is open is skipped with circuit_open and not called", async () => {
    const { run, clock, calls, circuitState } = chainSetup();
    await circuitState.open(EU.id, 30_000 as never);

    const result = await clock.drive(run(decisionFor([EU, US]), { "us-second": [ok("from us")] }));

    expect(calls).toEqual(["us-second"]);
    expect(result.ok && result.value.abandoned).toEqual([
      { targetId: "eu-primary", reason: "circuit_open" },
    ]);
  });

  it("US4-7: every circuit open → unavailable with the shortest remaining cool-down, no call", async () => {
    const { run, clock, calls, circuitState } = chainSetup();
    await circuitState.open(EU.id, 30_000 as never);
    clock.advance(20_000);
    await circuitState.open(US.id, 30_000 as never);

    const result = await clock.drive(run(decisionFor([EU, US]), {}));

    expect(calls).toEqual([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      kind: "unavailable",
      target: US,
      error: { kind: "provider_unavailable", retryAfterMs: 10_000 },
      abandoned: [{ targetId: "eu-primary", reason: "circuit_open" }],
    });
  });

  it("US4-7: the retry hint is at least one second, even when a trial is merely in flight", async () => {
    const { run, clock, circuitState } = chainSetup();
    await circuitState.open(EU.id, 30_000 as never);
    clock.advance(30_000);
    await circuitState.tryAcquireTrial(EU.id, 10_000 as never);

    const result = await clock.drive(run(decisionFor([EU]), {}));

    expect(!result.ok && result.error.error).toMatchObject({ retryAfterMs: 1_000 });
  });

  it("US3-5: the request deadline stops the chain with a deadline failure", async () => {
    const { run, clock, calls } = chainSetup({
      resilience: { requestDeadlineMs: 15_000 as never, maxAttempts: 1 },
    });

    const result = await clock.drive(
      run(decisionFor([EU, US, LOCAL]), {
        "eu-primary": ["hang"],
        "us-second": ["hang"],
        "local-third": [ok("too late")],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("deadline");
    expect(result.error.error).toMatchObject({ kind: "provider", cause: "aborted" });
    // 10 s timeout on the primary; the 5 s left bound the second attempt; nothing is left
    // for the third target, which is not called.
    expect(calls).toEqual(["eu-primary", "us-second"]);
    expect(result.error.target).toBe(LOCAL);
    expect(result.error.abandoned).toEqual([
      { targetId: "eu-primary", reason: "timeout" },
      { targetId: "us-second", reason: "timeout" },
    ]);
    expect(clock.now().getTime() - Date.parse("2026-01-01T00:00:00Z")).toBe(15_000);
  });

  it("US5-1, US5-2: one event per step, in order, and the abandoned list matches the events", async () => {
    const { run, clock, events } = chainSetup();

    const result = await clock.drive(
      run(decisionFor([EU, US]), { "eu-primary": [fail503()], "us-second": [ok("from us")] }),
    );

    expect(events.events.map((event) => `${event.type}@${event.targetId}`)).toEqual([
      "attempt.started@eu-primary",
      "attempt.failed@eu-primary",
      "retry.scheduled@eu-primary",
      "attempt.started@eu-primary",
      "attempt.failed@eu-primary",
      "fallback@eu-primary",
      "attempt.started@us-second",
      "attempt.succeeded@us-second",
    ]);
    expect(events.events.every((event) => event.requestId === "req-resilience")).toBe(true);
    const abandonedFromEvents = events.events
      .filter((event) => event.type === "fallback" || event.type === "target.skipped")
      .map((event) => ({
        targetId: event.targetId,
        reason: "reason" in event ? event.reason : undefined,
      }));
    expect(result.ok && result.value.abandoned).toEqual(abandonedFromEvents);
  });

  it("SC-001: once the primary's circuit opens it receives no call during the cool-down", async () => {
    const { run, clock, calls } = chainSetup({ resilience: { maxAttempts: 1 } });
    const decision = decisionFor([EU, US]);
    const scripts = { "eu-primary": [fail503()], "us-second": [ok("from us")] };

    for (let i = 0; i < 25; i += 1) {
      const result = await clock.drive(run(decision, scripts));
      expect(result.ok).toBe(true);
    }

    // Threshold 5: the primary is called five times, then skipped for the other twenty.
    expect(calls.filter((id) => id === "eu-primary")).toHaveLength(5);
    expect(calls.filter((id) => id === "us-second")).toHaveLength(25);
  });

  it("SC-005: the resilience layer adds under 2 ms per healthy request (p95)", async () => {
    const { run } = chainSetup();
    const decision = decisionFor([EU, US]);
    const scripts = { "eu-primary": [ok("from eu")] };
    const durations: number[] = [];

    for (let i = 0; i < 1_000; i += 1) {
      const started = performance.now();
      const result = await run(decision, scripts);
      durations.push(performance.now() - started);
      expect(result.ok).toBe(true);
    }

    durations.sort((a, b) => a - b);
    expect(durations[Math.floor(durations.length * 0.95)]).toBeLessThan(2);
  });

  it("a half-open trial is a single attempt, even with retries configured", async () => {
    const { run, clock, calls, circuitState } = chainSetup({ resilience: { maxAttempts: 3 } });
    await circuitState.open(EU.id, 30_000 as never);
    clock.advance(30_000);

    await clock.drive(
      run(decisionFor([EU, US]), { "eu-primary": [fail503()], "us-second": [ok("x")] }),
    );

    expect(calls).toEqual(["eu-primary", "us-second"]);
  });

  it("an outer abort stops the chain without trying further targets", async () => {
    const { run, clock, calls } = chainSetup();
    const controller = new AbortController();

    const pending = run(
      decisionFor([EU, US]),
      { "eu-primary": ["hang"], "us-second": [ok("no")] },
      controller.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    const result = await clock.drive(pending);

    expect(calls).toEqual(["eu-primary"]);
    expect(!result.ok && result.error.kind).toBe("deadline");
  });
});
