import { ProvidersReportSchema } from "@tamiz/contracts";
import { createFakeClock } from "@tamiz/test-utils";
import { describe, expect, it } from "vitest";
import { percentile, targetWindows } from "../../src/application/audit/aggregates.js";
import type { Milliseconds, TargetId } from "../../src/domain/model/units.js";
import { createInMemoryAuditLog } from "../../src/infrastructure/cache/in-memory-audit-log.js";
import { createInMemoryCircuitState } from "../../src/infrastructure/cache/in-memory-circuit-state.js";
import { ADMIN_AUTH, AUTH, createTestApp, START } from "../helpers/app.js";
import { sampleEntry } from "../support/audit-entries.js";

// Spec 006 US4-1 … US4-3, FR-013 (tasks.md T031).

const minutesAgo = (m: number) => new Date(START.getTime() - m * 60_000).toISOString();

function recent() {
  const audit = createInMemoryAuditLog();
  // sampleEntry: n % 3 === 0 answers on ollama, the others on mistral.
  const latencies = [100, 200, 300, 400, 1000];
  for (const [i, latencyMs] of [1, 2, 4, 5, 7].map((n, i) => [n, latencies[i] ?? 0] as const)) {
    audit.append(sampleEntry(i, { startedAt: minutesAgo(10), latencyMs }));
  }
  audit.append(sampleEntry(3, { startedAt: minutesAgo(9), latencyMs: 50 }));
  // A failed mistral request after a timeout on ollama.
  audit.append(
    sampleEntry(20, {
      startedAt: minutesAgo(2),
      outcome: "failed",
      abandoned: [{ targetId: "ollama-llama", reason: "timeout" }],
    }),
  );
  // Outside the 15-minute window.
  audit.append(sampleEntry(31, { startedAt: minutesAgo(60), latencyMs: 99_999 }));
  return audit;
}

type Report = ReturnType<typeof ProvidersReportSchema.parse>;
const target = (report: Report, id: string) => report.targets.find((t) => t.targetId === id);

async function report(audit = recent(), query = "") {
  const { send } = await createTestApp({ audit });
  const response = await send(`/v1/admin/providers${query}`, { headers: ADMIN_AUTH });
  expect(response.status).toBe(200);
  return ProvidersReportSchema.parse(await response.json());
}

describe("GET /v1/admin/providers", () => {
  it("US4-1: an open circuit with its remaining cool-down", async () => {
    const circuitState = createInMemoryCircuitState(createFakeClock(START));
    await circuitState.open("mistral-small" as TargetId, 30_000 as Milliseconds);
    const { send, clock } = await createTestApp({ circuitState });
    clock.advance(10_000);
    const response = await send("/v1/admin/providers", { headers: ADMIN_AUTH });
    expect(response.status).toBe(200);
    const body = ProvidersReportSchema.parse(await response.json());
    expect(target(body, "mistral-small")).toMatchObject({
      circuit: "open",
      cooldownRemainingMs: 20_000,
    });
    expect(target(body, "ollama-llama")?.circuit).toBe("closed");
    expect(target(body, "ollama-llama")?.cooldownRemainingMs).toBeUndefined();
  });

  it("US4-2: counts, error rate and percentiles over the window", async () => {
    const body = await report();
    expect(body.windowMinutes).toBe(15);
    expect(body.generatedAt).toBe(START.toISOString());
    expect(target(body, "mistral-small")?.window).toEqual({
      requests: 6,
      errors: 1,
      errorRate: 1 / 6,
      latencyP50Ms: 300,
      latencyP95Ms: 880,
    });
    expect(target(body, "ollama-llama")?.window).toEqual({
      requests: 2,
      errors: 1,
      errorRate: 0.5,
      latencyP50Ms: 50,
      latencyP95Ms: 50,
    });
  });

  it("US4-3: a target with no traffic is listed with zeros and no latency", async () => {
    const body = await report();
    expect(body.targets.map((t) => t.targetId)).toEqual([
      "ollama-llama",
      "mistral-small",
      "openai-mini",
      "anthropic-sonnet",
    ]);
    expect(target(body, "anthropic-sonnet")).toMatchObject({
      circuit: "closed",
      window: { requests: 0, errors: 0, errorRate: 0, latencyP50Ms: null, latencyP95Ms: null },
    });
  });

  it("windowMinutes widens the window; out of range is 400", async () => {
    const wide = await report(recent(), "?windowMinutes=120");
    expect(target(wide, "mistral-small")?.window.requests).toBe(7);
    const { send } = await createTestApp();
    const bad = await send("/v1/admin/providers?windowMinutes=0", { headers: ADMIN_AUTH });
    expect(bad.status).toBe(400);
  });

  it("403 for a client key", async () => {
    const { send } = await createTestApp();
    expect((await send("/v1/admin/providers", { headers: AUTH })).status).toBe(403);
  });
});

describe("window helpers", () => {
  it("percentiles interpolate like percentile_cont", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([100, 200, 300, 400, 1000], 0.95)).toBe(880);
  });

  it("blocked entries are not attempts", () => {
    const { target: _target, ...blocked } = sampleEntry(1, { outcome: "blocked" });
    expect(targetWindows([blocked])).toEqual([]);
  });
});
