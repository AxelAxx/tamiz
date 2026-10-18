# packages/tsconfig

Shared TypeScript configurations for the workspace: a strict base (`strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, no implicit `any`) and
variants for Node libraries, the Hono gateway, the Next.js dashboard and test code. Every
package extends one of these instead of declaring its own flags. Created in task
`T-001-02`.
