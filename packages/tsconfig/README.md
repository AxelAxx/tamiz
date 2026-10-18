# packages/tsconfig

Shared TypeScript configurations for the workspace: a strict base (`strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, no implicit `any`) and
variants for Node libraries, the Hono gateway, the Next.js dashboard and test code. Every
package extends one of these instead of declaring its own flags. Created in task
`T-001-02`.

Files: `base.json` (flags, `NodeNext`, ES2022, `resolveJsonModule`), `library.json`
(adds `declaration`, `declarationMap`, `sourceMap`; for `packages/*`), `node-app.json`
(adds Node types and source maps, no declarations; for `apps/gateway`). Packages use
`tsconfig.json` (extends one of these, `noEmit`, includes `src` and `test`) for
`typecheck`, and `tsconfig.build.json` (`rootDir: src`, `outDir: dist`) for `build`.
No scripts: this package has nothing to lint, test or build.
