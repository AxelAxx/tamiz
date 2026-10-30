import { describe, expect, it } from "vitest";
import {
  configurationError,
  notFoundError,
  providerError,
  unauthorizedError,
  validationError,
} from "../src/domain/errors.js";
import { targetIdUnchecked } from "../src/domain/model/units.js";
import { domainErrorToErrorType } from "../src/presentation/mappers/error-envelope.js";

// The two `DomainError` variants of spec 002 FR-013 keep the mapper exhaustive. The
// `timeout` → `provider_timeout` (504) case arrives with T-002-06 (tasks.md T058).

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

  it("keeps the feature 001 mappings", () => {
    expect(domainErrorToErrorType(validationError("v", []))).toBe("invalid_request");
    expect(domainErrorToErrorType(configurationError("c", []))).toBe("internal");
    expect(domainErrorToErrorType(notFoundError("n", "route"))).toBe("not_found");
  });

  it("maps unauthorized to unauthorized", () => {
    expect(domainErrorToErrorType(unauthorizedError("Missing API key"))).toBe("unauthorized");
  });
});
