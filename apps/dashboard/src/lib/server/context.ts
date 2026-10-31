/**
 * The dashboard server's state, built once from the validated configuration.
 *
 * Kept on `globalThis`: Next.js may bundle route handlers apart, and a session created by
 * `/api/session` must be visible to every other handler of the same process.
 */
import "server-only";
import { type DashboardEnv, loadEnvOrExit } from "./env";
import { createGatewayClient, type GatewayCallLog, type GatewayClient } from "./gateway";
import {
  createSessionStore,
  createSignInLimiter,
  type SessionStore,
  type SignInLimiter,
} from "./session";

export interface ServerContext {
  readonly env: DashboardEnv;
  readonly sessions: SessionStore;
  readonly signIn: SignInLimiter;
  readonly gateway: GatewayClient;
  readonly log: (line: GatewayCallLog) => void;
}

const KEY = Symbol.for("tamiz.dashboard.context");
const SWEEP_EVERY_MS = 10 * 60 * 1000;

function build(): ServerContext {
  const env = loadEnvOrExit();
  const sessions = createSessionStore({ secret: env.sessionSecret, now: Date.now });
  setInterval(() => sessions.sweep(), SWEEP_EVERY_MS).unref();
  return {
    env,
    sessions,
    signIn: createSignInLimiter({ now: Date.now }),
    gateway: createGatewayClient({ baseUrl: env.gatewayUrl, adminKey: env.adminKey }),
    log: (line) => process.stdout.write(`${JSON.stringify({ msg: "gateway call", ...line })}\n`),
  };
}

export function serverContext(): ServerContext {
  const holder = globalThis as { [KEY]?: ServerContext };
  holder[KEY] ??= build();
  return holder[KEY];
}
