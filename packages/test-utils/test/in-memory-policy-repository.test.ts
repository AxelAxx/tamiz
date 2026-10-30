import { describe, expect, it } from "vitest";
import { createInMemoryPolicyRepository } from "../src/in-memory-policy-repository.js";

// Spec 002, research R-14 (tasks.md T015): satisfies the gateway's `PolicyRepositoryPort`
// (`{ getActive(): Promise<RoutingPolicy> }`) structurally, with the policy type left
// generic so this package never imports the gateway.

describe("createInMemoryPolicyRepository", () => {
  it("getActive() resolves the initial policy", async () => {
    const policy = { id: "default", version: 1 };
    const repository = createInMemoryPolicyRepository(policy);

    await expect(repository.getActive()).resolves.toBe(policy);
  });

  it("set(p) replaces the active policy", async () => {
    const repository = createInMemoryPolicyRepository({ id: "default", version: 1 });
    const next = { id: "default", version: 2 };

    repository.set(next);

    await expect(repository.getActive()).resolves.toBe(next);
  });

  it("getActive() is callable without its receiver, like a port method passed around", async () => {
    const repository = createInMemoryPolicyRepository("only");
    const { getActive } = repository;

    await expect(getActive()).resolves.toBe("only");
  });
});
