/**
 * Cost and provider-window aggregates over audit entries (spec 006 FR-012, FR-013,
 * research R-08, R-12).
 *
 * These pure functions are the in-memory implementation and the reference the SQL
 * aggregates are tested against. Served requests (answered or cancelled with a target) are
 * grouped; blocked and failed ones are counted apart. Latency percentiles are continuous,
 * like PostgreSQL's `percentile_cont`.
 */
import type { AuditEntry } from "../../domain/model/audit-entry.js";

export const COST_GROUPS = ["day", "route", "model"] as const;
export type CostGroup = (typeof COST_GROUPS)[number];

export interface CostAggregate {
  readonly key: string;
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly baselineCostUsd: number;
}

export interface CostAggregates {
  readonly rows: ReadonlyArray<CostAggregate>;
  readonly blocked: number;
  readonly failed: number;
}

export interface TargetWindow {
  readonly targetId: string;
  readonly requests: number;
  readonly errors: number;
  readonly latencyP50Ms: number | null;
  readonly latencyP95Ms: number | null;
}

/** Money is summed exactly enough for reports: 8 decimals, like the database column. */
export function money(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function groupKey(entry: AuditEntry, groupBy: CostGroup): string | undefined {
  if (entry.target === undefined) return undefined;
  switch (groupBy) {
    case "day":
      return entry.startedAt.slice(0, 10);
    case "route":
      return entry.target.id;
    case "model":
      return entry.target.model;
  }
}

export function aggregateCost(
  entries: ReadonlyArray<AuditEntry>,
  groupBy: CostGroup,
): CostAggregates {
  const groups = new Map<string, CostAggregate>();
  let blocked = 0;
  let failed = 0;
  for (const entry of entries) {
    if (entry.outcome === "blocked") blocked += 1;
    if (entry.outcome === "failed") failed += 1;
    if (entry.outcome === "blocked" || entry.outcome === "failed") continue;
    const key = groupKey(entry, groupBy);
    if (key === undefined) continue;
    const current = groups.get(key) ?? {
      key,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      baselineCostUsd: 0,
    };
    groups.set(key, {
      key,
      requests: current.requests + 1,
      inputTokens: current.inputTokens + (entry.usage?.inputTokens ?? 0),
      outputTokens: current.outputTokens + (entry.usage?.outputTokens ?? 0),
      costUsd: money(current.costUsd + entry.costUsd),
      baselineCostUsd: money(current.baselineCostUsd + (entry.baselineCostUsd ?? 0)),
    });
  }
  const rows = [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { rows, blocked, failed };
}

/** Continuous percentile (linear interpolation), as `percentile_cont`. */
export function percentile(values: ReadonlyArray<number>, p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  // Rounded to the microsecond so float noise never shows (879.9999… → 880).
  return Math.round((low + (high - low) * (position - lower)) * 1000) / 1000;
}

/**
 * Per target: every attempt that reached it in the window. The answering or failing target
 * counts once per entry (an error when the request failed); each abandoned target counts
 * as one failed attempt. Latency is over answered entries.
 */
export function targetWindows(entries: ReadonlyArray<AuditEntry>): ReadonlyArray<TargetWindow> {
  const stats = new Map<string, { requests: number; errors: number; latencies: number[] }>();
  const at = (id: string) => {
    let s = stats.get(id);
    if (s === undefined) {
      s = { requests: 0, errors: 0, latencies: [] };
      stats.set(id, s);
    }
    return s;
  };
  for (const entry of entries) {
    if (entry.target !== undefined && entry.outcome !== "blocked") {
      const s = at(entry.target.id);
      s.requests += 1;
      if (entry.outcome === "failed") s.errors += 1;
      if (entry.outcome === "answered") s.latencies.push(entry.latencyMs);
    }
    for (const abandoned of entry.abandoned) {
      const s = at(abandoned.targetId);
      s.requests += 1;
      s.errors += 1;
    }
  }
  return [...stats.entries()].map(([targetId, s]) => ({
    targetId,
    requests: s.requests,
    errors: s.errors,
    latencyP50Ms: percentile(s.latencies, 0.5),
    latencyP95Ms: percentile(s.latencies, 0.95),
  }));
}
