/**
 * Routing and privacy events as span events (spec 006 FR-009, research R-09, R-10).
 *
 * Each event lands on the active span: the request span, or the attempt span for what
 * happens inside an attempt (a circuit opening on its failure). Attempt start and end are
 * the attempt spans themselves, so they are not repeated as events, and `audit.dropped`
 * belongs to no request. Like the log sink, only declared fields are copied, and none of
 * them can hold content: ids, enums, counts and durations.
 */
import { type Attributes, trace } from "@opentelemetry/api";
import type {
  RoutingEvent,
  RoutingEventsPort,
} from "../../application/ports/routing-events.port.js";

function spanEvent(event: RoutingEvent): [string, Attributes] | undefined {
  switch (event.type) {
    case "attempt.started":
    case "attempt.succeeded":
    case "attempt.failed":
    case "audit.dropped":
      return undefined;
    case "fallback":
      return ["routing.fallback", { target: event.targetId, reason: event.reason }];
    case "retry.scheduled":
      return [
        "routing.retry",
        {
          target: event.targetId,
          attempt: event.attempt,
          wait_ms: event.waitMs,
          reason: event.reason,
        },
      ];
    case "target.skipped":
      return ["routing.target_skipped", { target: event.targetId, reason: event.reason }];
    case "residency.blocked":
      return [
        "routing.residency_blocked",
        { target: event.targetId, residency: event.residency, allowed: [...event.allowed] },
      ];
    case "circuit.changed":
      return ["circuit.changed", { target: event.targetId, from: event.from, to: event.to }];
    case "stream.failed":
      return ["stream.failed", { target: event.targetId, reason: event.reason }];
    case "privacy.inspected":
      return [
        "privacy.inspected",
        {
          level: event.level,
          cached: event.cached,
          ...Object.fromEntries(
            Object.entries(event.counts).map(([kind, count]) => [`count.${kind}`, count ?? 0]),
          ),
        },
      ];
    case "privacy.detector_failed":
      return ["privacy.detector_failed", { reason: event.reason }];
    case "privacy.action":
      return [
        "privacy.action",
        { sensitivity: event.sensitivity, action: event.action, rule: event.ruleId },
      ];
    case "privacy.anonymized":
      return ["privacy.anonymized", { placeholders: event.placeholders }];
  }
}

export function createOtelRoutingEvents(): RoutingEventsPort {
  return {
    emit(event) {
      const span = trace.getActiveSpan();
      if (span === undefined || !span.isRecording()) return;
      const mapped = spanEvent(event);
      if (mapped !== undefined) span.addEvent(mapped[0], mapped[1]);
    },
  };
}
