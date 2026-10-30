/**
 * `ProviderHealth` (spec 006 US4-1 … US4-3, FR-013, research R-12).
 *
 * Every declared target, idle ones included: its circuit state now (from the shared
 * circuit store) and its attempts, error rate and answered latency over the last
 * `windowMinutes`.
 */
import { remainingCooldownMs, stateAt } from "../../domain/model/circuit.js";
import type { ModelTarget } from "../../domain/model/model-target.js";
import type { AuditReaderPort } from "../ports/audit-reader.port.js";
import type { CircuitStatePort } from "../ports/circuit-state.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { PolicyRepositoryPort } from "../ports/policy-repository.port.js";

export interface ProviderHealth {
  readonly targetId: string;
  readonly provider: ModelTarget["provider"];
  readonly model: string;
  readonly residency: ModelTarget["residency"];
  readonly circuit: "closed" | "open" | "half_open";
  readonly cooldownRemainingMs?: number;
  readonly window: {
    readonly requests: number;
    readonly errors: number;
    readonly errorRate: number;
    readonly latencyP50Ms: number | null;
    readonly latencyP95Ms: number | null;
  };
}

export interface ProvidersReport {
  readonly windowMinutes: number;
  readonly generatedAt: string;
  readonly targets: ReadonlyArray<ProviderHealth>;
}

export type ProviderHealthUseCase = (query: { windowMinutes: number }) => Promise<ProvidersReport>;

export function providerHealth(deps: {
  readonly reader: AuditReaderPort;
  readonly policies: PolicyRepositoryPort;
  readonly circuitState: CircuitStatePort;
  readonly clock: ClockPort;
}): ProviderHealthUseCase {
  return async ({ windowMinutes }) => {
    const now = deps.clock.now();
    const since = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
    const [policy, windows] = await Promise.all([
      deps.policies.getActive(),
      deps.reader.window(since),
    ]);
    const cooldownMs = policy.resilience.circuitBreaker.cooldownMs;
    const targets = await Promise.all(
      policy.targets.map(async (target): Promise<ProviderHealth> => {
        const snapshot = await deps.circuitState.snapshot(target.id);
        const circuit = stateAt(snapshot, now.getTime(), cooldownMs);
        const stats = windows.find((w) => w.targetId === target.id);
        const requests = stats?.requests ?? 0;
        const errors = stats?.errors ?? 0;
        return {
          targetId: target.id,
          provider: target.provider,
          model: target.model,
          residency: target.residency,
          circuit,
          ...(circuit === "open"
            ? { cooldownRemainingMs: remainingCooldownMs(snapshot, now.getTime(), cooldownMs) }
            : {}),
          window: {
            requests,
            errors,
            errorRate: requests === 0 ? 0 : errors / requests,
            latencyP50Ms: stats?.latencyP50Ms ?? null,
            latencyP95Ms: stats?.latencyP95Ms ?? null,
          },
        };
      }),
    );
    return { windowMinutes, generatedAt: now.toISOString(), targets };
  };
}
