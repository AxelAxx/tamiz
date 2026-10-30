/**
 * Retries one target's attempts with exponential backoff and full jitter (spec 003
 * FR-003, FR-004, US3, research R-02).
 *
 * Only failures marked retryable are retried. The wait before retry `n` is
 * `random() × min(maxDelayMs, baseDelayMs × 2^(n-1))`, raised to an upstream retry-after
 * hint (capped by `maxDelayMs`); a wait that would end at or after the request deadline
 * is not started and the result is `aborted` ("request deadline reached"). Waiting goes
 * through the clock port and randomness is injected, so tests are deterministic and
 * never wait in real time. Each wait is announced as a `retry.scheduled` event.
 */
import { type ProviderError, providerError } from "../../domain/errors.js";
import type { ModelTarget } from "../../domain/model/model-target.js";
import type { Milliseconds, RequestId } from "../../domain/model/units.js";
import { err, type Result } from "../../domain/result.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { RoutingEventsPort } from "../ports/routing-events.port.js";

export interface RetrySettings {
  /** Attempts per target, including the first. */
  readonly maxAttempts: number;
  readonly baseDelayMs: Milliseconds;
  readonly maxDelayMs: Milliseconds;
}

export interface RetryDeps {
  readonly clock: ClockPort;
  /** Uniform in `[0, 1)`; `Math.random` in production, a fixed sequence in tests. */
  readonly random: () => number;
  readonly events: RoutingEventsPort;
  readonly settings: RetrySettings;
}

export interface RetryContext {
  readonly requestId: RequestId;
  readonly target: ModelTarget;
  /** No wait or attempt starts at or after this instant. */
  readonly deadline: Date;
  /** Aborts a wait in progress (client disconnect). */
  readonly signal?: AbortSignal;
}

/** One attempt, numbered from 1. */
export type Attempt<T> = (attempt: number) => Promise<Result<T, ProviderError>>;

function aborted(target: ModelTarget, message: string): ProviderError {
  return providerError({
    targetId: target.id,
    provider: target.provider,
    cause: "aborted",
    retryable: false,
    message,
  });
}

/** Full jitter: uniform in `[0, min(maxDelay, base × 2^(n-1))]`, in whole milliseconds. */
export function backoffMs(settings: RetrySettings, retry: number, random: number): number {
  const cap = Math.min(settings.maxDelayMs, settings.baseDelayMs * 2 ** (retry - 1));
  return Math.floor(random * cap);
}

export function withRetry<T>(deps: RetryDeps) {
  return async (context: RetryContext, attempt: Attempt<T>): Promise<Result<T, ProviderError>> => {
    const { target } = context;
    for (let n = 1; ; n += 1) {
      const result = await attempt(n);
      if (result.ok || !result.error.retryable || n >= deps.settings.maxAttempts) return result;

      const jittered = backoffMs(deps.settings, n, deps.random());
      const hint = result.error.retryAfterMs;
      const waitMs =
        hint === undefined
          ? jittered
          : Math.max(jittered, Math.min(hint, deps.settings.maxDelayMs));
      const now = deps.clock.now();
      if (now.getTime() + waitMs >= context.deadline.getTime()) {
        return err(aborted(target, "request deadline reached"));
      }

      deps.events.emit({
        type: "retry.scheduled",
        requestId: context.requestId,
        targetId: target.id,
        provider: target.provider,
        residency: target.residency,
        at: now.toISOString(),
        attempt: n,
        waitMs,
        reason: result.error.cause,
      });
      try {
        await deps.clock.sleep(waitMs as Milliseconds, context.signal);
      } catch {
        return err(aborted(target, "provider call aborted"));
      }
    }
  };
}
