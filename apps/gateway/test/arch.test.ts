/**
 * Spec 001, User Story 6: the architecture limits are enforced by a machine.
 *
 * Runs dependency-cruiser programmatically with the root `.dependency-cruiser.cjs`:
 *
 * - US6-1 over the real `apps/gateway/src` (baseDir = repository root), expecting zero
 *   violations;
 * - US6-2 … US6-5 over the fixtures in `test/arch-fixtures/`, a miniature repository with
 *   the same `apps/gateway/src/<layer>/` layout. Cruising with `baseDir` set to the fixture
 *   root makes every fixture path look like a real gateway path, so the production rules
 *   apply unchanged and each fixture breaks exactly one of them.
 */
import { fileURLToPath } from "node:url";
import {
  cruise,
  type ICruiseOptions,
  type ICruiseResult,
  type IViolation,
} from "dependency-cruiser";
import extractDepcruiseOptions from "dependency-cruiser/config-utl/extract-depcruise-options";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixturesRoot = fileURLToPath(new URL("./arch-fixtures/", import.meta.url));
const configPath = `${repoRoot}.dependency-cruiser.cjs`;
const tsConfigPath = `${repoRoot}apps/gateway/tsconfig.json`;

const GATEWAY = "apps/gateway/src";

let baseOptions: ICruiseOptions;
let tsConfig: ReturnType<typeof extractTSConfig>;

beforeAll(async () => {
  baseOptions = await extractDepcruiseOptions(configPath);
  tsConfig = extractTSConfig(tsConfigPath);
});

async function cruiseFrom(baseDir: string, targets: string[]): Promise<ICruiseResult> {
  const { output } = await cruise(
    targets,
    { ...baseOptions, baseDir, outputType: "json" },
    undefined,
    { tsConfig },
  );
  return typeof output === "string" ? (JSON.parse(output) as ICruiseResult) : output;
}

function describeViolations(violations: readonly IViolation[]): string {
  return violations.map((v) => `${v.rule.name}: ${v.from} → ${v.to}`).join("\n");
}

describe("US6-1 a compliant gateway tree passes the architecture check", () => {
  it("reports zero violations over apps/gateway/src", async () => {
    const result = await cruiseFrom(repoRoot, [GATEWAY]);

    expect(result.summary.totalCruised).toBeGreaterThan(0);
    expect(describeViolations(result.summary.violations)).toBe("");
    expect(result.summary.error).toBe(0);
  });

  it("lets main.ts import infrastructure (second half of US6-4)", async () => {
    const result = await cruiseFrom(repoRoot, [GATEWAY]);
    const main = result.modules.find((m) => m.source === `${GATEWAY}/main.ts`);

    expect(main).toBeDefined();
    const infraDeps = (main?.dependencies ?? []).filter((d) =>
      d.resolved.startsWith(`${GATEWAY}/infrastructure/`),
    );
    expect(infraDeps.length).toBeGreaterThan(0);
    expect(infraDeps.every((d) => d.valid)).toBe(true);
  });
});

describe("a layering violation fails the check naming the file and the rule", () => {
  const cases: ReadonlyArray<{
    scenario: string;
    fixture: string;
    rule: string;
    target: string | RegExp;
  }> = [
    {
      scenario: "US6-2 domain imports infrastructure",
      fixture: `${GATEWAY}/domain/domain-to-infra.ts`,
      rule: "domain-imports-nothing",
      target: `${GATEWAY}/infrastructure/logging/logger.ts`,
    },
    {
      scenario: "US6-2 domain imports an external library",
      fixture: `${GATEWAY}/domain/domain-to-npm.ts`,
      rule: "domain-imports-nothing",
      target: /zod/,
    },
    {
      scenario: "US6-2 domain imports a workspace package",
      fixture: `${GATEWAY}/domain/domain-to-workspace-package.ts`,
      rule: "domain-imports-nothing",
      target: /packages\/contracts\/dist\//,
    },
    {
      scenario: "US6-3 application imports infrastructure",
      fixture: `${GATEWAY}/application/application-to-infra.ts`,
      rule: "application-only-domain",
      target: `${GATEWAY}/infrastructure/logging/logger.ts`,
    },
    {
      scenario: "US6-4 presentation imports infrastructure",
      fixture: `${GATEWAY}/presentation/presentation-to-infra.ts`,
      rule: "only-main-imports-infrastructure",
      target: `${GATEWAY}/infrastructure/logging/logger.ts`,
    },
    {
      scenario: "US6-5 infrastructure imports presentation",
      fixture: `${GATEWAY}/infrastructure/infra-to-presentation.ts`,
      rule: "infrastructure-no-presentation",
      target: `${GATEWAY}/presentation/app.ts`,
    },
  ];

  it.each(cases)("$scenario → $rule", async ({ fixture, rule, target }) => {
    const result = await cruiseFrom(fixturesRoot, [fixture]);
    const violations = result.summary.violations;

    expect(violations, describeViolations(violations)).toHaveLength(1);
    const [violation] = violations;
    expect(violation?.rule.name).toBe(rule);
    expect(violation?.rule.severity).toBe("error");
    expect(violation?.from).toBe(fixture);
    if (typeof target === "string") {
      expect(violation?.to).toBe(target);
    } else {
      expect(violation?.to).toMatch(target);
    }
    expect(result.summary.error).toBe(1);
  });

  it("the fixture tree itself is otherwise compliant (stubs trip no rule)", async () => {
    const result = await cruiseFrom(fixturesRoot, [
      `${GATEWAY}/domain/result.ts`,
      `${GATEWAY}/application/ports/clock.port.ts`,
      `${GATEWAY}/infrastructure/logging/logger.ts`,
      `${GATEWAY}/presentation/app.ts`,
      `${GATEWAY}/main.ts`,
    ]);

    expect(describeViolations(result.summary.violations)).toBe("");
  });
});
