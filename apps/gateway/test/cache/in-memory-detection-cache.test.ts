import { createFakeClock } from "@tamiz/test-utils";
import { describe, expect, it } from "vitest";
import type { SuccessfulInspection } from "../../src/application/ports/detection-cache.port.js";
import { createInMemoryDetectionCache } from "../../src/infrastructure/cache/in-memory-detection-cache.js";

// Spec 005 US7-2, US7-4, FR-009, research R-08 (tasks.md T014).

const INSPECTION: SuccessfulInspection = {
  status: "ok",
  level: "critical",
  entities: [{ messageIndex: 0, kind: "DNI", start: 4, end: 13, score: 1 }],
};

function setup(maxEntries = 3, ttlMs = 1_000) {
  const clock = createFakeClock();
  const cache = createInMemoryDetectionCache({ maxEntries, ttlMs, now: () => clock.now() });
  return { clock, cache };
}

describe("createInMemoryDetectionCache", () => {
  it("returns what was stored under the same key", () => {
    const { cache } = setup();
    cache.set("k1", INSPECTION);
    expect(cache.get("k1")).toEqual(INSPECTION);
    expect(cache.get("k2")).toBeUndefined();
  });

  it("US7-4: evicts the least recently used entry beyond the size limit", () => {
    const { cache } = setup(2);
    cache.set("a", INSPECTION);
    cache.set("b", INSPECTION);
    cache.get("a");
    cache.set("c", INSPECTION);

    expect(cache.size()).toBe(2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
  });

  it("expires entries after the time limit", () => {
    const { cache, clock } = setup(3, 1_000);
    cache.set("k", INSPECTION);
    clock.advance(999);
    expect(cache.get("k")).toBeDefined();
    clock.advance(1_000);
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("is disabled with maxEntries 0", () => {
    const { cache } = setup(0);
    cache.set("k", INSPECTION);
    expect(cache.get("k")).toBeUndefined();
  });

  it("US7-2: holds only the key and positions, kinds, scores and the level", () => {
    const { cache } = setup();
    cache.set("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", INSPECTION);

    const dumped = JSON.stringify(cache.snapshot());
    const keys = new Set<string>();
    JSON.parse(dumped, (key, value) => {
      if (key !== "" && Number.isNaN(Number(key))) keys.add(key);
      return value;
    });
    expect([...keys].sort()).toEqual(
      ["end", "entities", "kind", "level", "messageIndex", "score", "start", "status"].sort(),
    );
  });
});
