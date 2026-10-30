import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { ErrorIssue } from "../../src/domain/errors.js";
import { loadPolicyFile } from "../../src/infrastructure/policy/file-policy-loader.js";

// Spec 002 US2-1, US2-2, US2-5, US2-6, FR-020 (tasks.md T038): the loader returns a typed
// `configuration` error naming every problem's path, and never throws.

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => join(here, "fixtures", name);
const invalid = (name: string): string => fixture(join("invalid", `${name}.yaml`));
const DEFAULT_POLICY = resolve(here, "../../policies/default.yaml");
const LOCAL_ONLY_POLICY = resolve(here, "../../policies/local-only.yaml");

async function issuesOf(path: string): Promise<ReadonlyArray<ErrorIssue>> {
  const result = await loadPolicyFile(path);
  if (result.ok) throw new Error(`expected ${path} to be rejected`);
  expect(result.error.kind).toBe("configuration");
  return result.error.issues;
}

function line(issue: ErrorIssue): string {
  return `${issue.path}: ${issue.message}`;
}

describe("loadPolicyFile (FR-020)", () => {
  it.each([
    ["unknown-target", 'rules.0.route.0: expected the id of a declared target (target "nope")'],
    ["duplicate-target", "targets.1.id: "],
    [
      "duplicate-chain-entry",
      'default.route.2: expected each target at most once in a chain (target "ollama-llama")',
    ],
    ["empty-default", "default.route: "],
    ["unknown-provider", "targets.0.provider: "],
    ["negative-price", "targets.0.pricing.inputUsdPerMillion: "],
    ["rule-id-default", "rules.0.id: "],
    ["sensitivity-condition", "rules.0.when: "],
  ])("rejects %s and names the path (US2-1, US2-2)", async (name, expected) => {
    const lines = (await issuesOf(invalid(name))).map(line);

    expect(lines.some((text) => text.startsWith(expected))).toBe(true);
  });

  it("rejects a file that is not YAML, naming the file and the line", async () => {
    const path = invalid("not-yaml");

    const issues = await issuesOf(path);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe(path);
    expect(issues[0]?.message).toMatch(/expected valid YAML or JSON.*line \d+/);
  });

  it("rejects a missing file with a configuration error naming the path", async () => {
    const path = fixture("does-not-exist.yaml");

    const issues = await issuesOf(path);

    expect(issues).toEqual([{ path, message: "expected a readable policy file" }]);
  });

  it("rejects a document that is not an object", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tamiz-policy-"));
    const path = join(dir, "scalar.yaml");
    writeFileSync(path, "just a string\n");

    expect((await issuesOf(path)).map((issue) => issue.path)).toEqual([""]);
  });

  it("lists every problem of a policy with several, not only the first (US2-6)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tamiz-policy-"));
    const path = join(dir, "many.yaml");
    writeFileSync(
      path,
      [
        "id: many",
        "version: 1",
        "targets:",
        "  - { id: a, provider: ollama, model: m, region: local, residency: local, pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 } }",
        "  - { id: a, provider: ollama, model: m, region: local, residency: local, pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 } }",
        "rules:",
        "  - { id: r, when: {}, route: [nope] }",
        "default: { route: [ghost] }",
      ].join("\n"),
    );

    const paths = (await issuesOf(path)).map((issue) => issue.path);

    expect(paths).toEqual(
      expect.arrayContaining(["targets.1.id", "rules.0.route.0", "default.route.0"]),
    );
  });

  it("loads the shipped default policy with its id, version and branded prices (US2-5)", async () => {
    const result = await loadPolicyFile(DEFAULT_POLICY);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("default");
    expect(result.value.version).toBe(2);
    expect(result.value.defaultTimeoutMs).toBe(30000);
    expect(new Set(result.value.targets.map((target) => target.provider))).toEqual(
      new Set(["ollama", "mistral", "anthropic", "openai"]),
    );
    const sonnet = result.value.targets.find((target) => target.id === "anthropic-sonnet");
    expect(sonnet?.pricing).toEqual({ inputUsdPerMillion: 3, outputUsdPerMillion: 15 });
    expect(sonnet?.timeoutMs).toBe(45000);
    const cheap = result.value.rules.find((rule) => rule.id === "cheap-short-tasks");
    expect(cheap).toMatchObject({ orderBy: "cost", timeoutMs: 20000 });
    // Spec 003 R-06: residency statements; long documents never fall back to the US.
    const longDocs = result.value.rules.find((rule) => rule.id === "long-documents-eu");
    expect(longDocs).toMatchObject({
      residency: ["eu", "local"],
      route: ["mistral-small", "ollama-llama"],
    });
    expect(result.value.rules.find((rule) => rule.id === "pinned-local")?.residency).toEqual([
      "local",
    ]);
    expect(result.value.resilience).toEqual({
      requestDeadlineMs: 60000,
      maxAttempts: 2,
      backoff: { baseDelayMs: 250, maxDelayMs: 2000 },
      circuitBreaker: { failureThreshold: 5, cooldownMs: 30000 },
    });
  });

  it("spec 003 US2-3: rejects a rule whose chain contradicts its residency statement", async () => {
    const lines = (await issuesOf(invalid("residency-contradiction"))).map(line);

    expect(
      lines.some((text) =>
        text.startsWith(
          'rules.0.route.1: expected a target whose residency is in the rule\'s residency list (target residency "us")',
        ),
      ),
    ).toBe(true);
  });

  it("loads the shipped local-only policy", async () => {
    const result = await loadPolicyFile(LOCAL_ONLY_POLICY);

    expect(result.ok && result.value).toMatchObject({
      id: "local-only",
      defaultTimeoutMs: 60000,
      rules: [],
      default: { route: ["ollama-llama"] },
    });
  });

  it("loads the minimal fixture and fills the default timeout", async () => {
    const result = await loadPolicyFile(fixture("valid-minimal.yaml"));

    expect(result.ok && result.value).toMatchObject({
      id: "minimal",
      version: 3,
      defaultTimeoutMs: 30000,
    });
  });

  it("loads a JSON file with the same content as the default policy (R-09)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tamiz-policy-"));
    const path = join(dir, "default.json");
    writeFileSync(path, JSON.stringify(parse(readFileSync(DEFAULT_POLICY, "utf8"))));

    const fromJson = await loadPolicyFile(path);
    const fromYaml = await loadPolicyFile(DEFAULT_POLICY);

    expect(fromJson).toEqual(fromYaml);
  });
});
