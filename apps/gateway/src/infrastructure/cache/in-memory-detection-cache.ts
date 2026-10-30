/**
 * In-process `DetectionCachePort`: least-recently-used with a time limit (spec 005 FR-009,
 * research R-08). A `Map` keeps insertion order, so re-inserting on read makes the first
 * key the least recently used one. Time comes from the clock port. `maxEntries: 0`
 * disables the cache. It is never shared between instances: the entries are derived
 * from prompts, and they stay in this process.
 */
import type {
  DetectionCachePort,
  SuccessfulInspection,
} from "../../application/ports/detection-cache.port.js";

export interface InMemoryDetectionCacheOptions {
  readonly maxEntries: number;
  readonly ttlMs: number;
  readonly now: () => Date;
}

interface Entry {
  readonly inspection: SuccessfulInspection;
  readonly expiresAt: number;
}

export interface InMemoryDetectionCache extends DetectionCachePort {
  /** How many entries are held (for tests and health reporting). */
  readonly size: () => number;
  /** A copy of the entries, for tests that check nothing but positions is stored. */
  readonly snapshot: () => ReadonlyArray<readonly [string, SuccessfulInspection]>;
}

export function createInMemoryDetectionCache(
  options: InMemoryDetectionCacheOptions,
): InMemoryDetectionCache {
  const entries = new Map<string, Entry>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      entries.delete(key);
      if (entry.expiresAt <= options.now().getTime()) return undefined;
      entries.set(key, entry);
      return entry.inspection;
    },
    set(key, inspection) {
      if (options.maxEntries <= 0) return;
      entries.delete(key);
      entries.set(key, { inspection, expiresAt: options.now().getTime() + options.ttlMs });
      while (entries.size > options.maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
    },
    size: () => entries.size,
    snapshot: () => [...entries].map(([key, entry]) => [key, entry.inspection] as const),
  };
}
