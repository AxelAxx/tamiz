/**
 * A model a request can be routed to (spec 002 FR-001, data-model sections 1 and 3.4).
 * The closed lists are mirrored as `z.enum` in `@tamiz/contracts` (research R-03).
 */
// From `brands.ts`, not `units.ts`: `errors.ts` imports this file, and `units.ts` imports
// `errors.ts`.
import type { Milliseconds, TargetId, Usd } from "./brands.js";

export const PROVIDER_NAMES = ["ollama", "mistral", "anthropic", "openai"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const RESIDENCIES = ["local", "eu", "us", "global"] as const;
export type Residency = (typeof RESIDENCIES)[number];

/** Prices in US dollars per million tokens. */
export interface Pricing {
  readonly inputUsdPerMillion: Usd;
  readonly outputUsdPerMillion: Usd;
}

export interface ModelTarget {
  readonly id: TargetId;
  readonly provider: ProviderName;
  /** The provider's own model name, e.g. `mistral-small-latest`. */
  readonly model: string;
  /** A free region label, e.g. `eu-west` or `local`. */
  readonly region: string;
  readonly residency: Residency;
  readonly pricing: Pricing;
  readonly timeoutMs?: Milliseconds;
}
