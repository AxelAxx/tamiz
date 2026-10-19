import { HealthResponseSchema } from "@tamiz/contracts";
import { createFakeClock } from "@tamiz/test-utils";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/presentation/app.js";
import { noopLogger } from "./helpers/noop-logger.js";

// Spec 001, US3 scenarios 1 and 2 (FR-017): GET /health matches the health contract and
// is exercised in-process through app.request(), without a socket. Time comes from the
// shared fake clock (US7, research R-09), which satisfies ClockPort structurally.

describe("GET /health", () => {
  it("US3-1/US3-2: answers 200 with a body that validates against HealthResponseSchema", async () => {
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const clock = createFakeClock(startedAt);
    clock.advance(1234);
    const app = createApp({ clock, version: "9.9.9", startedAt, logger: noopLogger });

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    const body = HealthResponseSchema.parse(await response.json());
    expect(body.status).toBe("ok");
    expect(body.version).toBe("9.9.9");
    expect(body.uptimeMs).toBe(1234);
    expect(body.checks).toBeUndefined();
  });

  it("reports zero uptime right after start and never a negative value", async () => {
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const clock = createFakeClock(startedAt);
    const app = createApp({ clock, version: "0.1.0", startedAt, logger: noopLogger });

    const atStart = HealthResponseSchema.parse(await (await app.request("/health")).json());
    expect(atStart.uptimeMs).toBe(0);

    clock.advance(-500);
    const beforeStart = HealthResponseSchema.parse(await (await app.request("/health")).json());
    expect(beforeStart.uptimeMs).toBe(0);
  });

  it("US3-4: carries an x-request-id header", async () => {
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const app = createApp({
      clock: createFakeClock(startedAt),
      version: "0.1.0",
      startedAt,
      logger: noopLogger,
    });
    const response = await app.request("/health");
    expect(response.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  });

  it("SC-007: answers in under 50 ms in-process", async () => {
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const app = createApp({
      clock: createFakeClock(startedAt),
      version: "0.1.0",
      startedAt,
      logger: noopLogger,
    });
    await app.request("/health"); // warm up the router once
    const before = performance.now();
    const response = await app.request("/health");
    const elapsed = performance.now() - before;
    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(50);
  });
});
