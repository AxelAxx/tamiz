/**
 * Where the active routing policy comes from (spec 002 FR-010, data-model section 4.1).
 *
 * The file adapter (`T-002-05`) validates the policy at boot and returns it from memory;
 * a policy that fails validation never reaches this port. Tests use
 * `createInMemoryPolicyRepository` from `@tamiz/test-utils`, which satisfies this shape
 * structurally.
 */
import type { RoutingPolicy } from "../../domain/model/routing-policy.js";

export interface PolicyRepositoryPort {
  getActive(): Promise<RoutingPolicy>;
}
