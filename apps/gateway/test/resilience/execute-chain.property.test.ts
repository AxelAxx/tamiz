import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { backoffMs } from "../../src/application/resilience/retry.js";
import type { ProviderErrorCause } from "../../src/domain/errors.js";
import { RESIDENCIES, type Residency } from "../../src/domain/model/model-target.js";
import { err, ok } from "../../src/domain/result.js";
import { chainSetup, chainTarget, decisionFor, type Scripts } from "./chain-helpers.js";
import { failure } from "./helpers.js";

// Spec 003 SC-002, SC-003 (tasks.md T024): over generated chains, residency sets, failure
// scripts and breaker states, the executor makes exactly the calls the rules allow: none
// outside the allowed residencies, none on an open circuit, no retry after a
// non-retryable failure, at most `maxAttempts` per target, and every wait within its
// full-jitter bound.

const CAUSES: ReadonlyArray<ProviderErrorCause> = [
  "rate_limited",
  "http_error",
  "timeout",
  "network",
  "malformed_response",
  "authentication",
];

type Outcome = "ok" | { readonly cause: ProviderErrorCause; readonly status: number };

const outcomeArb: fc.Arbitrary<Outcome> = fc.oneof(
  fc.constant("ok" as const),
  fc.record({ cause: fc.constantFrom(...CAUSES), status: fc.constantFrom(400, 500, 503) }),
);

const caseArb = fc.record({
  residencies: fc.array(fc.constantFrom(...RESIDENCIES), { minLength: 1, maxLength: 5 }),
  allowed: fc.subarray([...RESIDENCIES], { minLength: 1 }),
  scripts: fc.array(fc.array(outcomeArb, { minLength: 1, maxLength: 4 }), {
    minLength: 5,
    maxLength: 5,
  }),
  open: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
  maxAttempts: fc.integer({ min: 1, max: 4 }),
  seed: fc.double({ min: 0, max: 0.999_999, noNaN: true }),
});

function retryable(outcome: Outcome): boolean {
  if (outcome === "ok") return false;
  if (outcome.cause === "http_error") return outcome.status >= 500;
  return ["rate_limited", "timeout", "network"].includes(outcome.cause);
}

/** The calls the rules allow, computed independently of the executor. */
function expectedCalls(
  ids: ReadonlyArray<string>,
  residencies: ReadonlyArray<Residency>,
  allowed: ReadonlyArray<Residency>,
  open: ReadonlyArray<boolean>,
  scripts: ReadonlyArray<ReadonlyArray<Outcome>>,
  maxAttempts: number,
): string[] {
  const calls: string[] = [];
  for (const [index, id] of ids.entries()) {
    if (!allowed.includes(residencies[index] as Residency)) return calls;
    if (open[index]) continue;
    const script = scripts[index] ?? ["ok"];
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const outcome = script[Math.min(attempt, script.length - 1)] ?? "ok";
      calls.push(id);
      if (outcome === "ok") return calls;
      if (!retryable(outcome)) break;
    }
  }
  return calls;
}

describe("executeChain properties (SC-002, SC-003)", () => {
  it("makes exactly the calls the residency, breaker and retry rules allow", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const { run, clock, calls, events, circuitState, resilience } = chainSetup({
          resilience: { maxAttempts: c.maxAttempts },
          random: () => c.seed,
        });
        const chain = c.residencies.map((residency, index) => chainTarget(`t${index}`, residency));
        for (const [index, target] of chain.entries()) {
          if (c.open[index]) await circuitState.open(target.id, 30_000 as never);
        }
        const scripts: Scripts = Object.fromEntries(
          chain.map((target, index) => [
            target.id,
            (c.scripts[index] ?? ["ok"]).map((outcome) =>
              outcome === "ok"
                ? ok(`from ${target.id}`)
                : err(failure(outcome.cause, { status: outcome.status, on: target })),
            ),
          ]),
        );

        await clock.drive(run(decisionFor(chain, c.allowed), scripts));

        const ids = chain.map((target) => target.id as string);
        expect(calls).toEqual(
          expectedCalls(ids, c.residencies, c.allowed, c.open, c.scripts, c.maxAttempts),
        );
        // SC-002 stated directly as well.
        const residencyOf = new Map(chain.map((target) => [target.id as string, target.residency]));
        for (const id of calls) expect(c.allowed).toContain(residencyOf.get(id));
        // SC-003: every wait is exactly the full-jitter value for its retry number.
        const settings = {
          maxAttempts: c.maxAttempts,
          baseDelayMs: resilience.backoff.baseDelayMs,
          maxDelayMs: resilience.backoff.maxDelayMs,
        };
        for (const event of events.events) {
          if (event.type !== "retry.scheduled") continue;
          expect(event.waitMs).toBe(backoffMs(settings, event.attempt, c.seed));
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
