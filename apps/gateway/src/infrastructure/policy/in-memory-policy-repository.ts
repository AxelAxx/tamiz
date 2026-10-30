/**
 * The production `PolicyRepositoryPort` (spec 002 FR-022): the policy loaded and
 * validated at boot, held in memory. Hot reload and the dashboard editor (feature 008)
 * replace it later.
 */
import type { PolicyRepositoryPort } from "../../application/ports/policy-repository.port.js";
import type { RoutingPolicy } from "../../domain/model/routing-policy.js";

export function createInMemoryPolicyRepository(policy: RoutingPolicy): PolicyRepositoryPort {
  return { getActive: async () => policy };
}
