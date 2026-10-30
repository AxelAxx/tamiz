import { resolve } from "node:path";
import {
  createFakeClock,
  createInMemoryPolicyRepository,
  createScriptedPort,
} from "@tamiz/test-utils";
import type { CircuitStatePort } from "../../src/application/ports/circuit-state.port.js";
import type {
  ProviderCompletion,
  ProviderCompletionInput,
} from "../../src/application/ports/llm-provider.port.js";
import type { LoggerPort } from "../../src/application/ports/logger.port.js";
import type { RoutingEventsPort } from "../../src/application/ports/routing-events.port.js";
import { routeInference } from "../../src/application/use-cases/route-inference.js";
import type { ProviderError } from "../../src/domain/errors.js";
import type { RoutingPolicy } from "../../src/domain/model/routing-policy.js";
import { ok, type Result } from "../../src/domain/result.js";
import { hashApiKey, verifyApiKey } from "../../src/infrastructure/auth/api-keys.js";
import { createInMemoryCircuitState } from "../../src/infrastructure/cache/in-memory-circuit-state.js";
import { loadPolicyFile } from "../../src/infrastructure/policy/file-policy-loader.js";
import { createApp } from "../../src/presentation/app.js";
import { noopLogger } from "./noop-logger.js";

/** A test key for the client `demo`; only its hash is given to the app. */
export const DEMO_KEY = "tmz_demo-test-key-not-a-secret-000000000000000";
export const DEMO_KEY_HASH = hashApiKey(DEMO_KEY);
export const AUTH = { authorization: `Bearer ${DEMO_KEY}` } as const;

export const START = new Date("2026-05-06T07:08:09.000Z");

export type CompletionResult = Result<ProviderCompletion, ProviderError>;

export async function defaultPolicy(): Promise<RoutingPolicy> {
  const loaded = await loadPolicyFile(resolve(import.meta.dirname, "../../policies/default.yaml"));
  if (!loaded.ok) throw new Error("the default policy must load");
  return loaded.value;
}

/** Chat dependencies for tests that never call `/v1/*`: any call fails the test. */
export const NO_CHAT = {
  routeInference: () => Promise.reject(new Error("routeInference must not be called")),
  authenticate: () => undefined,
} as const;

/** The app wired to the real use case, the default policy and a scripted provider. */
export async function createTestApp(
  options: {
    readonly script?: (
      input: ProviderCompletionInput,
    ) => CompletionResult | Promise<CompletionResult>;
    readonly logger?: LoggerPort;
    readonly policy?: RoutingPolicy;
    readonly circuitState?: CircuitStatePort;
    readonly events?: RoutingEventsPort;
  } = {},
) {
  const clock = createFakeClock(START);
  const provider = createScriptedPort<ProviderCompletionInput, CompletionResult>(
    options.script ??
      ((input) =>
        ok({
          text: "Hola.",
          finishReason: "stop",
          usage: { promptTokens: 12, completionTokens: 3 },
          modelName: `${input.target.model}-served`,
        })),
  );
  const route = routeInference({
    policies: createInMemoryPolicyRepository(options.policy ?? (await defaultPolicy())),
    providers: { resolve: () => ({ complete: provider.fn }) },
    clock,
    circuitState: options.circuitState ?? createInMemoryCircuitState(clock),
    events: options.events ?? { emit: () => {} },
    random: () => 0.5,
  });
  const records = [{ clientId: "demo", keyHash: DEMO_KEY_HASH }];
  const app = createApp({
    clock,
    version: "0.1.0",
    startedAt: START,
    logger: options.logger ?? noopLogger,
    routeInference: route,
    authenticate: (key) => verifyApiKey(key, records),
  });
  /** `app.request` with the fake clock driven, for paths that retry or wait (spec 003). */
  const send = (path: string, init?: RequestInit) =>
    clock.drive(Promise.resolve(app.request(path, init)));
  return { app, provider, clock, send };
}
