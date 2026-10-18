# Tamiz — Privacy-Aware LLM Gateway

> **Usa el mejor modelo para cada petición sin que los datos sensibles salgan de donde deben.**

**Naming.** Marca: **Tamiz** (README, LinkedIn, web), con el subtítulo *Privacy-aware LLM gateway*. Handle técnico: `tamiz`; si está ocupado en GitHub, npm o como dominio, se usa `tamiz-ai` (paquetes del monorepo: `@tamiz/*` o `@tamiz-ai/*`).

Documento fundacional del proyecto: visión, constitución, stack, arquitectura, flujo spec-driven y roadmap. Es la fuente de verdad desde la que se generan los specs de cada feature.

---

## 1. Visión

**Problema.** Los equipos pequeños en Europa quieren usar LLMs, pero no pueden enviar datos personales a cualquier proveedor. Hoy lo resuelven mal: o no usan IA con esos datos, o la usan sin control.

**Solución.** Un gateway self-hosted que se coloca entre la aplicación y los proveedores de LLM:

1. **Inspecciona** cada petición y detecta datos personales (DNI/NIE, IBAN, emails, teléfonos, nombres…).
2. **Enruta** según una política declarativa:
   - Con datos sensibles → modelo local (Ollama) o proveedor con residencia UE, o anonimiza antes de enviar.
   - Sin datos sensibles → el modelo más barato que cumple el umbral de calidad para ese tipo de tarea.
3. **Resiste** caídas: fallback entre proveedores, circuit breaker, reintentos con backoff, timeouts.
4. **Audita** cada decisión: qué se detectó, qué regla se aplicó, a qué modelo fue, coste y latencia. Sin almacenar el contenido en claro.
5. **Demuestra** que funciona: evals de fuga de privacidad y calidad de routing como gate en CI.

**Público objetivo.** Startups y pymes europeas de sectores regulados (salud, legal, fintech, RR. HH.) sin equipo de plataforma.

**No-objetivos.** No es un producto de cumplimiento legal certificado. La detección de PII es estadística: se presenta como una capa de defensa con métricas publicadas, no como una garantía.

**Relación con Citara.** Proyecto independiente. Integración opcional al final: Citara envía sus llamadas LLM a través de Tamiz.

---

## 2. Constitución (principios no negociables)

Este bloque es el input para `/speckit.constitution`.

1. **Clean Architecture estricta.** El dominio no importa nada de infraestructura ni de frameworks. Las dependencias apuntan hacia dentro. Se valida automáticamente en CI.
2. **Contract-first.** Todo contrato público (HTTP, eventos, herramientas MCP) se define primero como esquema Zod en `packages/contracts`. Tipos y OpenAPI se derivan de ahí, nunca a mano.
3. **Spec antes que código.** Ninguna feature se implementa sin `spec.md`, `plan.md` y `tasks.md` aprobados.
4. **Las evals son spec ejecutable.** Todo comportamiento de IA tiene un dataset de evals con umbral. Si baja del umbral, el CI falla.
5. **Privacy by default.** El contenido de los prompts nunca se escribe en logs, trazas ni base de datos. Solo metadatos y hashes.
6. **Fail fast, nunca en silencio.** Errores tipados en dominio (`Result`), excepciones solo en los bordes. Todo fallback se registra como evento observable.
7. **TypeScript estricto.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Prohibido `any`. Branded types para identificadores.
8. **Testabilidad.** Cada caso de uso se prueba con adaptadores falsos en memoria, sin red ni base de datos.
9. **Composición sobre herencia.** Middlewares y estrategias de routing componibles, sin jerarquías de clases.
10. **Simplicidad.** Sin abstracciones especulativas. Se añade un puerto cuando hay un segundo adaptador real o cuando hace falta para testear.

---

## 3. Stack tecnológico

Versiones verificadas a octubre de 2026. Se fijan las mayores; los parches se actualizan con Renovate.

### Monorepo y tooling
| Pieza | Elección | Motivo |
|---|---|---|
| Runtime | Node.js 22 LTS | Estable y soportado por todo el stack |
| Package manager | pnpm (workspaces) | Rápido y estricto con dependencias fantasma |
| Orquestación | Turborepo | Caché de builds/tests por paquete |
| Lenguaje | TypeScript 5.x estricto | Tipado extremo a extremo |
| Lint + format | Biome | Un solo binario, muy rápido |
| Límites de arquitectura | dependency-cruiser | Rompe el CI si una capa importa a otra prohibida |
| Commits | Conventional Commits + commitlint | Changelog y versiones automáticas |
| Dependencias | Renovate | Actualizaciones automáticas con PR |

### Backend — Gateway (`apps/gateway`)
| Pieza | Elección | Motivo |
|---|---|---|
| HTTP | **Hono v4** + `@hono/node-server` | TypeScript-first, inferencia de tipos de extremo a extremo, ligero |
| Validación | **Zod** + `@hono/zod-validator` | Una sola fuente para tipos y validación |
| OpenAPI | `@hono/zod-openapi` | Docs generadas desde los contratos |
| Capa LLM | **Vercel AI SDK 6** (`ai`, `@ai-sdk/*`) | Abstracción multi-proveedor, streaming, tools y cliente MCP |
| ORM | **Drizzle ORM** + Drizzle Kit | SQL tipado, migraciones versionadas |
| Base de datos | **PostgreSQL 17** | Audit log, políticas, métricas agregadas |
| Caché / rate limit / circuit state | **Redis (Valkey)** | Estado compartido entre instancias |
| Logging | **pino** (JSON estructurado) | Rápido, con redacción de campos |
| Trazas | **OpenTelemetry** con convenciones semánticas GenAI | Estándar del sector para observar llamadas LLM |
| Resiliencia | Implementación propia (circuit breaker, retry, timeout) | Es el núcleo del proyecto: se escribe, no se importa |

### Servicio de privacidad (`services/privacy`)
| Pieza | Elección | Motivo |
|---|---|---|
| Lenguaje | Python 3.12 | Presidio es Python; demuestra perfil políglota |
| Gestor | **uv** | Estándar actual, rapidísimo |
| HTTP | **FastAPI** + Pydantic v2 | Contrato OpenAPI que el gateway consume |
| Detección PII | **Presidio** (Analyzer + Anonymizer) | Referencia open source para detectar y anonimizar PII |
| NLP | spaCy con modelo en español (`es_core_news_lg`) | NER para nombres y ubicaciones |
| Reconocedores propios | DNI, NIE, CIF, IBAN ES, teléfono ES, NSS | Los genéricos no cubren identificadores españoles |
| Calidad | Ruff + mypy estricto + pytest | Mismo nivel de exigencia que en TS |

> Nota: Presidio pasó de Microsoft a la organización independiente Data Privacy Stack en julio de 2026, con la misma licencia MIT. Las imágenes Docker están en `ghcr.io/data-privacy-stack/presidio-*`.

### Modelos
| Ruta | Ejemplo | Uso |
|---|---|---|
| Local | **Ollama** (Llama / Qwen / Mistral pequeño) | Peticiones con PII sin anonimizar |
| Residencia UE | Mistral API | Datos sensibles anonimizados o tareas de calidad alta |
| Frontier | Anthropic / OpenAI | Tareas sin PII que requieren máxima calidad |
| Barato | Modelo pequeño de cualquier proveedor | Clasificación y tareas cortas |

### Frontend — Dashboard (`apps/dashboard`)
| Pieza | Elección | Motivo |
|---|---|---|
| Framework | **Next.js 16** (App Router) + **React 19** | Versión Active LTS; Next 15 llega a fin de vida el 21-10-2026 |
| Estilos | **Tailwind CSS v4** (config CSS-first) | Estándar actual |
| Componentes | **shadcn/ui** | Componentes accesibles copiados al repo, totalmente personalizables |
| Gráficas | shadcn Charts (Recharts) | Coherente con el sistema de diseño |
| Tablas | TanStack Table | Audit log con filtros y paginación |
| Datos | TanStack Query + cliente RPC tipado de Hono (`hc`) | Tipos compartidos con el backend sin generar código |
| Formularios | React Hook Form + Zod | Editor de políticas con validación compartida |
| Animación | Motion | Microinteracciones del flujo de decisión |
| Iconos | lucide-react | El estándar con shadcn |
| Tema | next-themes | Modo claro/oscuro |

### Agente y MCP (`apps/mcp-server`)
| Pieza | Elección | Motivo |
|---|---|---|
| Servidor MCP | `@modelcontextprotocol/sdk` (TypeScript) | SDK oficial |
| Cliente/agente | AI SDK 6 (agentes + cliente MCP) | Mismo stack que el gateway |
| Dogfooding | El agente llama al LLM **a través de Tamiz** | Demuestra el gateway en uso real |

### Testing y calidad
| Nivel | Herramienta |
|---|---|
| Unit (dominio, casos de uso) | **Vitest** |
| Integración (adaptadores) | Vitest + **Testcontainers** (Postgres, Redis) |
| Mocks HTTP de proveedores | **MSW** |
| E2E dashboard | **Playwright** |
| Contratos | Tests que validan respuestas reales contra los esquemas Zod |
| Evals de IA | Runner propio en `packages/evals` (TS) con datasets versionados |

### Infra y entrega
| Pieza | Elección |
|---|---|
| Local | Docker Compose (gateway, privacy, dashboard, postgres, redis, ollama, jaeger) |
| Trazas en local | Jaeger (OTLP) |
| CI | GitHub Actions: lint → typecheck → architecture → test → evals → build |
| Imágenes | Docker multi-stage, usuario no root |
| Demo pública | Dashboard en Vercel + gateway/privacy en un VPS europeo (p. ej. Hetzner) |

---

## 4. Arquitectura

### 4.1 Vista de sistema

```
                ┌───────────────────────────┐
  Client app ──▶│  Gateway (Hono)           │
  / Agent       │  presentation             │
                │    └▶ application         │──▶ Privacy service (FastAPI + Presidio)
                │         └▶ domain         │
                │    infrastructure ────────│──▶ Ollama (local)
                │                           │──▶ Mistral (EU)
                │                           │──▶ Anthropic / OpenAI
                └─────┬───────────┬─────────┘
                      │           │
                 PostgreSQL     Redis        OTel ──▶ Jaeger
                      ▲
                      │ (read-only API)
                Dashboard (Next.js)
```

### 4.2 Flujo de una petición

1. `POST /v1/chat/completions` (compatible con el formato OpenAI para adopción directa).
2. Validación del contrato (Zod).
3. `ClassifyTask`: tipo de tarea y tamaño (reglas, después clasificador ligero).
4. `InspectSensitivity`: llamada al servicio de privacidad → entidades detectadas y nivel de sensibilidad.
5. `RoutingPolicy.decide()` (dominio puro): devuelve un `RoutingDecision` con cadena de fallback ordenada y acción de privacidad (`allow`, `anonymize`, `restrict_to_local`, `block`).
6. Ejecución con resiliencia: timeout → reintento → circuit breaker → siguiente target de la cadena. Si un fallback viola la política de residencia, se **bloquea** en vez de degradar.
7. Si hubo anonimización, se desanonimiza la respuesta con el mapa de la sesión (nunca persistido).
8. `AuditEntry` + span OTel con atributos GenAI y eventos `routing.decision` / `routing.fallback`.

### 4.3 Capas del gateway

```
apps/gateway/src/
├── domain/                     # Pure business rules. Zero external imports.
│   ├── model/                  # Entities and value objects
│   │   ├── inference-request.ts
│   │   ├── model-target.ts     # provider, model, region, residency, cost
│   │   ├── sensitivity.ts      # SensitivityLevel, DetectedEntity
│   │   ├── routing-policy.ts   # Declarative rules + decide()
│   │   ├── routing-decision.ts
│   │   └── audit-entry.ts
│   ├── errors.ts               # Typed domain errors
│   └── result.ts               # Result<T, E>
├── application/                # Use cases + ports. Depends only on domain.
│   ├── ports/
│   │   ├── llm-provider.port.ts
│   │   ├── pii-detector.port.ts
│   │   ├── audit-log.port.ts
│   │   ├── policy-repository.port.ts
│   │   ├── circuit-state.port.ts
│   │   └── clock.port.ts
│   ├── use-cases/
│   │   ├── route-inference.ts
│   │   ├── stream-inference.ts
│   │   ├── simulate-policy.ts  # Dry-run: what would happen with this prompt?
│   │   └── query-audit-log.ts
│   └── resilience/             # Retry, timeout, circuit breaker as composable policies
├── infrastructure/             # Port adapters. Depends on application.
│   ├── llm/                    # AI SDK adapters per provider
│   ├── privacy/                # HTTP client for services/privacy
│   ├── persistence/            # Drizzle schema, repositories, migrations
│   ├── cache/                  # Redis circuit state, rate limiting
│   ├── telemetry/              # OTel setup, GenAI attributes
│   └── config/                 # Env schema (Zod), fails on boot if invalid
├── presentation/               # HTTP. Depends on application.
│   ├── routes/
│   ├── middlewares/            # auth, request-id, error mapping
│   └── mappers/                # DTO <-> domain
└── main.ts                     # Composition root: the only place that wires adapters
```

**Reglas de dependencia (dependency-cruiser):**
- `domain` → nada.
- `application` → `domain`.
- `infrastructure` → `application`, `domain`.
- `presentation` → `application`, `domain`, `packages/contracts`.
- Solo `main.ts` importa de `infrastructure`.

### 4.4 Estructura del monorepo

```
tamiz/
├── apps/
│   ├── gateway/            # Hono API (Clean Architecture, ver 4.3)
│   ├── dashboard/          # Next.js 16
│   └── mcp-server/         # MCP tools over the gateway's admin API
├── services/
│   └── privacy/            # FastAPI + Presidio (Python, uv)
│       └── src/privacy/{domain,application,infrastructure,api}/
├── packages/
│   ├── contracts/          # Zod schemas: the single source of truth for APIs
│   ├── evals/              # Eval runner, datasets, scorers
│   ├── tsconfig/           # Shared strict configs
│   └── test-utils/         # In-memory fakes for ports, builders
├── specs/                  # Spec Kit output, one folder per feature
├── docs/
│   ├── adr/                # Architecture Decision Records
│   └── architecture.md     # C4 diagrams (Mermaid)
├── .specify/               # Spec Kit memory: constitution, templates
├── docker-compose.yml
├── turbo.json
├── biome.json
├── .dependency-cruiser.cjs
└── README.md
```

### 4.5 Dashboard (Next.js)

Organización por feature, no por tipo:

```
apps/dashboard/src/
├── app/                    # Routes only: thin, compose features
├── features/
│   ├── live-traffic/       # Real-time request stream and decision flow
│   ├── audit-log/
│   ├── policy-editor/      # Edit YAML/JSON policy + dry-run simulator
│   ├── cost-analytics/
│   └── eval-results/
├── components/ui/          # shadcn
└── lib/api-client.ts       # Typed Hono RPC client
```

Pantallas clave para la demo:
1. **Live traffic:** cada petición como fila animada con badge de ruta (`local`, `eu`, `frontier`) y entidades detectadas.
2. **Simulador de políticas:** pegas un texto, ves qué detectaría y a dónde iría. Es el gancho del GIF del README.
3. **Coste:** gasto real frente a "todo al modelo frontier".
4. **Evals:** tasa de fugas y calidad por versión de política.

### 4.6 Herramientas MCP

| Herramienta | Qué hace |
|---|---|
| `simulate_routing` | Dry-run de una política sobre un texto |
| `query_audit_log` | Busca decisiones por fecha, ruta o entidad |
| `get_cost_report` | Gasto agregado por ruta y modelo |
| `get_provider_health` | Estado de circuit breakers y latencias |

Permisos por herramienta y solo lectura por defecto. El agente responde preguntas como *"¿por qué subió el gasto ayer?"*.

---

## 5. Flujo spec-driven

Herramienta: **GitHub Spec Kit** (open source, MIT, compatible con Claude Code y VS Code).

```bash
uvx --from git+https://github.com/github/spec-kit.git specify init tamiz
```

Ciclo por feature:

| Paso | Comando | Artefacto |
|---|---|---|
| 0. Principios (una vez) | `/speckit.constitution` | `.specify/memory/constitution.md` (sección 2 de este doc) |
| 1. Qué y por qué | `/speckit.specify` | `specs/NNN-feature/spec.md` |
| 2. Cómo | `/speckit.plan` | `plan.md`, `data-model.md`, `contracts/` |
| 3. Desglose | `/speckit.tasks` | `tasks.md` (tareas pequeñas y testeables) |
| 4. Implementación | `/speckit.implement` | Código + tests |

**Reglas propias sobre Spec Kit:**
- Cada `spec.md` incluye criterios de aceptación en Given/When/Then que se traducen 1:1 a tests.
- Cada feature con IA añade su dataset en `packages/evals/datasets/` y un umbral en `spec.md`.
- Las decisiones de arquitectura relevantes se registran como ADR en `docs/adr/`.
- Revisión humana obligatoria entre cada paso: el spec gobierna, la IA ejecuta.

### Features iniciales (orden de specs)

1. `001-contracts-and-skeleton` — Monorepo, contratos, health check, CI con límites de arquitectura.
2. `002-provider-routing` — Puerto LLM, adaptadores, política por reglas, endpoint compatible OpenAI.
3. `003-resilience` — Timeout, retry, circuit breaker, cadenas de fallback, streaming.
4. `004-privacy-service` — FastAPI + Presidio + reconocedores españoles.
5. `005-privacy-aware-routing` — Política de sensibilidad, anonimización reversible, bloqueo.
6. `006-audit-and-telemetry` — Audit log sin contenido, OTel GenAI, Jaeger.
7. `007-evals-gate` — Runner, datasets de fuga y routing, gate en CI.
8. `008-dashboard` — Las cuatro pantallas.
9. `009-mcp-agent` — Servidor MCP y agente sobre Tamiz.
10. `010-citara-integration` (opcional).

---

## 6. Buenas prácticas transversales

**Código**
- Errores de dominio como `Result<T, E>` tipado; los adaptadores convierten excepciones externas en errores de dominio.
- Branded types para IDs (`RequestId`, `PolicyId`) y unidades (`Usd`, `Milliseconds`).
- Variables de entorno validadas con Zod al arrancar: si falta algo, el proceso no arranca.
- Funciones de dominio puras y deterministas; el tiempo entra por `ClockPort`.
- Early return, sin anidación profunda; funciones cortas con una sola responsabilidad.

**IA en producción**
- Todo prompt de sistema versionado en el repo, nunca inline.
- Timeouts explícitos por proveedor y por tipo de tarea.
- Fallback nunca silencioso: evento en la traza + métrica + campo en la respuesta (`x-tamiz-route`, `x-tamiz-fallback`).
- Un fallback que violaría la residencia de datos **falla** en lugar de degradar.
- Coste calculado por petición y almacenado en el audit log.

**Seguridad y privacidad**
- API keys por cliente, con hash en BD.
- Redacción de campos sensibles en pino (`prompt`, `messages`, `authorization`).
- El mapa de anonimización vive solo en memoria durante la petición.
- Contenedores sin root, dependencias escaneadas en CI.

**Git y CI**
- Trunk-based con PRs pequeños; un PR por tarea de `tasks.md`.
- Pipeline: `biome check` → `tsc --noEmit` → `depcruise` → `vitest` → `evals` → `build` → `docker build`.
- Un PR que baja una métrica de eval por debajo del umbral no se puede mergear.

---

## 7. Estrategia de testing

| Capa | Tipo de test | Dependencias reales |
|---|---|---|
| Domain | Unit (y property-based para `RoutingPolicy.decide`) | Ninguna |
| Application | Unit con fakes de `packages/test-utils` | Ninguna |
| Infrastructure | Integración | Postgres/Redis con Testcontainers, proveedores con MSW |
| Presentation | Contrato + HTTP in-process (`app.request()` de Hono) | Fakes |
| Privacy service | pytest con corpus sintético en español | Presidio real |
| Dashboard | Playwright sobre flujos clave | Gateway con fakes |
| Sistema | Evals | Modelos reales (local en CI) |

---

## 8. Evals (el corazón del proyecto)

Datasets sintéticos y versionados. **Nunca datos reales.**

| Eval | Métrica | Umbral inicial |
|---|---|---|
| **Fuga de PII** | % de entidades sensibles que llegan a un proveedor no permitido | 0 % en críticos (DNI, IBAN); < 2 % en nombres |
| **Detección** | Precision / recall por tipo de entidad | Recall ≥ 0,95 en identificadores estructurados |
| **Routing** | % de peticiones enviadas a la ruta esperada | ≥ 95 % |
| **Calidad** | LLM-as-judge sobre la respuesta frente a referencia | No baja más de 5 % respecto a la ruta frontier |
| **Coste** | Coste total frente a la línea base "todo frontier" | Reportado, sin umbral |

Los resultados se publican en el README y en la pantalla de evals del dashboard.

---

## 9. Roadmap (2 semanas)

| Días | Entrega |
|---|---|
| 1 | Spec Kit + constitución + specs 001 y 002. Monorepo, CI y límites de arquitectura en verde |
| 2–3 | Routing multi-proveedor + endpoint compatible OpenAI + tests |
| 4 | Resiliencia y streaming con fallback |
| 5–6 | Servicio de privacidad con reconocedores españoles + routing consciente de PII |
| 7 | Audit log + OpenTelemetry + Jaeger |
| 8 | Evals + gate en CI |
| 9–11 | Dashboard (live traffic, simulador, coste, evals) |
| 12 | Servidor MCP + agente |
| 13 | Docker Compose completo, deploy de la demo |
| 14 | README, GIF, diagramas, post de LinkedIn y case study para la web |

Si hay retrasos, se recorta en este orden: agente MCP → pantalla de coste → clasificador aprendido. Nunca evals ni privacidad.

---

## 10. Entrega y marketing

**README**
1. Pitch de una línea + GIF del simulador (petición con DNI → detectada → desviada a local → auditada).
2. `docker compose up` y funcionando en 2 minutos.
3. Tabla de resultados de evals.
4. Diagrama de arquitectura (Mermaid) y enlace a los ADR.
5. Sección "Limitaciones" honesta.

**LinkedIn.** Post orientado al problema: lo aprendido trabajando con datos clínicos reales sobre enviar PII a un LLM, y cómo se resolvió con un gateway. Enlace al repo y a la demo.

**Web.** Case study: problema → decisiones de arquitectura → trade-offs → métricas.

---

## 11. Trade-offs y riesgos

- **Detección de PII probabilística.** Los nombres poco comunes se escapan. Mitigación: reconocedores propios, evals públicas y opción `restrict_to_local` para datos de máxima sensibilidad.
- **Servicio Python adicional.** Más piezas que operar, a cambio de usar la mejor herramienta de PII disponible y mostrar un perfil políglota.
- **Latencia añadida.** La inspección suma tiempo a cada petición. Mitigación: llamada en paralelo con la clasificación y caché de resultados por hash.
- **Modelo local en la demo pública.** Ollama necesita recursos. Mitigación: modelo pequeño cuantizado; si no cabe, demo con ruta UE y local solo en `docker compose`.
- **Resiliencia propia frente a librería.** Más código que mantener, pero es precisamente lo que el proyecto demuestra.
- **Spec-driven añade ceremonia.** Se compensa manteniendo los specs cortos y centrados en criterios de aceptación.
