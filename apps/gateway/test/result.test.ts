import { describe, expect, it } from "vitest";
import {
  assertNever,
  configurationError,
  type DomainError,
  notFoundError,
  validationError,
} from "../src/domain/errors.js";
import {
  andThen,
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  type Result,
  unwrapOr,
} from "../src/domain/result.js";

// Spec 001, FR-014: Result<T, E> helpers and the DomainError discriminated union.

describe("Result", () => {
  it("ok() builds a success that isOk recognises", () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
  });

  it("err() builds a failure that isErr recognises", () => {
    const result = err("boom");
    expect(result).toEqual({ ok: false, error: "boom" });
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
  });

  it("map transforms the value and leaves an error untouched", () => {
    const double = (n: number) => n * 2;
    expect(map(ok(2), double)).toEqual(ok(4));
    const failure: Result<number, string> = err("no");
    expect(map(failure, double)).toEqual(err("no"));
  });

  it("mapErr transforms the error and leaves a value untouched", () => {
    const upper = (e: string) => e.toUpperCase();
    expect(mapErr(err("no"), upper)).toEqual(err("NO"));
    const success: Result<number, string> = ok(1);
    expect(mapErr(success, upper)).toEqual(ok(1));
  });

  it("andThen chains a function that itself returns a Result", () => {
    const parsePositive = (n: number): Result<number, string> =>
      n > 0 ? ok(n) : err("not positive");
    expect(andThen(ok(3), parsePositive)).toEqual(ok(3));
    expect(andThen(ok(-1), parsePositive)).toEqual(err("not positive"));
    const failure: Result<number, string> = err("upstream");
    expect(andThen(failure, parsePositive)).toEqual(err("upstream"));
  });

  it("unwrapOr returns the value or the fallback", () => {
    expect(unwrapOr(ok("v"), "fallback")).toBe("v");
    const failure: Result<string, string> = err("x");
    expect(unwrapOr(failure, "fallback")).toBe("fallback");
  });

  it("narrows the type through isOk / isErr guards", () => {
    const parsePositive = (n: number): Result<number, string> =>
      n > 0 ? ok(n) : err("not positive");
    const results = [parsePositive(7), parsePositive(-1)];
    const seen: string[] = [];
    for (const result of results) {
      if (isOk(result)) {
        seen.push(`value:${result.value + 1}`);
      } else {
        seen.push(`error:${result.error.toUpperCase()}`);
      }
    }
    expect(seen).toEqual(["value:8", "error:NOT POSITIVE"]);
  });
});

describe("DomainError", () => {
  const describeError = (error: DomainError): string => {
    switch (error.kind) {
      case "validation":
        return `validation:${error.issues.length}`;
      case "configuration":
        return `configuration:${error.issues.length}`;
      case "not_found":
        return `not_found:${error.resource}`;
      case "provider":
        return `provider:${error.cause}`;
      case "unauthorized":
        return "unauthorized";
      case "residency_violation":
        return `residency_violation:${error.targetId}`;
      case "provider_unavailable":
        return "provider_unavailable";
      default:
        return assertNever(error);
    }
  };

  it("constructors set the discriminant and their fields", () => {
    const validation = validationError("bad input", [{ path: "model", message: "required" }]);
    expect(validation.kind).toBe("validation");
    expect(validation.message).toBe("bad input");
    expect(validation.issues).toEqual([{ path: "model", message: "required" }]);

    const configuration = configurationError("bad env", [{ path: "PORT", message: "integer" }]);
    expect(configuration.kind).toBe("configuration");
    expect(configuration.issues).toHaveLength(1);

    const notFound = notFoundError("missing", "policy");
    expect(notFound.kind).toBe("not_found");
    expect(notFound.resource).toBe("policy");
  });

  it("supports an exhaustive switch over kind", () => {
    expect(describeError(validationError("v", []))).toBe("validation:0");
    expect(describeError(configurationError("c", [{ path: "a", message: "b" }]))).toBe(
      "configuration:1",
    );
    expect(describeError(notFoundError("n", "route"))).toBe("not_found:route");
  });

  it("assertNever throws when reached at runtime", () => {
    expect(() => assertNever("unexpected" as never)).toThrow(/unexpected/);
  });
});
