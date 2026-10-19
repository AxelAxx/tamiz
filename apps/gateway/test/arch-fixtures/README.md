# Architecture fixtures

A miniature repository with the gateway layout (`apps/gateway/src/<layer>/`) used by
`../arch.test.ts`. The stub modules are compliant; each `*-to-*.ts` file breaks exactly one
rule of the root `.dependency-cruiser.cjs`. The test cruises this folder with `baseDir` set
here, so the production rules apply unchanged. Excluded from `pnpm arch` (which only cruises
`apps/gateway/src`) and from the build (`tsconfig.build.json` includes `src` only).
