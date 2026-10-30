/**
 * Maps failures to the `ErrorEnvelope` contract (spec FR-019, data-model section 5).
 *
 * The message is always a short, safe sentence: no stack traces, no prompt content.
 * `requestId` is only attached when it satisfies the `RequestId` contract. Spec 002
 * FR-027: a provider timeout is `provider_timeout` (504), any other provider failure
 * `provider_error` (502); validation issues become one message of paths and expected
 * formats, never the offending values.
 */
import {
  type ErrorEnvelope,
  ErrorEnvelopeSchema,
  type ErrorType,
  errorTypeToHttpStatus,
  safeRequestId,
} from "@tamiz/contracts";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { assertNever, type DomainError } from "../../domain/errors.js";

export function toErrorEnvelope(
  type: ErrorType,
  message: string,
  requestId?: string,
): ErrorEnvelope {
  const parsedId = requestId === undefined ? undefined : safeRequestId(requestId);
  const envelope: ErrorEnvelope = {
    error:
      parsedId?.success === true ? { type, message, requestId: parsedId.data } : { type, message },
  };
  return ErrorEnvelopeSchema.parse(envelope);
}

/** The HTTP status the gateway answers with for an error type. */
export function httpStatusFor(type: ErrorType): ContentfulStatusCode {
  return errorTypeToHttpStatus[type] as ContentfulStatusCode;
}

export function domainErrorToErrorType(error: DomainError): ErrorType {
  switch (error.kind) {
    case "validation":
      return "invalid_request";
    case "not_found":
      return "not_found";
    case "configuration":
      return "internal";
    case "provider":
      return error.cause === "timeout" ? "provider_timeout" : "provider_error";
    case "unauthorized":
      return "unauthorized";
    default:
      return assertNever(error);
  }
}

export function domainErrorToEnvelope(error: DomainError, requestId?: string): ErrorEnvelope {
  return toErrorEnvelope(domainErrorToErrorType(error), error.message, requestId);
}

/** A Zod-style issue: where and what was expected. Zod's own messages carry no input values. */
export interface IssueLike {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

/** One `path: message` clause per issue, joined with `; `; the root is called `body`. */
export function fromZodIssues(issues: ReadonlyArray<IssueLike>): string {
  return issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return `${path === "" ? "body" : path}: ${issue.message}`;
    })
    .join("; ");
}
