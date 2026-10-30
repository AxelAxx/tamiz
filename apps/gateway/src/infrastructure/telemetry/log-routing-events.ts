/**
 * The default `RoutingEventsPort` sink: one structured log line per event (spec 003
 * FR-018, US5-4, research R-12). Feature 006 adds trace, metric and audit sinks.
 *
 * Only the fields the event type declares are copied, so a property smuggled onto an
 * event object never reaches the log (US5-3). Steps an operator should notice (a circuit
 * opening, a residency block, a stream failing mid-answer) are `warn`; the rest `info`.
 */
import type { LoggerPort } from "../../application/ports/logger.port.js";
import type {
  RoutingEvent,
  RoutingEventsPort,
} from "../../application/ports/routing-events.port.js";

/** Every field a routing event may carry besides `type`. */
const FIELDS = [
  "requestId",
  "targetId",
  "provider",
  "residency",
  "at",
  "attempt",
  "durationMs",
  "waitMs",
  "reason",
  "allowed",
  "from",
  "to",
  "level",
  "counts",
  "cached",
  "sensitivity",
  "action",
  "ruleId",
  "placeholders",
] as const;

function isNotable(event: RoutingEvent): boolean {
  switch (event.type) {
    case "residency.blocked":
    case "stream.failed":
    case "privacy.detector_failed":
      return true;
    case "circuit.changed":
      return event.to === "open";
    default:
      return false;
  }
}

export function createLogRoutingEvents(logger: LoggerPort): RoutingEventsPort {
  return {
    emit(event) {
      const source = event as unknown as Readonly<Record<string, unknown>>;
      const bindings: Record<string, unknown> = { event: event.type };
      for (const field of FIELDS) {
        if (source[field] !== undefined) bindings[field] = source[field];
      }
      // A sink must never throw into the request (routing-events port contract).
      try {
        // Called on the logger, not detached: pino's methods need their \`this\`.
        if (isNotable(event)) logger.warn(bindings, "routing event");
        else logger.info(bindings, "routing event");
      } catch {
        // Losing one log line is better than failing the request it describes.
      }
    },
  };
}
