/**
 * One audit entry per request, written at its end (spec 006 FR-001 … FR-004, research R-01).
 *
 * `withAudit` and `withAuditStream` wrap the inference use cases. They see the whole result
 * (answer, chain failure or block) and, for streams, every part until the finish, an error
 * part or the client going away, so each request yields exactly one entry whatever its
 * outcome. The entry is built by the pure `auditEntry` and handed to the port without
 * waiting; nothing the audit does can fail or delay the request.
 *
 * Tool calling (009 tool-calling FR-018): the entry counts the declared tools and the tool
 * messages and lists the names of the tools the model called; the request hash covers the
 * messages (tool calls and results included) and the tool definitions.
 */

import type { ProviderError } from "../../domain/errors.js";
import {
  type AuditErrorType,
  type AuditResult,
  auditEntry,
  auditTools,
} from "../../domain/model/audit-entry.js";
import { baselineTarget } from "../../domain/model/baseline.js";
import type { Usage } from "../../domain/model/cost.js";
import type { InferenceRequest } from "../../domain/model/inference-request.js";
import type { Decision } from "../../domain/model/routing-decision.js";
import type { AuditLogPort } from "../ports/audit-log.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { LoggerPort } from "../ports/logger.port.js";
import type { PolicyRepositoryPort } from "../ports/policy-repository.port.js";
import type { RouteInference, RoutingFailure } from "../use-cases/route-inference.js";
import type { RoutedStreamPart, StreamInference } from "../use-cases/stream-inference.js";

export interface AuditDeps {
  readonly audit: AuditLogPort;
  readonly clock: ClockPort;
  readonly policies: PolicyRepositoryPort;
  /**
   * Keyed hash of the messages and tool definitions (HMAC-SHA-256 in production, spec 006
   * research R-03).
   */
  readonly hash: (parts: ReadonlyArray<unknown>) => string;
  readonly newId: () => string;
  /** Where a failure to build an entry is reported; the request is never affected. */
  readonly logger?: LoggerPort;
}

function providerErrorType(error: ProviderError): AuditErrorType {
  return error.cause === "timeout" || error.cause === "aborted"
    ? "provider_timeout"
    : "provider_error";
}

/** What a failed request looks like in the audit. */
export function failureResult(routing: RoutingFailure): AuditResult {
  if (routing.failure.kind === "blocked") {
    const reason = routing.failure.error.reason;
    return {
      kind: "blocked",
      reason,
      errorType: reason === "detector_unavailable" ? "privacy_unavailable" : "policy_blocked",
      abandoned: [],
    };
  }
  const { failure } = routing;
  switch (failure.kind) {
    case "residency":
      return {
        kind: "blocked",
        reason: "residency",
        errorType: "policy_blocked",
        target: failure.target,
        abandoned: failure.abandoned,
      };
    case "unavailable":
      return {
        kind: "failed",
        target: failure.target,
        abandoned: failure.abandoned,
        errorType: "provider_unavailable",
      };
    case "deadline":
      return {
        kind: "failed",
        target: failure.target,
        abandoned: failure.abandoned,
        errorType: "provider_timeout",
      };
    case "exhausted":
      return {
        kind: "failed",
        target: failure.target,
        abandoned: failure.abandoned,
        errorType: providerErrorType(failure.error),
      };
  }
}

function recorder(deps: AuditDeps) {
  return async (
    request: InferenceRequest,
    startedAt: Date,
    decision: Decision,
    result: AuditResult,
    streamed: boolean,
    called: ReadonlyArray<string> = [],
  ): Promise<void> => {
    try {
      const policy = await deps.policies.getActive();
      const baseline = baselineTarget(policy.targets);
      const tools = auditTools(request, called);
      deps.audit.append(
        auditEntry({
          id: deps.newId(),
          requestId: request.requestId,
          clientId: request.clientId,
          startedAt,
          endedAt: deps.clock.now(),
          requestHash: deps.hash([...request.messages, ...(request.tools ?? [])]),
          decision,
          streamed,
          result,
          ...(tools === undefined ? {} : { tools }),
          ...(baseline === undefined ? {} : { baseline }),
        }),
      );
    } catch {
      // Constitution VI: visible, but never at the request's expense.
      deps.logger?.warn({ requestId: request.requestId }, "audit entry not recorded");
    }
  };
}

export function withAudit(route: RouteInference, deps: AuditDeps): RouteInference {
  const record = recorder(deps);
  return async (request) => {
    const startedAt = deps.clock.now();
    const result = await route(request);
    const audited: AuditResult = result.ok
      ? {
          kind: "answered",
          target: result.value.target,
          abandoned: result.value.abandoned,
          usage: result.value.usage,
          cost: result.value.cost,
          ...(result.value.noticeVersion === undefined
            ? {}
            : { noticeVersion: result.value.noticeVersion }),
        }
      : failureResult(result.error);
    void record(
      request,
      startedAt,
      result.ok ? result.value.decision : result.error.decision,
      audited,
      false,
      result.ok ? (result.value.completion.toolCalls ?? []).map((call) => call.name) : [],
    );
    return result;
  };
}

export function withAuditStream(stream: StreamInference, deps: AuditDeps): StreamInference {
  const record = recorder(deps);
  return async (request, signal) => {
    const startedAt = deps.clock.now();
    const result = await stream(request, signal);
    if (!result.ok) {
      void record(request, startedAt, result.error.decision, failureResult(result.error), true);
      return result;
    }
    const routed = result.value;

    async function* audited(): AsyncGenerator<RoutedStreamPart> {
      let ending: { kind: "answered" | "cancelled" | "failed"; errorType?: AuditErrorType } = {
        kind: "cancelled",
      };
      let usage: Usage | undefined;
      let cost: number | undefined;
      const called: string[] = [];
      try {
        for await (const part of routed.parts) {
          if (part.type === "tool-call-start") {
            called.push(part.name);
          } else if (part.type === "finish") {
            ending = { kind: "answered" };
            usage = part.usage;
            cost = part.cost;
          } else if (part.type === "error") {
            ending =
              part.error.cause === "aborted"
                ? { kind: "cancelled" }
                : { kind: "failed", errorType: providerErrorType(part.error) };
          }
          yield part;
        }
      } finally {
        const common = {
          target: routed.target,
          abandoned: routed.abandoned,
          ...(usage === undefined ? {} : { usage }),
          ...(cost === undefined ? {} : { cost }),
          ...(routed.noticeVersion === undefined ? {} : { noticeVersion: routed.noticeVersion }),
        };
        const final: AuditResult =
          ending.kind === "failed"
            ? { kind: "failed", errorType: ending.errorType ?? "provider_error", ...common }
            : { kind: ending.kind, ...common };
        void record(request, startedAt, routed.decision, final, true, called);
      }
    }

    return { ok: true, value: { ...routed, parts: audited() } };
  };
}
