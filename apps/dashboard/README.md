# apps/dashboard

The Tamiz dashboard: a Next.js 16 (App Router, React 19) application that reads the
gateway's admin API through a typed Hono RPC client. Organised by feature
(`live-traffic`, `audit-log`, `policy-editor` with the dry-run simulator,
`cost-analytics`, `eval-results`); routes stay thin. Tailwind CSS v4, shadcn/ui, TanStack
Table and Query, React Hook Form + Zod, Motion. Created in feature `008-dashboard`
(task `T-008-02`).
