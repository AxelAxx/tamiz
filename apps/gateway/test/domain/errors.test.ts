import { describe, expect, it } from "vitest";
import {
  assertNever,
  type DomainError,
  PROVIDER_ERROR_CAUSES,
  providerError,
  providerUnavailableError,
  residencyViolationError,
  unauthorizedError,
} from "../../src/domain/errors.js";
import {
  millisecondsUnchecked,
  ruleIdUnchecked,
  targetIdUnchecked,
} from "../../src/domain/model/units.js";

// Spec 002 FR-013 (tasks.md T017): `DomainError` gains `provider` and `unauthorized`.

function describeKind(error: DomainError): string {
  switch (error.kind) {
    case "validation":
      return "validation";
    case "configuration":
      return "configuration";
    case "not_found":
      return "not_found";
    case "provider":
      return `provider:${error.cause}`;
    case "unauthorized":
      return "unauthorized";
    case "residency_violation":
      return `residency_violation:${error.residency}`;
    case "provider_unavailable":
      return `provider_unavailable:${error.retryAfterMs}`;
    default:
      return assertNever(error);
  }
}

describe("providerError", () => {
  it("keeps target, provider, cause, retryable, message and status", () => {
    const error = providerError({
      targetId: targetIdUnchecked("mistral-small"),
      provider: "mistral",
      cause: "rate_limited",
      retryable: true,
      message: "Upstream rate limit",
      status: 429,
    });

    expect(error).toEqual({
      kind: "provider",
      targetId: "mistral-small",
      provider: "mistral",
      cause: "rate_limited",
      retryable: true,
      message: "Upstream rate limit",
      status: 429,
    });
  });

  it("leaves `status` absent when it is not given", () => {
    const error = providerError({
      targetId: targetIdUnchecked("ollama-llama"),
      provider: "ollama",
      cause: "timeout",
      retryable: true,
      message: "Timed out",
    });

    expect("status" in error).toBe(false);
    expect(error.retryable).toBe(true);
  });

  it("preserves a non-retryable flag", () => {
    const error = providerError({
      targetId: targetIdUnchecked("openai-mini"),
      provider: "openai",
      cause: "authentication",
      retryable: false,
      message: "Upstream rejected the credential",
      status: 401,
    });

    expect(error.retryable).toBe(false);
    expect(error.status).toBe(401);
  });

  it("closes the cause list to the six FR-013 values plus spec 003's `aborted`", () => {
    expect(PROVIDER_ERROR_CAUSES).toEqual([
      "http_error",
      "timeout",
      "network",
      "malformed_response",
      "rate_limited",
      "authentication",
      "aborted",
    ]);
  });
});

describe("unauthorizedError", () => {
  it("builds the unauthorized variant", () => {
    expect(unauthorizedError("Missing API key")).toEqual({
      kind: "unauthorized",
      message: "Missing API key",
    });
  });
});

describe("DomainError union", () => {
  it("an exhaustive switch over the five kinds compiles and handles each", () => {
    const errors: ReadonlyArray<DomainError> = [
      { kind: "validation", message: "v", issues: [] },
      { kind: "configuration", message: "c", issues: [] },
      { kind: "not_found", message: "n", resource: "r" },
      providerError({
        targetId: targetIdUnchecked("t"),
        provider: "anthropic",
        cause: "network",
        retryable: true,
        message: "p",
      }),
      unauthorizedError("u"),
    ];

    expect(errors.map(describeKind)).toEqual([
      "validation",
      "configuration",
      "not_found",
      "provider:network",
      "unauthorized",
    ]);
  });
});

describe("spec 003 error kinds (FR-013, FR-015, R-13)", () => {
  it("residencyViolationError names the rule, the target and its residency, nothing else", () => {
    const error = residencyViolationError({
      ruleId: ruleIdUnchecked("long-documents-eu"),
      targetId: targetIdUnchecked("openai-mini"),
      residency: "us",
      allowed: ["eu", "local"],
    });

    expect(error).toEqual({
      kind: "residency_violation",
      ruleId: "long-documents-eu",
      targetId: "openai-mini",
      residency: "us",
      allowed: ["eu", "local"],
      message: "rule long-documents-eu does not allow residency us (target openai-mini)",
    });
    expect(describeKind(error)).toBe("residency_violation:us");
  });

  it("providerUnavailableError carries the retry hint", () => {
    const error = providerUnavailableError(millisecondsUnchecked(12_000));

    expect(error.kind).toBe("provider_unavailable");
    expect(error.retryAfterMs).toBe(12_000);
    expect(describeKind(error)).toBe("provider_unavailable:12000");
  });
});
