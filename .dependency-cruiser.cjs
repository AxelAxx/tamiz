/**
 * Architecture limits of the gateway (constitution I, spec 001 FR-021 / FR-022,
 * research R-12). Run from the repository root:
 *
 *   pnpm arch   →   depcruise apps/gateway/src --config .dependency-cruiser.cjs --output-type err
 *
 * Every rule is an error: a layering violation is a failed build, not a review comment.
 * Paths are relative to the repository root, which is where `pnpm arch` and the
 * programmatic test (`apps/gateway/test/arch.test.ts`, via `baseDir`) run the cruise.
 *
 * Layer rules (each violation trips exactly one of the five):
 *   domain          → nothing outside domain (no application, no npm, no node core)
 *   application     → application, domain
 *   infrastructure  → infrastructure, application, domain, npm, node core, workspace packages
 *   presentation    → presentation, application, domain, @tamiz/contracts, npm, node core
 *   main.ts         → anything; and nothing but main.ts imports infrastructure
 */

const path = require("node:path");

const GATEWAY = "apps/gateway/src";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-imports-nothing",
      severity: "error",
      comment:
        "The domain layer is pure: it may only import other domain modules. " +
        "No application, infrastructure, presentation, workspace package, npm or node core import.",
      from: { path: `^${GATEWAY}/domain/` },
      to: { pathNot: `^${GATEWAY}/domain/` },
    },
    {
      name: "application-only-domain",
      severity: "error",
      comment:
        "The application layer may import only application and domain modules. " +
        "Infrastructure is reached through ports; presentation and main.ts are outer layers.",
      from: { path: `^${GATEWAY}/application/` },
      to: { path: [`^${GATEWAY}/(infrastructure|presentation)/`, `^${GATEWAY}/main\\.ts$`] },
    },
    {
      name: "infrastructure-no-presentation",
      severity: "error",
      comment:
        "Adapters never import HTTP code. Infrastructure may import application, domain, " +
        "workspace packages and libraries, but not presentation or main.ts.",
      from: { path: `^${GATEWAY}/infrastructure/` },
      to: { path: [`^${GATEWAY}/presentation/`, `^${GATEWAY}/main\\.ts$`] },
    },
    {
      name: "presentation-allowed-imports",
      severity: "error",
      comment:
        "Presentation may import application, domain and @tamiz/contracts (plus hono and node " +
        "core). Other workspace packages and main.ts are off limits; infrastructure is covered by " +
        "only-main-imports-infrastructure.",
      from: { path: `^${GATEWAY}/presentation/` },
      to: {
        path: [`^${GATEWAY}/main\\.ts$`, "^packages/", "^apps/(?!gateway/)"],
        pathNot: ["^packages/contracts/"],
      },
    },
    {
      name: "only-main-imports-infrastructure",
      severity: "error",
      comment:
        "main.ts is the composition root: the only module allowed to import infrastructure " +
        "(domain and application are covered by their own rules, so a violation names one rule).",
      from: { pathNot: `^${GATEWAY}/(main\\.ts$|infrastructure/|domain/|application/)` },
      to: { path: `^${GATEWAY}/infrastructure/` },
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make layers meaningless and modules untestable in isolation.",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment:
        "Every import must resolve to disk. For @tamiz/* packages this means their dist/ " +
        "must be built (pnpm build) before the cruise.",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    // npm, node core and workspace-package (dist/) dependencies are recorded, so the layer
    // rules see them, but never followed into. `exclude` would drop the edge itself and blind
    // domain-imports-nothing to an `@tamiz/*` import, so only the test tree is excluded.
    doNotFollow: { path: ["node_modules", "(^|/)dist/"] },
    exclude: { path: "^apps/gateway/test/" },
    // Absolute on purpose: TypeScript reports TS18003 ("no inputs were found") for a relative
    // file name on Windows, and the programmatic test runs with a different cwd and baseDir.
    tsConfig: { fileName: path.resolve(__dirname, "apps/gateway/tsconfig.json") },
    // Type-only imports count: a `import type` from infrastructure is still a dependency
    // on infrastructure.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
