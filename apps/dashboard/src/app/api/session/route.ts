/**
 * `POST /api/session` signs in, `DELETE /api/session` signs out (spec 008 US1-2, US1-4,
 * research R-03). Both check the origin first; a wrong passphrase never says whether one
 * is configured.
 */
import { SignInRequestSchema } from "@/lib/schemas";
import { publicWrite, write } from "@/lib/server/bff";
import { serverContext } from "@/lib/server/context";
import { bffError, readCookie, readJson } from "@/lib/server/handler";
import { verifyPassphrase } from "@/lib/server/passphrase";
import { clientAddress, SESSION_TTL_MS } from "@/lib/server/session";
import { SESSION_COOKIE } from "@/lib/server/session-cookie";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function sessionCookie(value: string, maxAgeSeconds: number): string {
  const { hostname } = new URL(serverContext().env.publicOrigin);
  const secure = LOCAL_HOSTS.has(hostname) ? "" : "; Secure";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

export const POST = publicWrite(async (request) => {
  const { env, sessions, signIn } = serverContext();
  const address = clientAddress(request.headers, env.trustProxy);
  const check = signIn.check(address);
  if (!check.allowed) {
    return bffError(
      429,
      "rate_limited",
      "Too many failed attempts; try again later",
      {},
      { "retry-after": String(check.retryAfterSeconds) },
    );
  }
  const body = await readJson(request, SignInRequestSchema);
  if (!body.ok) return body.response;
  if (!verifyPassphrase(body.value.passphrase, env.passphraseHash)) {
    signIn.recordFailure(address);
    return bffError(401, "unauthenticated", "Wrong passphrase");
  }
  signIn.recordSuccess(address);
  const { cookie } = sessions.create();
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": sessionCookie(cookie, SESSION_TTL_MS / 1000) } },
  );
});

export const DELETE = write(async (request) => {
  const cookie = readCookie(request, SESSION_COOKIE);
  if (cookie !== undefined) serverContext().sessions.revoke(cookie);
  return Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie("", 0) } });
});
