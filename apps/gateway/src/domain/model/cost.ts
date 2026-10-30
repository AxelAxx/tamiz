/**
 * Cost per request (spec 002 FR-033, FR-034, data-model section 3.6).
 *
 * Plain IEEE doubles, no rounding: exact to 1e-9 for the pricing corpus, and the
 * dashboard rounds for display.
 */
import type { Usd } from "./brands.js";
import type { Pricing } from "./model-target.js";

/** Token counts of one completion; `estimated` when the provider did not report them. */
export interface Usage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly estimated: boolean;
}

/** `promptTokens × input / 1e6 + completionTokens × output / 1e6`, in US dollars. */
export function computeCost(
  usage: Pick<Usage, "promptTokens" | "completionTokens">,
  pricing: Pricing,
): Usd {
  const cost =
    (usage.promptTokens * pricing.inputUsdPerMillion) / 1_000_000 +
    (usage.completionTokens * pricing.outputUsdPerMillion) / 1_000_000;
  // Non-negative and finite: token counts and validated prices are.
  return cost as Usd;
}
