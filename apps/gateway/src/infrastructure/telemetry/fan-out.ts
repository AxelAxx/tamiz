/**
 * Several routing-event sinks behind one port (spec 006 research R-09, constitution IX).
 *
 * A sink that throws is skipped for that event: `emit` is fire-and-forget and must never
 * fail the request.
 */
import type { RoutingEventsPort } from "../../application/ports/routing-events.port.js";

export function fanOut(...sinks: ReadonlyArray<RoutingEventsPort>): RoutingEventsPort {
  return {
    emit(event) {
      for (const sink of sinks) {
        try {
          sink.emit(event);
        } catch {
          // Constitution VI is kept by the other sinks; one broken sink stays local.
        }
      }
    },
  };
}
