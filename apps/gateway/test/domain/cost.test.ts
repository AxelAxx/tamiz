import { describe, expect, expectTypeOf, it } from "vitest";
import { computeCost } from "../../src/domain/model/cost.js";
import type { Pricing } from "../../src/domain/model/model-target.js";
import { type Usd, usdUnchecked } from "../../src/domain/model/units.js";

// Spec 002 US7-1 … US7-3, FR-033, SC-008 (tasks.md T064): cost = prompt × in / 1e6 +
// completion × out / 1e6, in `Usd`, exact to 1e-9; no rounding (the dashboard rounds).

function pricing(input: number, output: number): Pricing {
  return { inputUsdPerMillion: usdUnchecked(input), outputUsdPerMillion: usdUnchecked(output) };
}

describe("computeCost (FR-033)", () => {
  it("US7-1: 1000 in + 500 out at 0.15 / 0.60 per million costs 0.00045 USD", () => {
    const cost = computeCost({ promptTokens: 1000, completionTokens: 500 }, pricing(0.15, 0.6));

    expect(cost).toBeCloseTo(0.00045, 9);
    expectTypeOf(cost).toEqualTypeOf<Usd>();
  });

  it("US7-2: a zero-priced target costs exactly 0", () => {
    expect(computeCost({ promptTokens: 123_456, completionTokens: 7_890 }, pricing(0, 0))).toBe(0);
  });

  it("US7-3: zero usage costs 0", () => {
    expect(computeCost({ promptTokens: 0, completionTokens: 0 }, pricing(3, 15))).toBe(0);
  });

  // Hand-computed: in × p / 1e6 + out × q / 1e6.
  const corpus: ReadonlyArray<readonly [number, number, number, number, number]> = [
    [1, 0, 1, 0, 0.000001],
    [0, 1, 0, 1, 0.000001],
    [1_000_000, 1_000_000, 3, 15, 18],
    [12, 3, 0.1, 0.3, 0.0000021],
    [2_000, 400, 0.15, 0.6, 0.00054],
    [4_096, 1_024, 3, 15, 0.027648],
    [500, 250, 0.1, 0.3, 0.000125],
    [10_000, 0, 0.15, 0.6, 0.0015],
    [0, 10_000, 0.15, 0.6, 0.006],
    [33_333, 6_667, 0.4, 2, 0.0266672],
  ];

  it.each(corpus)("SC-008: %i in + %i out at %f / %f costs %f", (input, output, p, q, expected) => {
    expect(
      computeCost({ promptTokens: input, completionTokens: output }, pricing(p, q)),
    ).toBeCloseTo(expected, 9);
  });
});
