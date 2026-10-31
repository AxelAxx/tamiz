// @vitest-environment node
import * as crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { hashPassphrase, verifyPassphrase } from "../src/lib/server/passphrase";
import {
  clientAddress,
  createSessionStore,
  createSignInLimiter,
  SESSION_TTL_MS,
} from "../src/lib/server/session";
import { signSessionId, verifySessionCookie } from "../src/lib/server/session-cookie";

// Spec 008 US1-2, US1-4, FR-001, research R-03, data-model §3.1-3.2 (tasks.md T002).

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const SECRET = "a-session-secret-of-at-least-32-bytes!";

function fakeNow(start = Date.parse("2026-10-31T09:00:00.000Z")) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("passphrase hash", () => {
  it("US1-2: has the format scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>", () => {
    const stored = hashPassphrase("correct horse battery staple");
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/);
    const [, , , , salt, hash] = stored.split("$");
    expect(Buffer.from(salt ?? "", "base64")).toHaveLength(16);
    expect(Buffer.from(hash ?? "", "base64")).toHaveLength(32);
    // A fresh salt every time.
    expect(hashPassphrase("correct horse battery staple")).not.toBe(stored);
  });

  it("US1-2: verifies the right passphrase and refuses a wrong one, in constant time", () => {
    const stored = hashPassphrase("correct horse battery staple");
    vi.mocked(crypto.timingSafeEqual).mockClear();
    expect(verifyPassphrase("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassphrase("Correct horse battery staple", stored)).toBe(false);
    expect(verifyPassphrase("", stored)).toBe(false);
    expect(crypto.timingSafeEqual).toHaveBeenCalledTimes(3);
  });

  it("US1-2: a malformed stored hash never verifies", () => {
    expect(verifyPassphrase("x", "scrypt$16384$8$1$c2FsdA==")).toBe(false);
    expect(verifyPassphrase("x", "plain")).toBe(false);
  });
});

describe("session cookie", () => {
  it("US1-2: a tampered cookie is invalid", () => {
    const value = signSessionId("abc", SECRET);
    expect(verifySessionCookie(value, SECRET)).toBe("abc");
    expect(verifySessionCookie(`abd${value.slice(3)}`, SECRET)).toBeUndefined();
    expect(verifySessionCookie(`${value.slice(0, -1)}A`, SECRET)).toBeUndefined();
    expect(verifySessionCookie(value, `${SECRET}x`)).toBeUndefined();
    expect(verifySessionCookie("abc", SECRET)).toBeUndefined();
    expect(verifySessionCookie("", SECRET)).toBeUndefined();
  });
});

describe("session store", () => {
  it("US1-2: a session lasts 8 hours, absolute", () => {
    const clock = fakeNow();
    const store = createSessionStore({ secret: SECRET, now: clock.now });
    const { cookie, expiresAt } = store.create();
    expect(SESSION_TTL_MS).toBe(8 * 60 * 60 * 1000);
    expect(expiresAt).toBe(clock.now() + SESSION_TTL_MS);
    expect(store.isValid(cookie)).toBe(true);
    // Using the session does not extend it.
    clock.advance(SESSION_TTL_MS - 1);
    expect(store.isValid(cookie)).toBe(true);
    clock.advance(1);
    expect(store.isValid(cookie)).toBe(false);
    expect(store.size()).toBe(0);
  });

  it("US1-2: the id is 32 random bytes and the cookie is signed", () => {
    const store = createSessionStore({ secret: SECRET, now: fakeNow().now });
    const { cookie } = store.create();
    const id = verifySessionCookie(cookie, SECRET);
    expect(Buffer.from(id ?? "", "base64url")).toHaveLength(32);
    expect(store.isValid(cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBe(false);
    // A well-signed id the store never issued is refused.
    expect(store.isValid(signSessionId("forged", SECRET))).toBe(false);
  });

  it("US1-4: sign-out deletes the session, so a copied cookie stops working", () => {
    const store = createSessionStore({ secret: SECRET, now: fakeNow().now });
    const { cookie } = store.create();
    const other = store.create().cookie;
    store.revoke(cookie);
    expect(store.isValid(cookie)).toBe(false);
    expect(store.isValid(other)).toBe(true);
  });

  it("sweeps expired sessions", () => {
    const clock = fakeNow();
    const store = createSessionStore({ secret: SECRET, now: clock.now });
    store.create();
    clock.advance(SESSION_TTL_MS);
    store.create();
    store.sweep();
    expect(store.size()).toBe(1);
  });
});

describe("sign-in rate limit", () => {
  it("US1-2: 5 failures per 60 s per address, then refused for 60 s", () => {
    const clock = fakeNow();
    const limiter = createSignInLimiter({ now: clock.now });
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("203.0.113.1")).toEqual({ allowed: true });
      limiter.recordFailure("203.0.113.1");
    }
    expect(limiter.check("203.0.113.1")).toEqual({ allowed: false, retryAfterSeconds: 60 });
    // Another address is not affected.
    expect(limiter.check("203.0.113.2")).toEqual({ allowed: true });
    clock.advance(59_500);
    expect(limiter.check("203.0.113.1")).toEqual({ allowed: false, retryAfterSeconds: 1 });
    clock.advance(500);
    expect(limiter.check("203.0.113.1")).toEqual({ allowed: true });
  });

  it("US1-2: failures older than the window do not count", () => {
    const clock = fakeNow();
    const limiter = createSignInLimiter({ now: clock.now });
    for (let i = 0; i < 4; i++) limiter.recordFailure("a");
    clock.advance(60_000);
    limiter.recordFailure("a");
    expect(limiter.check("a")).toEqual({ allowed: true });
  });

  it("US1-2: a successful sign-in clears the failures", () => {
    const limiter = createSignInLimiter({ now: fakeNow().now });
    for (let i = 0; i < 4; i++) limiter.recordFailure("a");
    limiter.recordSuccess("a");
    for (let i = 0; i < 4; i++) limiter.recordFailure("a");
    expect(limiter.check("a")).toEqual({ allowed: true });
  });
});

describe("client address", () => {
  const headers = new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" });

  it("US1-2: X-Forwarded-For is used only with TAMIZ_DASHBOARD_TRUST_PROXY=true", () => {
    expect(clientAddress(headers, true)).toBe("198.51.100.7");
    // Without a trusted proxy the header is client-controlled: every attempt shares one
    // bucket, so a forged header cannot escape the limit.
    expect(clientAddress(headers, false)).toBe("direct");
    expect(clientAddress(new Headers(), false)).toBe("direct");
    expect(clientAddress(new Headers(), true)).toBe("unknown");
  });
});
