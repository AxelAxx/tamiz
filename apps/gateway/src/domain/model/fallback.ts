/**
 * Why a target of the chain was abandoned, and how the `x-tamiz-fallback` header lists it
 * (spec 003 FR-016, US5-2, data-model section 2.5).
 */
import type { TargetId } from "./brands.js";

/** Provider failure causes that end a target's turn, plus a skip because its circuit is open. */
export const FALLBACK_REASONS = [
  "rate_limited",
  "http_error",
  "timeout",
  "network",
  "malformed_response",
  "authentication",
  "circuit_open",
] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

export interface Abandoned {
  readonly targetId: TargetId;
  readonly reason: FallbackReason;
}

/** `"a:timeout,b:circuit_open"`; the empty string when nothing was abandoned. */
export function formatFallbackHeader(abandoned: ReadonlyArray<Abandoned>): string {
  return abandoned.map((entry) => `${entry.targetId}:${entry.reason}`).join(",");
}
