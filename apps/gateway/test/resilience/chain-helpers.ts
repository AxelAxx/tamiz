import { createFakeClock, type FakeClock } from "@tamiz/test-utils";
import { type ChainAttempt, executeChain } from "../../src/application/resilience/execute-chain.js";
import type { ProviderError } from "../../src/domain/errors.js";
import {
  type ModelTarget,
  RESIDENCIES,
  type Residency,
} from "../../src/domain/model/model-target.js";
import type { RoutingDecision } from "../../src/domain/model/routing-decision.js";
import {
  DEFAULT_RESILIENCE,
  type ResilienceSettings,
} from "../../src/domain/model/routing-policy.js";
import {
  millisecondsUnchecked,
  policyIdUnchecked,
  targetIdUnchecked,
  usdUnchecked,
} from "../../src/domain/model/units.js";
import type { Result } from "../../src/domain/result.js";
import { createInMemoryCircuitState } from "../../src/infrastructure/cache/in-memory-circuit-state.js";
import { REQUEST_ID, recordingEvents, sequence } from "./helpers.js";

export const START = new Date("2026-01-01T00:00:00Z");

export function chainTarget(id: string, residency: Residency = "eu"): ModelTarget {
  return {
    id: targetIdUnchecked(id),
    provider: residency === "local" ? "ollama" : residency === "eu" ? "mistral" : "openai",
    model: `${id}-model`,
    region: residency,
    residency,
    pricing: { inputUsdPerMillion: usdUnchecked(0), outputUsdPerMillion: usdUnchecked(0) },
  };
}

export function decisionFor(
  chain: ReadonlyArray<ModelTarget>,
  allowedResidencies: ReadonlyArray<Residency> = RESIDENCIES,
): RoutingDecision {
  return {
    kind: "route",
    policyId: policyIdUnchecked("test"),
    policyVersion: 1,
    ruleId: "default",
    chain,
    taskType: "chat",
    size: "short",
    sensitivity: "unknown",
    entityCounts: {},
    privacyAction: "allow",
    allowedResidencies,
  };
}

/** Per-target scripts: each call returns the next outcome (the last one repeats). */
export type Scripts = Record<string, ReadonlyArray<Result<string, ProviderError> | "hang">>;

export function chainSetup(
  options: {
    readonly resilience?: Partial<ResilienceSettings>;
    readonly random?: () => number;
    readonly clock?: FakeClock;
  } = {},
) {
  const clock = options.clock ?? createFakeClock(START);
  const events = recordingEvents();
  const circuitState = createInMemoryCircuitState(clock);
  const calls: string[] = [];
  const resilience: ResilienceSettings = { ...DEFAULT_RESILIENCE, ...options.resilience };
  const execute = executeChain<string>({
    clock,
    random: options.random ?? sequence(0.5),
    events,
    circuitState,
  });

  function run(
    decision: RoutingDecision,
    scripts: Scripts,
    signal?: AbortSignal,
  ): ReturnType<typeof execute> {
    const counters = new Map<string, number>();
    const attempt: ChainAttempt<string> = (target, attemptSignal) => {
      calls.push(target.id);
      const script = scripts[target.id] ?? [];
      const index = counters.get(target.id) ?? 0;
      counters.set(target.id, index + 1);
      const outcome = script[Math.min(index, script.length - 1)];
      if (outcome === undefined) throw new Error(`no script for ${target.id}`);
      if (outcome === "hang") {
        return new Promise((_resolve, reject) => {
          attemptSignal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      }
      return Promise.resolve(outcome);
    };
    return execute(
      {
        requestId: REQUEST_ID,
        decision,
        resilience,
        timeoutFor: () => millisecondsUnchecked(10_000),
        ...(signal === undefined ? {} : { signal }),
      },
      attempt,
    );
  }

  return { clock, events, calls, circuitState, run, resilience };
}
