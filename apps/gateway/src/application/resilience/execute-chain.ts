/**
 * Walks the decided chain with resilience (spec 003 FR-011 … FR-017, US1, US2, US5,
 * research R-05 … R-08).
 *
 * Per target, in order:
 * 1. Residency guard: a target outside the decision's allowed residencies stops the
 *    execution with a residency violation; it is never called (blocks, never degrades).
 * 2. Request deadline: nothing starts once it has passed.
 * 3. Circuit breaker: an open circuit skips the target (`circuit_open`); a half-open one
 *    admits a single trial attempt.
 * 4. Attempts: `withRetry(withTimeout(attempt))`, each attempt bounded by the target's
 *    effective timeout and the time left; each result updates the circuit.
 * 5. On a final failure the chain advances; an `aborted` result (deadline or outer
 *    signal) stops it.
 *
 * Every step is an event. The same function serves completions and, from `T-003-05`,
 * streams whose attempt resolves at the first token.
 */
import {
  type ProviderError,
  type ProviderUnavailableError,
  providerError,
  providerUnavailableError,
  type ResidencyViolationError,
  residencyViolationError,
} from "../../domain/errors.js";
import type { Abandoned } from "../../domain/model/fallback.js";
import type { ModelTarget } from "../../domain/model/model-target.js";
import type { RoutingDecision } from "../../domain/model/routing-decision.js";
import type { ResilienceSettings } from "../../domain/model/routing-policy.js";
import type { Milliseconds, RequestId } from "../../domain/model/units.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { CircuitStatePort } from "../ports/circuit-state.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { RoutingEventsPort } from "../ports/routing-events.port.js";
import { type Admission, createCircuitBreaker } from "./circuit-breaker.js";
import { withRetry } from "./retry.js";
import { withTimeout } from "./timeout.js";

/** The shortest `retry-after` a client is told (spec 003 FR-015). */
const MIN_RETRY_AFTER_MS = 1_000;

export interface ExecuteChainDeps {
  readonly clock: ClockPort;
  /** Uniform in `[0, 1)` for backoff jitter. */
  readonly random: () => number;
  readonly events: RoutingEventsPort;
  readonly circuitState: CircuitStatePort;
}

export interface ChainRequest {
  readonly requestId: RequestId;
  readonly decision: RoutingDecision;
  readonly resilience: ResilienceSettings;
  /** The effective timeout of feature 002 (rule, then target, then policy default). */
  readonly timeoutFor: (target: ModelTarget) => Milliseconds;
  /** Aborts the execution (client disconnect, `T-003-05`). */
  readonly signal?: AbortSignal;
}

/** One provider call against one target, bounded by `timeoutMs`; the signal ends it. */
export type ChainAttempt<T> = (
  target: ModelTarget,
  signal: AbortSignal,
  timeoutMs: Milliseconds,
) => Promise<Result<T, ProviderError>>;

export interface Served<T> {
  readonly target: ModelTarget;
  readonly value: T;
  /** Targets left before the answering one, in order. */
  readonly abandoned: ReadonlyArray<Abandoned>;
}

/**
 * Why the chain produced no answer. `target` is the last target reached (tried, skipped,
 * blocked or not started for the deadline); `abandoned` lists the ones before it.
 */
export type ChainFailure =
  | {
      readonly kind: "exhausted";
      readonly target: ModelTarget;
      readonly error: ProviderError;
      readonly abandoned: ReadonlyArray<Abandoned>;
    }
  | {
      readonly kind: "unavailable";
      readonly target: ModelTarget;
      readonly error: ProviderUnavailableError;
      readonly abandoned: ReadonlyArray<Abandoned>;
    }
  | {
      readonly kind: "residency";
      readonly target: ModelTarget;
      readonly error: ResidencyViolationError;
      readonly abandoned: ReadonlyArray<Abandoned>;
    }
  | {
      readonly kind: "deadline";
      readonly target: ModelTarget;
      readonly error: ProviderError;
      readonly abandoned: ReadonlyArray<Abandoned>;
    };

function deadlineError(target: ModelTarget): ProviderError {
  return providerError({
    targetId: target.id,
    provider: target.provider,
    cause: "aborted",
    retryable: false,
    message: "request deadline reached",
  });
}

export function executeChain<T>(deps: ExecuteChainDeps) {
  const { clock, events } = deps;
  const timed = withTimeout(clock);

  return async (
    request: ChainRequest,
    attempt: ChainAttempt<T>,
  ): Promise<Result<Served<T>, ChainFailure>> => {
    const { decision, resilience, requestId } = request;
    const deadline = new Date(clock.now().getTime() + resilience.requestDeadlineMs);
    const breaker = createCircuitBreaker({
      state: deps.circuitState,
      clock,
      events,
      settings: resilience.circuitBreaker,
    });
    const context = { requestId };
    const base = (target: ModelTarget) => ({
      requestId,
      targetId: target.id,
      provider: target.provider,
      residency: target.residency,
      at: clock.now().toISOString(),
    });
    const remainingMs = () => deadline.getTime() - clock.now().getTime();

    const visited: Abandoned[] = [];
    let lastFailure: ProviderError | undefined;
    const skippedRemaining: number[] = [];

    for (const target of decision.chain) {
      if (!decision.allowedResidencies.includes(target.residency)) {
        events.emit({
          ...base(target),
          type: "residency.blocked",
          allowed: decision.allowedResidencies,
        });
        return err({
          kind: "residency",
          target,
          error: residencyViolationError({
            ruleId: decision.ruleId,
            targetId: target.id,
            residency: target.residency,
            allowed: decision.allowedResidencies,
          }),
          abandoned: visited,
        });
      }
      if (remainingMs() <= 0) {
        return err({ kind: "deadline", target, error: deadlineError(target), abandoned: visited });
      }

      const leaseMs = Math.min(request.timeoutFor(target), remainingMs()) as Milliseconds;
      const admission: Admission = await breaker.admit(target, context, leaseMs);
      if (admission.kind === "skip") {
        events.emit({ ...base(target), type: "target.skipped", reason: "circuit_open" });
        visited.push({ targetId: target.id, reason: "circuit_open" });
        skippedRemaining.push(admission.remainingMs);
        continue;
      }

      const retry = withRetry<T>({
        clock,
        random: deps.random,
        events,
        settings: {
          // A half-open trial is a single attempt: its failure reopens the circuit.
          maxAttempts: admission.kind === "trial" ? 1 : resilience.maxAttempts,
          baseDelayMs: resilience.backoff.baseDelayMs,
          maxDelayMs: resilience.backoff.maxDelayMs,
        },
      });
      const result = await retry(
        {
          requestId,
          target,
          deadline,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
        async (n) => {
          const started = clock.now().getTime();
          events.emit({ ...base(target), type: "attempt.started", attempt: n });
          const timeoutMs = Math.max(
            0,
            Math.min(request.timeoutFor(target), remainingMs()),
          ) as Milliseconds;
          const outcome = await timed(
            target,
            timeoutMs,
            (signal) => attempt(target, signal, timeoutMs),
            request.signal,
          );
          const durationMs = clock.now().getTime() - started;
          events.emit(
            outcome.ok
              ? { ...base(target), type: "attempt.succeeded", attempt: n, durationMs }
              : {
                  ...base(target),
                  type: "attempt.failed",
                  attempt: n,
                  durationMs,
                  reason: outcome.error.cause,
                },
          );
          await breaker.onResult(target, context, outcome, admission);
          return outcome;
        },
      );

      if (result.ok) return ok({ target, value: result.value, abandoned: visited });
      const { cause } = result.error;
      if (cause === "aborted") {
        return err({ kind: "deadline", target, error: result.error, abandoned: visited });
      }
      events.emit({ ...base(target), type: "fallback", reason: cause });
      visited.push({ targetId: target.id, reason: cause });
      lastFailure = result.error;
    }

    // The chain ended: the last visited target is the one reported; the others were abandoned.
    const target = decision.chain.at(-1);
    if (target === undefined) {
      throw new Error(`Policy ${decision.policyId} produced an empty chain; was it validated?`);
    }
    const abandoned = visited.slice(0, -1);
    if (lastFailure === undefined) {
      const shortest = Math.min(...skippedRemaining);
      return err({
        kind: "unavailable",
        target,
        error: providerUnavailableError(Math.max(MIN_RETRY_AFTER_MS, shortest) as Milliseconds),
        abandoned,
      });
    }
    return err({ kind: "exhausted", target, error: lastFailure, abandoned });
  };
}
