import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../src/infrastructure/policy/file-policy-loader.js";
import { createInMemoryPolicyRepository } from "../../src/infrastructure/policy/in-memory-policy-repository.js";

// Spec 002 FR-022 (tasks.md T046): the production repository returns the policy it was
// seeded with at boot.

describe("createInMemoryPolicyRepository (FR-022)", () => {
  it("returns the seeded policy on every call", async () => {
    const loaded = await loadPolicyFile(
      resolve(import.meta.dirname, "../../policies/local-only.yaml"),
    );
    if (!loaded.ok) throw new Error("the local-only policy must load");
    const repository = createInMemoryPolicyRepository(loaded.value);

    expect(await repository.getActive()).toBe(loaded.value);
    expect(await repository.getActive()).toBe(loaded.value);
  });
});
