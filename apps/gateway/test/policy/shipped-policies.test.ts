import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RoutingPolicySchema } from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadPolicyFile } from "../../src/infrastructure/policy/file-policy-loader.js";

// Spec 005 US6-1, US6-4, FR-020 (tasks.md T004): the shipped policies carry the privacy
// section at version 3, and a policy without it is rejected at `privacy`.

const policyPath = (name: string) => resolve(import.meta.dirname, "../../policies", name);

describe("shipped policies (spec 005)", () => {
  it.each(["default.yaml", "local-only.yaml"])("US6-4: %s loads at version 3", async (name) => {
    const loaded = await loadPolicyFile(policyPath(name));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.version).toBe(3);
    expect(loaded.value.privacy.localRoute).toEqual(["ollama-llama"]);
  });

  it("the default policy is research R-11", async () => {
    const loaded = await loadPolicyFile(policyPath("default.yaml"));
    if (!loaded.ok) throw new Error("default.yaml must load");
    expect(loaded.value.privacy).toEqual({
      onDetectorError: "restrict_to_local",
      localRoute: ["ollama-llama"],
      levels: {
        none: { action: "allow" },
        low: { action: "allow" },
        high: { action: "anonymize", residency: ["local", "eu"] },
        critical: { action: "restrict_to_local" },
      },
    });
  });

  it("US6-1: without `privacy` the schema rejects the policy at `privacy`", () => {
    const { privacy: _dropped, ...rest } = parse(
      readFileSync(policyPath("default.yaml"), "utf8"),
    ) as Record<string, unknown>;
    const result = RoutingPolicySchema.safeParse(rest);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(["privacy"]);
  });
});
