/**
 * The gateway for the dashboard's browser flows (spec 008 research R-13, tasks.md T014).
 *
 * The real `createApp` with in-memory adapters, the default policy, a scripted fake
 * detector and providers that throw if called. A control server on `127.0.0.1` lets the
 * Playwright tests seed audit entries, open circuits, toggle a detector outage, read which
 * requests reached the gateway (with their `Authorization` header) and reset everything.
 * The control server exists only in this script; nothing here is used in production.
 *
 *   pnpm --filter @tamiz/gateway e2e-gateway
 *
 * Environment (all optional, test values only):
 *   TAMIZ_E2E_GATEWAY_PORT   the gateway (default 3210)
 *   TAMIZ_E2E_CONTROL_PORT   the control server (default 3211)
 *   TAMIZ_E2E_ADMIN_KEY      the admin key of client `dashboard`
 *   TAMIZ_E2E_CLIENT_KEY     a client key of client `demo`
 */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { AuditEntrySchema } from "@tamiz/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { withAudit, withAuditStream } from "../src/application/audit/with-audit.js";
import type { DetectionCachePort } from "../src/application/ports/detection-cache.port.js";
import type { LoggerPort } from "../src/application/ports/logger.port.js";
import type { PiiDetectorPort } from "../src/application/ports/pii-detector.port.js";
import { costReport } from "../src/application/use-cases/cost-report.js";
import { inspectSensitivity } from "../src/application/use-cases/inspect-sensitivity.js";
import { providerHealth } from "../src/application/use-cases/provider-health.js";
import { queryAuditLog } from "../src/application/use-cases/query-audit-log.js";
import {
  type RouteInferenceDeps,
  routeInference,
} from "../src/application/use-cases/route-inference.js";
import { simulatePolicy } from "../src/application/use-cases/simulate-policy.js";
import { streamInference } from "../src/application/use-cases/stream-inference.js";
import type { AuditEntry } from "../src/domain/model/audit-entry.js";
import {
  type DetectedEntity,
  type EntityKind,
  type Inspection,
  SENSITIVITY_LEVELS,
  type SensitivityLevel,
} from "../src/domain/model/sensitivity.js";
import type { Milliseconds, TargetId } from "../src/domain/model/units.js";
import { hashApiKey, verifyPrincipal } from "../src/infrastructure/auth/api-keys.js";
import { createInMemoryAuditLog } from "../src/infrastructure/cache/in-memory-audit-log.js";
import { createInMemoryCircuitState } from "../src/infrastructure/cache/in-memory-circuit-state.js";
import { systemClock } from "../src/infrastructure/clock/system-clock.js";
import { loadPolicyFile } from "../src/infrastructure/policy/file-policy-loader.js";
import { createInMemoryPolicyRepository } from "../src/infrastructure/policy/in-memory-policy-repository.js";
import { loadAnonymizationNotice } from "../src/infrastructure/privacy/anonymization-notice.js";
import { createApp } from "../src/presentation/app.js";

const {
  TAMIZ_E2E_GATEWAY_PORT,
  TAMIZ_E2E_CONTROL_PORT,
  TAMIZ_E2E_ADMIN_KEY,
  TAMIZ_E2E_CLIENT_KEY,
} = process.env;
const GATEWAY_PORT = Number(TAMIZ_E2E_GATEWAY_PORT ?? 3210);
const CONTROL_PORT = Number(TAMIZ_E2E_CONTROL_PORT ?? 3211);
const ADMIN_KEY = TAMIZ_E2E_ADMIN_KEY ?? "tmz_e2e-dashboard-admin-key-not-a-secret-0000";
const CLIENT_KEY = TAMIZ_E2E_CLIENT_KEY ?? "tmz_e2e-demo-client-key-not-a-secret-000000";

/**
 * Fixture markers the fake detector finds, wherever they appear in a message. Synthetic
 * values only (the DNI has a valid control letter, the IBAN a valid checksum).
 */
const MARKERS: ReadonlyArray<{
  readonly text: string;
  readonly kind: EntityKind;
  readonly level: SensitivityLevel;
}> = [
  { text: "12345678Z", kind: "DNI", level: "critical" },
  { text: "X1234567L", kind: "NIE", level: "critical" },
  { text: "ES9121000418450200051332", kind: "IBAN", level: "critical" },
  { text: "ana.garcia@example.com", kind: "EMAIL", level: "high" },
  { text: "612345678", kind: "PHONE", level: "high" },
  { text: "Ana García", kind: "PERSON", level: "high" },
  { text: "Valladolid", kind: "LOCATION", level: "low" },
];

const quietLogger: LoggerPort = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Never stores: a detector outage toggled after a clean answer must still be seen. */
const noCache: DetectionCachePort = { get: () => undefined, set: () => {} };

function scriptedDetector(isDown: () => boolean): PiiDetectorPort {
  return {
    async inspect(messages) {
      if (isDown()) return { status: "failed", reason: "unavailable" };
      const entities: DetectedEntity[] = [];
      let level: SensitivityLevel = "none";
      messages.forEach((content, messageIndex) => {
        for (const marker of MARKERS) {
          let start = content.indexOf(marker.text);
          while (start !== -1) {
            entities.push({
              messageIndex,
              kind: marker.kind,
              start,
              end: start + marker.text.length,
              score: 0.95,
            });
            if (SENSITIVITY_LEVELS.indexOf(marker.level) > SENSITIVITY_LEVELS.indexOf(level)) {
              level = marker.level;
            }
            start = content.indexOf(marker.text, start + marker.text.length);
          }
        }
      });
      entities.sort((a, b) => a.messageIndex - b.messageIndex || a.start - b.start);
      return { status: "ok", level, entities } satisfies Inspection;
    },
  };
}

const neverCalled = () =>
  Promise.reject(new Error("the E2E gateway has no providers: no screen may call one"));

const policyResult = await loadPolicyFile(resolve(import.meta.dirname, "../policies/default.yaml"));
if (!policyResult.ok) throw new Error("the default policy must load");
const policy = policyResult.value;
const noticeResult = loadAnonymizationNotice();
if (!noticeResult.ok) throw new Error("the anonymization notice must load");
const anonymizationNotice = noticeResult.value;

const keys = [
  { clientId: "dashboard", keyHash: hashApiKey(ADMIN_KEY), role: "admin" as const },
  { clientId: "demo", keyHash: hashApiKey(CLIENT_KEY) },
];

/** Everything a reset discards: audit entries, circuits, the outage flag, the request log. */
function buildState() {
  let detectorDown = false;
  const audit = createInMemoryAuditLog();
  const circuitState = createInMemoryCircuitState(systemClock);
  const deps: RouteInferenceDeps = {
    policies: createInMemoryPolicyRepository(policy),
    providers: { resolve: () => ({ complete: neverCalled, stream: neverCalled }) },
    clock: systemClock,
    circuitState,
    events: { emit: () => {} },
    random: Math.random,
    inspect: inspectSensitivity({
      detector: scriptedDetector(() => detectorDown),
      cache: noCache,
      clock: systemClock,
      events: { emit: () => {} },
      hash: (text) => createHash("sha256").update(text).digest("hex"),
      timeoutMs: 2_000 as Milliseconds,
    }),
    anonymizationNotice,
  };
  const auditDeps = {
    audit,
    clock: systemClock,
    policies: deps.policies,
    hash: (messages: ReadonlyArray<unknown>) =>
      createHmac("sha256", "e2e-audit-key").update(JSON.stringify(messages)).digest("hex"),
    newId: randomUUID,
  };
  const app = createApp({
    clock: systemClock,
    version: "0.0.0-e2e",
    startedAt: systemClock.now(),
    logger: quietLogger,
    routeInference: withAudit(routeInference(deps), auditDeps),
    streamInference: withAuditStream(streamInference(deps), auditDeps),
    simulatePolicy: simulatePolicy(deps),
    queryAuditLog: queryAuditLog(audit),
    costReport: costReport({ reader: audit, policies: deps.policies }),
    providerHealth: providerHealth({
      reader: audit,
      policies: deps.policies,
      circuitState,
      clock: systemClock,
    }),
    authenticate: (key) => verifyPrincipal(key, keys),
  });
  const requests: Array<{ method: string; path: string; authorization: string | null }> = [];
  return {
    app,
    audit,
    circuitState,
    requests,
    setDetectorDown: (down: boolean) => {
      detectorDown = down;
    },
  };
}

let state = buildState();

serve({
  port: GATEWAY_PORT,
  hostname: "127.0.0.1",
  fetch: (request) => {
    const url = new URL(request.url);
    state.requests.push({
      method: request.method,
      path: url.pathname + url.search,
      authorization: request.headers.get("authorization"),
    });
    return state.app.fetch(request);
  },
});

const control = new Hono();
control.get("/__e2e/requests", (c) => c.json({ requests: state.requests }));
control.post("/__e2e/reset", (c) => {
  state = buildState();
  return c.json({ ok: true });
});
control.post("/__e2e/audit", async (c) => {
  const body: unknown = await c.req.json();
  const parsed = z.array(AuditEntrySchema).safeParse(Array.isArray(body) ? body : [body]);
  if (!parsed.success) return c.json({ ok: false, issues: parsed.error.issues }, 400);
  // The contract and the domain entry have the same shape; the brands are compile-time only.
  for (const entry of parsed.data) state.audit.append(entry as unknown as AuditEntry);
  return c.json({ ok: true, appended: parsed.data.length });
});
control.post("/__e2e/circuit", async (c) => {
  const parsed = z
    .object({ targetId: z.string().min(1), cooldownMs: z.int().min(1) })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ ok: false, issues: parsed.error.issues }, 400);
  await state.circuitState.open(
    parsed.data.targetId as TargetId,
    parsed.data.cooldownMs as Milliseconds,
  );
  return c.json({ ok: true });
});
control.post("/__e2e/detector", async (c) => {
  const parsed = z.object({ outage: z.boolean() }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ ok: false, issues: parsed.error.issues }, 400);
  state.setDetectorDown(parsed.data.outage);
  return c.json({ ok: true });
});

serve({ port: CONTROL_PORT, hostname: "127.0.0.1", fetch: control.fetch }, () => {
  process.stdout.write(
    `e2e gateway on http://127.0.0.1:${GATEWAY_PORT}, control on http://127.0.0.1:${CONTROL_PORT}\n`,
  );
});
