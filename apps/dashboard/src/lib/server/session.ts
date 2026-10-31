/**
 * Operator sessions and the sign-in rate limit, in memory (spec 008 FR-001, research R-03,
 * data-model §3.1-3.2). A restart signs every operator out; that is accepted for one
 * instance.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import { signSessionId, verifySessionCookie } from "./session-cookie";

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface SessionStore {
  /** A new session; the cookie carries `id.signature`. */
  create(): { readonly cookie: string; readonly expiresAt: number };
  /** The signature is right and the session exists and has not expired. */
  isValid(cookie: string): boolean;
  revoke(cookie: string): void;
  /** Removes expired sessions. */
  sweep(): void;
  size(): number;
}

export function createSessionStore(deps: {
  readonly secret: string;
  readonly now: () => number;
  readonly ttlMs?: number;
}): SessionStore {
  const ttlMs = deps.ttlMs ?? SESSION_TTL_MS;
  const expiries = new Map<string, number>();
  const idOf = (cookie: string) => verifySessionCookie(cookie, deps.secret);
  return {
    create() {
      const id = randomBytes(32).toString("base64url");
      const expiresAt = deps.now() + ttlMs;
      expiries.set(id, expiresAt);
      return { cookie: signSessionId(id, deps.secret), expiresAt };
    },
    isValid(cookie) {
      const id = idOf(cookie);
      if (id === undefined) return false;
      const expiresAt = expiries.get(id);
      if (expiresAt === undefined) return false;
      if (deps.now() >= expiresAt) {
        expiries.delete(id);
        return false;
      }
      return true;
    },
    revoke(cookie) {
      const id = idOf(cookie);
      if (id !== undefined) expiries.delete(id);
    },
    sweep() {
      const now = deps.now();
      for (const [id, expiresAt] of expiries) if (now >= expiresAt) expiries.delete(id);
    },
    size: () => expiries.size,
  };
}

export type SignInCheck =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

export interface SignInLimiter {
  check(address: string): SignInCheck;
  recordFailure(address: string): void;
  recordSuccess(address: string): void;
}

/** US1-2: `maxFailures` per `windowMs` per address, then refused for `blockMs`. */
export function createSignInLimiter(deps: {
  readonly now: () => number;
  readonly maxFailures?: number;
  readonly windowMs?: number;
  readonly blockMs?: number;
}): SignInLimiter {
  const maxFailures = deps.maxFailures ?? 5;
  const windowMs = deps.windowMs ?? 60_000;
  const blockMs = deps.blockMs ?? 60_000;
  const attempts = new Map<
    string,
    { failures: number; windowStart: number; blockedUntil?: number }
  >();
  return {
    check(address) {
      const blockedUntil = attempts.get(address)?.blockedUntil;
      const now = deps.now();
      if (blockedUntil === undefined || now >= blockedUntil) return { allowed: true };
      return { allowed: false, retryAfterSeconds: Math.ceil((blockedUntil - now) / 1000) };
    },
    recordFailure(address) {
      const now = deps.now();
      const current = attempts.get(address);
      const fresh =
        current === undefined ||
        now - current.windowStart >= windowMs ||
        (current.blockedUntil !== undefined && now >= current.blockedUntil);
      const entry = fresh ? { failures: 0, windowStart: now } : current;
      entry.failures += 1;
      if (entry.failures >= maxFailures) entry.blockedUntil = now + blockMs;
      attempts.set(address, entry);
    },
    recordSuccess(address) {
      attempts.delete(address);
    },
  };
}

/**
 * The address the rate limit counts by. Next.js route handlers do not expose the socket,
 * and Next.js keeps a client-sent `X-Forwarded-For`, so the header is used only behind a
 * trusted proxy (`TAMIZ_DASHBOARD_TRUST_PROXY=true`, first hop). Otherwise every attempt
 * shares one bucket: a forged header cannot escape the limit.
 */
export function clientAddress(headers: Headers, trustProxy: boolean): string {
  if (!trustProxy) return "direct";
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first === undefined || first === "" ? "unknown" : first;
}
