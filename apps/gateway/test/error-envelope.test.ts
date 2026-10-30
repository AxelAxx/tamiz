import { describe, expect, it } from "vitest";
import {
  configurationError,
  notFoundError,
  providerError,
  providerUnavailableError,
  residencyViolationError,
  unauthorizedError,
  validationError,
} from "../src/domain/errors.js";
import { millisecondsUnchecked, targetIdUnchecked } from "../src/domain/model/units.js";
import {
  domainErrorToErrorType,
  fromZodIssues,
} from "../src/presentation/mappers/error-envelope.js";

// The two `DomainError` variants of spec 002 FR-013 keep the mapper exhaustive; FR-027
// (tasks.md T058) maps a provider timeout to `provider_timeout` (504).

describe("domainErrorToErrorType", () => {
  it("maps a provider error to provider_error", () => {
    const error = providerError({
      targetId: targetIdUnchecked("mistral-small"),
      provider: "mistral",
      cause: "http_error",
      retryable: true,
      message: "Upstream returned 500",
      status: 500,
    });

    expect(domainErrorToErrorType(error)).toBe("provider_error");
  });

  it("maps a provider timeout to provider_timeout (FR-027)", () => {
    const error = providerError({
      targetId: targetIdUnchecked("mistral-small"),
      provider: "mistral",
      cause: "timeout",
      retryable: true,
      message: "provider call timed out",
    });

    expect(domainErrorToErrorType(error)).toBe("provider_timeout");
  });

  it("spec 003: aborted (deadline) → provider_timeout; residency → policy_blocked; unavailable → provider_unavailable", () => {
    expect(
      domainErrorToErrorType(
        providerError({
          targetId: targetIdUnchecked("mistral-small"),
          provider: "mistral",
          cause: "aborted",
          retryable: false,
          message: "request deadline reached",
        }),
      ),
    ).toBe("provider_timeout");
    expect(
      domainErrorToErrorType(
        residencyViolationError({
          ruleId: "default",
          targetId: targetIdUnchecked("openai-mini"),
          residency: "us",
          allowed: ["eu"],
        }),
      ),
    ).toBe("policy_blocked");
    expect(domainErrorToErrorType(providerUnavailableError(millisecondsUnchecked(1_000)))).toBe(
      "provider_unavailable",
    );
  });

  it("keeps the feature 001 mappings", () => {
    expect(domainErrorToErrorType(validationError("v", []))).toBe("invalid_request");
    expect(domainErrorToErrorType(configurationError("c", []))).toBe("internal");
    expect(domainErrorToErrorType(notFoundError("n", "route"))).toBe("not_found");
  });

  it("maps unauthorized to unauthorized", () => {
    expect(domainErrorToErrorType(unauthorizedError("Missing API key"))).toBe("unauthorized");
  });
});

describe("fromZodIssues (FR-027)", () => {
  it("joins path: message clauses and names the root body", () => {
    expect(
      fromZodIssues([
        { path: ["messages"], message: "Too small: expected array to have >=1 items" },
        { path: ["messages", 0, "role"], message: "Invalid option" },
        { path: [], message: 'Unrecognized key: "tools"' },
      ]),
    ).toBe(
      'messages: Too small: expected array to have >=1 items; messages.0.role: Invalid option; body: Unrecognized key: "tools"',
    );
  });
});
