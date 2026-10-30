/**
 * Bounds one provider attempt in time through the clock port (spec 003 FR-001, FR-005,
 * research R-02, R-03).
 *
 * The adapters also bound the real network call with their own timeout (feature 002);
 * this wrapper is the testable bound of the application and the place where the request
 * deadline and client disconnects reach the attempt. On expiry the attempt's signal is
 * aborted and a retryable `timeout` is returned; an outer abort returns `aborted`, which
 * is never retried.
 */
import { type ProviderError, providerError } from "../../domain/errors.js";
import type { ModelTarget } from "../../domain/model/model-target.js";
import type { Milliseconds } from "../../domain/model/units.js";
import { err, type Result } from "../../domain/result.js";
import type { ClockPort } from "../ports/clock.port.js";

export type TimedRun<T> = (signal: AbortSignal) => Promise<Result<T, ProviderError>>;

function failure(target: ModelTarget, cause: "timeout" | "aborted"): ProviderError {
  return providerError({
    targetId: target.id,
    provider: target.provider,
    cause,
    retryable: cause === "timeout",
    message: cause === "timeout" ? "provider call timed out" : "provider call aborted",
  });
}

export function withTimeout(clock: ClockPort) {
  return <T>(
    target: ModelTarget,
    ms: Milliseconds,
    run: TimedRun<T>,
    outer?: AbortSignal,
  ): Promise<Result<T, ProviderError>> => {
    if (outer?.aborted) return Promise.resolve(err(failure(target, "aborted")));

    const attempt = new AbortController();
    const timer = new AbortController();
    let onOuterAbort: (() => void) | undefined;

    const expired = clock.sleep(ms, timer.signal).then(
      () => err(failure(target, "timeout")),
      // The timer was cancelled because another branch won; never settles the race.
      () => new Promise<never>(() => {}),
    );
    const cancelled = new Promise<Result<T, ProviderError>>((resolve) => {
      onOuterAbort = () => resolve(err(failure(target, "aborted")));
      outer?.addEventListener("abort", onOuterAbort, { once: true });
    });

    return Promise.race([run(attempt.signal), expired, cancelled]).finally(() => {
      timer.abort();
      if (onOuterAbort !== undefined) outer?.removeEventListener("abort", onOuterAbort);
      // Ends the run when the timer or the outer signal won; a no-op when the run won.
      attempt.abort();
    });
  };
}
