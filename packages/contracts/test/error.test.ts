import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type ErrorEnvelope,
  ErrorEnvelopeSchema,
  type ErrorType,
  ErrorTypeSchema,
  errorTypeToHttpStatus,
  type RequestId,
} from "../src/index.js";

const errorTypes = [
  "invalid_request",
  "unauthorized",
  "not_found",
  "rate_limited",
  "provider_error",
  "policy_blocked",
  "internal",
] as const;

describe("ErrorEnvelopeSchema (spec US2-7, FR-010)", () => {
  it.each(errorTypes)("accepts error.type %s", (type) => {
    const result = ErrorEnvelopeSchema.safeParse({ error: { type, message: "boom" } });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expectTypeOf(result.data).toEqualTypeOf<ErrorEnvelope>();
    expect(result.data.error.type).toBe(type);
  });

  it("the enum holds exactly the seven documented values", () => {
    expect(ErrorTypeSchema.options).toEqual(errorTypes);
    expectTypeOf<ErrorType>().toEqualTypeOf<(typeof errorTypes)[number]>();
  });

  it("rejects an unknown error.type", () => {
    const result = ErrorEnvelopeSchema.safeParse({ error: { type: "teapot", message: "boom" } });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["error", "type"]);
  });

  it("accepts an optional requestId that is a valid RequestId and brands it", () => {
    const result = ErrorEnvelopeSchema.safeParse({
      error: { type: "not_found", message: "no such route", requestId: "req_01HXYZ-abc" },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expectTypeOf(result.data.error.requestId).toEqualTypeOf<RequestId | undefined>();
    expect(result.data.error.requestId).toBe("req_01HXYZ-abc");
  });

  it.each(["", "has space", "x".repeat(129), 42])(
    "rejects an invalid requestId: %j",
    (requestId) => {
      const result = ErrorEnvelopeSchema.safeParse({
        error: { type: "internal", message: "boom", requestId },
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(["error", "requestId"]);
    },
  );

  it("rejects a missing message and a non-string message", () => {
    expect(ErrorEnvelopeSchema.safeParse({ error: { type: "internal" } }).success).toBe(false);
    expect(ErrorEnvelopeSchema.safeParse({ error: { type: "internal", message: 1 } }).success).toBe(
      false,
    );
  });

  it("rejects unknown fields at both levels", () => {
    expect(
      ErrorEnvelopeSchema.safeParse({ error: { type: "internal", message: "boom" }, code: 1 })
        .success,
    ).toBe(false);
    expect(
      ErrorEnvelopeSchema.safeParse({
        error: { type: "internal", message: "boom", stack: "at main.ts:1" },
      }).success,
    ).toBe(false);
  });
});

describe("errorTypeToHttpStatus (data-model section 5)", () => {
  it("maps every error type to the documented HTTP status", () => {
    expect(errorTypeToHttpStatus).toEqual({
      invalid_request: 400,
      unauthorized: 401,
      not_found: 404,
      rate_limited: 429,
      policy_blocked: 451,
      provider_error: 502,
      internal: 500,
    });
  });

  it("covers exactly the enum values and is frozen", () => {
    expect(Object.keys(errorTypeToHttpStatus).sort()).toEqual([...errorTypes].sort());
    expect(Object.isFrozen(errorTypeToHttpStatus)).toBe(true);
    expectTypeOf(errorTypeToHttpStatus).toEqualTypeOf<Readonly<Record<ErrorType, number>>>();
  });
});
