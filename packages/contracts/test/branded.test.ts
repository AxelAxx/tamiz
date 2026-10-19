import { describe, expect, it } from "vitest";
import {
  MillisecondsSchema,
  milliseconds,
  PolicyIdSchema,
  policyId,
  RequestIdSchema,
  requestId,
  safeMilliseconds,
  safePolicyId,
  safeRequestId,
  safeUsd,
  UsdSchema,
  usd,
} from "../src/index.js";

describe("branded constructors (data-model section 1, FR-011)", () => {
  describe("requestId", () => {
    it("returns the value for a valid id", () => {
      expect(requestId("req_01HXYZ-abc")).toBe("req_01HXYZ-abc");
      expect(requestId("a".repeat(128))).toBe("a".repeat(128));
    });

    it("throws on an empty string", () => {
      expect(() => requestId("")).toThrow();
    });

    it("throws on a value longer than 128 characters", () => {
      expect(() => requestId("a".repeat(129))).toThrow();
    });

    it("throws on characters outside [A-Za-z0-9_-]", () => {
      expect(() => requestId("bad id")).toThrow();
      expect(() => requestId("req/1")).toThrow();
      expect(() => requestId("réq")).toThrow();
    });

    it("safeRequestId returns success: false with the issue instead of throwing", () => {
      const result = safeRequestId("bad id");
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.code).toBe("invalid_format");
    });

    it("safeRequestId returns success: true for a valid id", () => {
      const result = safeRequestId("ok-1");
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toBe("ok-1");
    });

    it("safeRequestId rejects non-strings", () => {
      expect(safeRequestId(42).success).toBe(false);
      expect(safeRequestId(undefined).success).toBe(false);
    });
  });

  describe("policyId", () => {
    it("accepts up to 64 characters of the same charset", () => {
      expect(policyId("default-v1")).toBe("default-v1");
      expect(policyId("p".repeat(64))).toBe("p".repeat(64));
    });

    it("throws on empty, too long or badly formed values", () => {
      expect(() => policyId("")).toThrow();
      expect(() => policyId("p".repeat(65))).toThrow();
      expect(() => policyId("default v1")).toThrow();
    });

    it("safePolicyId mirrors the constructor", () => {
      expect(safePolicyId("ok").success).toBe(true);
      expect(safePolicyId("p".repeat(65)).success).toBe(false);
    });
  });

  describe("usd", () => {
    it("accepts zero and positive finite numbers, including fractions", () => {
      expect(usd(0)).toBe(0);
      expect(usd(0.000123)).toBe(0.000123);
      expect(usd(12.5)).toBe(12.5);
    });

    it("throws on negative values", () => {
      expect(() => usd(-1)).toThrow();
      expect(() => usd(-0.01)).toThrow();
    });

    it("throws on non-finite values", () => {
      expect(() => usd(Number.POSITIVE_INFINITY)).toThrow();
      expect(() => usd(Number.NaN)).toThrow();
    });

    it("safeUsd mirrors the constructor", () => {
      expect(safeUsd(1.25).success).toBe(true);
      expect(safeUsd(-1).success).toBe(false);
      expect(safeUsd("1").success).toBe(false);
    });
  });

  describe("milliseconds", () => {
    it("accepts zero and positive integers", () => {
      expect(milliseconds(0)).toBe(0);
      expect(milliseconds(1_500)).toBe(1_500);
    });

    it("throws on a non-integer", () => {
      expect(() => milliseconds(1.5)).toThrow();
    });

    it("throws on negative or non-finite values", () => {
      expect(() => milliseconds(-1)).toThrow();
      expect(() => milliseconds(Number.POSITIVE_INFINITY)).toThrow();
      expect(() => milliseconds(Number.NaN)).toThrow();
    });

    it("safeMilliseconds mirrors the constructor", () => {
      expect(safeMilliseconds(10).success).toBe(true);
      expect(safeMilliseconds(1.5).success).toBe(false);
    });
  });

  describe("schemas are exported for composition", () => {
    it("parse the same values as the constructors", () => {
      expect(RequestIdSchema.safeParse("ok").success).toBe(true);
      expect(PolicyIdSchema.safeParse("ok").success).toBe(true);
      expect(UsdSchema.safeParse(1).success).toBe(true);
      expect(MillisecondsSchema.safeParse(1).success).toBe(true);
    });
  });
});
