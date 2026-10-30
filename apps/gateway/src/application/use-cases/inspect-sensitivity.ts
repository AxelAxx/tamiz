/**
 * `InspectSensitivity` (spec 005 FR-008, FR-009, FR-015, research R-08, R-09).
 *
 * Asks the detector where the request's personal data is, under a timeout, with a cache
 * in front keyed by a hash of the message contents (the hash function is injected:
 * `main.ts` gives SHA-256). It never throws and never returns "clean" on doubt: a timeout,
 * an unreachable service or a contract mismatch is a failed inspection, which the
 * decision turns into the policy's `onDetectorError` action. Every outcome is a routing
 * event without content.
 */
import type { Inspection } from "../../domain/model/sensitivity.js";
import type { Milliseconds, RequestId } from "../../domain/model/units.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { DetectionCachePort } from "../ports/detection-cache.port.js";
import type { PiiDetectorPort } from "../ports/pii-detector.port.js";
import type { RoutingEventsPort } from "../ports/routing-events.port.js";

/** Bumped when what the detector is asked for changes, so old cache entries miss. */
export const DETECTION_OPTIONS_VERSION = "analyze-v1";

export interface InspectSensitivityDeps {
  readonly detector: PiiDetectorPort;
  readonly cache: DetectionCachePort;
  readonly clock: ClockPort;
  readonly events: RoutingEventsPort;
  readonly hash: (text: string) => string;
  readonly timeoutMs: Milliseconds;
}

export interface InspectionRequest {
  readonly requestId: RequestId;
  readonly messages: ReadonlyArray<string>;
  /** The client's signal: a disconnected client gets no further work. */
  readonly signal?: AbortSignal;
}

export type InspectSensitivity = (request: InspectionRequest) => Promise<Inspection>;

const TIMED_OUT: Inspection = { status: "failed", reason: "timeout" };
const NEVER = new Promise<never>(() => {});

export function cacheKey(hash: (text: string) => string, messages: ReadonlyArray<string>): string {
  return hash(`${DETECTION_OPTIONS_VERSION}\u0000${JSON.stringify(messages)}`);
}

export function inspectSensitivity(deps: InspectSensitivityDeps): InspectSensitivity {
  return async ({ requestId, messages, signal }) => {
    const key = cacheKey(deps.hash, messages);
    const cached = deps.cache.get(key);
    if (cached !== undefined) {
      emitInspected(deps, requestId, cached, true);
      return cached;
    }

    const call = new AbortController();
    const timer = new AbortController();
    const onClientAbort = () => call.abort();
    signal?.addEventListener("abort", onClientAbort, { once: true });
    const expired = deps.clock.sleep(deps.timeoutMs, timer.signal).then(
      () => TIMED_OUT,
      () => NEVER,
    );
    try {
      const inspection = await Promise.race([
        deps.detector.inspect(messages, call.signal),
        expired,
      ]);
      if (inspection === TIMED_OUT) call.abort();
      if (inspection.status === "ok") {
        deps.cache.set(key, inspection);
        emitInspected(deps, requestId, inspection, false);
      } else {
        deps.events.emit({
          type: "privacy.detector_failed",
          requestId,
          reason: inspection.reason,
          at: deps.clock.now().toISOString(),
        });
      }
      return inspection;
    } finally {
      timer.abort();
      signal?.removeEventListener("abort", onClientAbort);
    }
  };
}

function emitInspected(
  deps: InspectSensitivityDeps,
  requestId: RequestId,
  inspection: Extract<Inspection, { status: "ok" }>,
  cached: boolean,
): void {
  const counts: Record<string, number> = {};
  for (const entity of inspection.entities) counts[entity.kind] = (counts[entity.kind] ?? 0) + 1;
  deps.events.emit({
    type: "privacy.inspected",
    requestId,
    level: inspection.level,
    counts,
    cached,
    at: deps.clock.now().toISOString(),
  });
}
