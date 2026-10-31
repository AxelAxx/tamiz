/**
 * The signed session cookie (spec 008 research R-03): `<id>.<HMAC-SHA-256(id) base64url>`.
 *
 * Free of `server-only` because `proxy.ts` checks the signature too; the secret is always
 * passed in, never read here.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "tamiz_session";

function signature(id: string, secret: string): string {
  return createHmac("sha256", secret).update(id).digest("base64url");
}

export function signSessionId(id: string, secret: string): string {
  return `${id}.${signature(id, secret)}`;
}

/** The session id when the signature is right, else `undefined`. */
export function verifySessionCookie(value: string, secret: string): string | undefined {
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const id = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(signature(id, secret));
  if (given.length !== expected.length) return undefined;
  return timingSafeEqual(given, expected) ? id : undefined;
}
