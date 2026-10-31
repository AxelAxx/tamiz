import { describe, expect, it } from "vitest";
import { FINISH_REASONS } from "../../src/application/ports/llm-provider.port.js";

// Spec 002 FR-016 (tasks.md T019): the closed finish-reason list adapters map onto. The
// contract drift test of T054 compares it with the response schema's enum.

describe("FINISH_REASONS", () => {
  it("is the contract's closed list", () => {
    expect(FINISH_REASONS).toEqual(["stop", "length", "content_filter", "tool_calls"]);
  });
});
