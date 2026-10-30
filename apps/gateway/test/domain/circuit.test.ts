import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CIRCUIT_STATES,
  type CircuitSnapshot,
  CLOSED_CIRCUIT,
  remainingCooldownMs,
  stateAt,
} from "../../src/domain/model/circuit.js";

// Spec 003 FR-006 … FR-008, research R-04 (tasks.md T011): the circuit's state is a pure
// function of the stored snapshot, the time and the cool-down.

const NOW = Date.parse("2026-01-01T00:00:00Z");
const COOLDOWN = 30_000;

function snapshot(overrides: Partial<CircuitSnapshot> = {}): CircuitSnapshot {
  return { ...CLOSED_CIRCUIT, ...overrides };
}

describe("circuit state", () => {
  it("declares the closed list of states", () => {
    expect(CIRCUIT_STATES).toEqual(["closed", "open", "half_open"]);
  });

  it("is closed with no open time and no pending trial, whatever the failure count", () => {
    expect(stateAt(snapshot(), NOW, COOLDOWN)).toBe("closed");
    expect(stateAt(snapshot({ failures: 4 }), NOW, COOLDOWN)).toBe("closed");
  });

  it("is open while the cool-down runs, and reports the time left", () => {
    const open = snapshot({ openUntil: NOW + 10_000, trialPending: true });

    expect(stateAt(open, NOW, COOLDOWN)).toBe("open");
    expect(remainingCooldownMs(open, NOW, COOLDOWN)).toBe(10_000);
  });

  it("is half-open once the cool-down has elapsed and a trial is pending", () => {
    const opened = snapshot({ openUntil: NOW, trialPending: true });

    expect(stateAt(opened, NOW, COOLDOWN)).toBe("half_open");
    expect(remainingCooldownMs(opened, NOW, COOLDOWN)).toBe(0);
  });

  it("never stays stuck open when the clock moves backwards (edge case)", () => {
    // Opened at NOW for 30 s, then the clock jumped back one hour.
    const open = snapshot({ openUntil: NOW + COOLDOWN, trialPending: true });
    const earlier = NOW - 3_600_000;

    expect(stateAt(open, earlier, COOLDOWN)).toBe("half_open");
    expect(remainingCooldownMs(open, earlier, COOLDOWN)).toBe(0);
  });

  it("states are exhaustive and exclusive, and the remaining time is in [0, cooldown]", () => {
    fc.assert(
      fc.property(
        fc.record({
          failures: fc.nat(20),
          openUntil: fc.option(fc.integer({ min: NOW - 100_000, max: NOW + 100_000 }), {
            nil: undefined,
          }),
          trialPending: fc.boolean(),
        }),
        fc.integer({ min: NOW - 200_000, max: NOW + 200_000 }),
        fc.integer({ min: 1_000, max: 60_000 }),
        (raw, now, cooldown) => {
          const value: CircuitSnapshot = {
            failures: raw.failures,
            trialPending: raw.trialPending,
            ...(raw.openUntil === undefined ? {} : { openUntil: raw.openUntil }),
          };
          const state = stateAt(value, now, cooldown);
          const remaining = remainingCooldownMs(value, now, cooldown);

          expect(CIRCUIT_STATES).toContain(state);
          expect(remaining).toBeGreaterThanOrEqual(0);
          expect(remaining).toBeLessThanOrEqual(cooldown);
          expect(state === "open").toBe(remaining > 0);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
