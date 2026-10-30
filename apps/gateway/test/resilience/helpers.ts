import type {
  RoutingEvent,
  RoutingEventsPort,
  TargetEvent,
} from "../../src/application/ports/routing-events.port.js";
import {
  type ProviderError,
  type ProviderErrorCause,
  providerError,
} from "../../src/domain/errors.js";
import type { ModelTarget } from "../../src/domain/model/model-target.js";
import {
  millisecondsUnchecked,
  requestIdUnchecked,
  targetIdUnchecked,
  usdUnchecked,
} from "../../src/domain/model/units.js";

export const REQUEST_ID = requestIdUnchecked("req-resilience");

export function target(id = "mistral-small"): ModelTarget {
  return {
    id: targetIdUnchecked(id),
    provider: "mistral",
    model: "mistral-small-latest",
    region: "eu-west",
    residency: "eu",
    pricing: { inputUsdPerMillion: usdUnchecked(0.1), outputUsdPerMillion: usdUnchecked(0.3) },
  };
}

const RETRYABLE: ReadonlySet<ProviderErrorCause> = new Set(["rate_limited", "timeout", "network"]);

/** A provider error as an adapter would return it; `http_error` is retryable when `status ≥ 500`. */
export function failure(
  cause: ProviderErrorCause,
  options: { status?: number; retryAfterMs?: number; on?: ModelTarget } = {},
): ProviderError {
  const on = options.on ?? target();
  const retryable =
    RETRYABLE.has(cause) || (cause === "http_error" && (options.status ?? 500) >= 500);
  return providerError({
    targetId: on.id,
    provider: on.provider,
    cause,
    retryable,
    message: `scripted ${cause}`,
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.retryAfterMs === undefined
      ? {}
      : { retryAfterMs: millisecondsUnchecked(options.retryAfterMs) }),
  });
}

/** Records every emitted event in order; `targetEvents` keeps those about a target. */
export function recordingEvents(): RoutingEventsPort & {
  readonly all: RoutingEvent[];
  readonly events: TargetEvent[];
} {
  const all: RoutingEvent[] = [];
  const events: TargetEvent[] = [];
  return {
    all,
    events,
    emit: (event) => {
      all.push(event);
      if ("targetId" in event) events.push(event);
    },
  };
}

/** A deterministic `random`: returns the given values in turn, repeating the last one. */
export function sequence(...values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}
