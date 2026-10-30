/**
 * An in-memory policy repository (spec 002, research R-14).
 *
 * Satisfies the gateway's `PolicyRepositoryPort` (`{ getActive(): Promise<RoutingPolicy> }`)
 * structurally. The policy type is a parameter, so this package never imports the
 * gateway's `RoutingPolicy` (research R-09).
 */
export interface InMemoryPolicyRepository<P> {
  /** Resolves the active policy. */
  getActive(): Promise<P>;
  /** Replaces the active policy. */
  set(policy: P): void;
}

export function createInMemoryPolicyRepository<P>(initial: P): InMemoryPolicyRepository<P> {
  let active = initial;

  return {
    getActive: async () => active,
    set: (policy) => {
      active = policy;
    },
  };
}
