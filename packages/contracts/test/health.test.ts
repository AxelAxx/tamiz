import { describe, expect, expectTypeOf, it } from "vitest";
import { type HealthResponse, HealthResponseSchema, type Milliseconds } from "../src/index.js";

const ok = { status: "ok", version: "0.1.0", uptimeMs: 12_345 } as const;
const degraded = {
  status: "degraded",
  version: "0.1.0",
  uptimeMs: 12_345,
  checks: [{ name: "postgres", status: "down", detail: "connection refused" }],
} as const;

describe("HealthResponseSchema (spec US2-6, FR-009)", () => {
  it("accepts { status: ok, version, uptimeMs } and brands uptimeMs", () => {
    const result = HealthResponseSchema.safeParse(ok);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(ok);
    expectTypeOf(result.data).toEqualTypeOf<HealthResponse>();
    expectTypeOf(result.data.uptimeMs).toEqualTypeOf<Milliseconds>();
  });

  it("accepts status: ok with checks that are all ok", () => {
    expect(
      HealthResponseSchema.safeParse({ ...ok, checks: [{ name: "self", status: "ok" }] }).success,
    ).toBe(true);
  });

  it("accepts status: degraded with a non-empty checks list", () => {
    expect(HealthResponseSchema.safeParse(degraded).success).toBe(true);
  });

  it("rejects status: degraded without checks", () => {
    const { checks: _checks, ...withoutChecks } = degraded;
    const result = HealthResponseSchema.safeParse(withoutChecks);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["checks"]);
  });

  it("rejects status: degraded with an empty checks list", () => {
    const result = HealthResponseSchema.safeParse({ ...degraded, checks: [] });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["checks"]);
  });

  it('rejects any other status ("meh")', () => {
    const result = HealthResponseSchema.safeParse({ ...ok, status: "meh" });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["status"]);
  });

  it.each([-1, 1.5, "12"])(
    "rejects uptimeMs that is not a non-negative integer: %s",
    (uptimeMs) => {
      const result = HealthResponseSchema.safeParse({ ...ok, uptimeMs });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(["uptimeMs"]);
    },
  );

  it("rejects an empty version", () => {
    const result = HealthResponseSchema.safeParse({ ...ok, version: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["version"]);
  });

  it("rejects an unknown check status", () => {
    const result = HealthResponseSchema.safeParse({
      ...degraded,
      checks: [{ name: "redis", status: "flaky" }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["checks", 0, "status"]);
  });

  it("rejects an unknown check field", () => {
    const result = HealthResponseSchema.safeParse({
      ...degraded,
      checks: [{ name: "redis", status: "down", latencyMs: 10 }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    expect(result.error.issues[0]?.path).toEqual(["checks", 0]);
  });

  it("rejects an unknown top-level field", () => {
    const result = HealthResponseSchema.safeParse({ ...ok, region: "eu" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
  });
});
