# Tamiz — Architecture

Diagrams for the system view, the request flow and the gateway layers. The narrative and
rationale live in `docs/tamiz-project.md` section 4 and in `docs/adr/`. C4 context and
container diagrams are completed in task `T-DOC-02`.

## System view

```mermaid
flowchart LR
    client["Client app / Agent"] -->|"POST /v1/chat/completions (OpenAI-compatible)"| gw

    subgraph gw["Gateway (Hono, Node 22)"]
        direction TB
        pres["presentation"] --> app["application"] --> dom["domain"]
        infra["infrastructure"] --> app
    end

    infra -->|"/analyze, /anonymize"| privacy["Privacy service (FastAPI + Presidio)"]
    infra -->|local| ollama["Ollama (local)"]
    infra -->|EU residency| mistral["Mistral API (EU)"]
    infra -->|frontier| frontier["Anthropic / OpenAI"]
    infra --> pg[("PostgreSQL 17: audit log, policies, api keys")]
    infra --> redis[("Redis / Valkey: circuit state, rate limit, cache")]
    infra -->|OTLP| jaeger["Jaeger"]

    dash["Dashboard (Next.js 16)"] -->|"read-only admin API"| pres
    mcp["MCP server"] -->|"admin API"| pres
    agent["Agent (AI SDK 6)"] -->|"MCP tools"| mcp
    agent -->|"LLM calls through Tamiz"| pres
```

## Request flow

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant P as presentation
    participant U as RouteInference (application)
    participant S as Privacy service
    participant D as RoutingPolicy (domain)
    participant R as Resilience (timeout, retry, breaker)
    participant L as LLM provider
    participant A as AuditLog + OTel

    C->>P: POST /v1/chat/completions
    P->>P: Zod validation (packages/contracts)
    P->>U: InferenceRequest
    par in parallel
        U->>U: ClassifyTask (type, size)
    and
        U->>S: InspectSensitivity (hash-cached)
        S-->>U: entities + sensitivity level
    end
    U->>D: decide(request, sensitivity)
    D-->>U: RoutingDecision (fallback chain, privacy action)
    alt action = block
        U-->>P: Result.err(Blocked)
    else action = anonymize
        U->>S: anonymize
        S-->>U: text + in-memory map
    end
    U->>R: execute(chain)
    R->>L: call target 1
    L-->>R: error / timeout
    R->>R: next target (blocked if residency violated)
    R->>L: call target 2
    L-->>R: response
    R-->>U: response (+ fallback event)
    U->>U: de-anonymize with in-memory map
    U->>A: AuditEntry (no content) + span (GenAI attrs) + events
    U-->>P: Result.ok(response)
    P-->>C: 200 + x-tamiz-route / x-tamiz-fallback
```

## Gateway layers and allowed dependencies

```mermaid
flowchart TB
    main["main.ts (composition root)"] --> infra
    main --> pres
    pres["presentation: routes, middlewares, mappers"] --> app
    pres --> contracts["packages/contracts (Zod)"]
    infra["infrastructure: llm, privacy, persistence, cache, telemetry, config"] --> app
    app["application: ports, use-cases, resilience"] --> dom
    dom["domain: model, errors, result"]
```

Rules enforced by `.dependency-cruiser.cjs` (feature 001):

| From | May import |
|---|---|
| `domain` | nothing |
| `application` | `domain` |
| `infrastructure` | `application`, `domain` |
| `presentation` | `application`, `domain`, `packages/contracts` |
| `main.ts` | everything (only place that imports `infrastructure`) |

## Privacy service layers

`services/privacy/src/privacy/{domain,application,infrastructure,api}/` mirrors the
gateway: recognizers and sensitivity rules in `domain`, analyze/anonymize use cases in
`application`, Presidio and spaCy engines in `infrastructure`, FastAPI routers in `api`.

## Dashboard

Organised by feature, routes stay thin:

```
apps/dashboard/src/
├── app/                 routes only
├── features/            live-traffic, audit-log, policy-editor, cost-analytics, eval-results
├── components/ui/       shadcn
└── lib/api-client.ts    typed Hono RPC client (hc)
```
