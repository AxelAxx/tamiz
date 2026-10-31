import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../src/infrastructure/policy/file-policy-loader.js";

// Every policy file the repository ships must load: the gateway refuses to boot otherwise.
// Spec 007 research R-07 adds `pinned-frontier` to the default policy and the CI policy
// of the quality eval.

const ROOT = new URL("../../../../", import.meta.url);
const path = (relative: string) => fileURLToPath(new URL(relative, ROOT));

describe("shipped policy files", () => {
  it.each([
    ["apps/gateway/policies/default.yaml", ["pinned-local", "pinned-frontier"]],
    ["apps/gateway/policies/local-only.yaml", []],
    ["packages/evals/policies/quality-ci.yaml", ["pinned-local"]],
  ])("%s loads", async (file, rules) => {
    const loaded = await loadPolicyFile(path(file));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error.issues));
    const ids = loaded.value.rules.map((rule) => rule.id);
    for (const rule of rules) expect(ids).toContain(rule);
  });

  it("`tamiz-frontier` routes to the frontier target only; `tamiz-local` stays local", async () => {
    const loaded = await loadPolicyFile(path("apps/gateway/policies/default.yaml"));
    if (!loaded.ok) throw new Error("default policy must load");
    const rule = (id: string) => loaded.value.rules.find((r) => r.id === id);
    expect(rule("pinned-frontier")?.route).toEqual(["anthropic-sonnet"]);
    expect(rule("pinned-local")?.route).toEqual(["ollama-llama"]);
  });
});
