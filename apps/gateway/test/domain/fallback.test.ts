import { describe, expect, it } from "vitest";
import { FALLBACK_REASONS, formatFallbackHeader } from "../../src/domain/model/fallback.js";
import { targetIdUnchecked } from "../../src/domain/model/units.js";

// Spec 003 FR-016, US5-2 (tasks.md T022): the closed list of reasons and the header value.

describe("fallback reasons and header", () => {
  it("declares the closed list of FR-016", () => {
    expect(FALLBACK_REASONS).toEqual([
      "rate_limited",
      "http_error",
      "timeout",
      "network",
      "malformed_response",
      "authentication",
      "circuit_open",
    ]);
  });

  it("formats nothing as an empty string", () => {
    expect(formatFallbackHeader([])).toBe("");
  });

  it("formats abandoned targets in order as target:reason pairs", () => {
    expect(
      formatFallbackHeader([
        { targetId: targetIdUnchecked("mistral-small"), reason: "timeout" },
        { targetId: targetIdUnchecked("openai-mini"), reason: "circuit_open" },
      ]),
    ).toBe("mistral-small:timeout,openai-mini:circuit_open");
  });
});
