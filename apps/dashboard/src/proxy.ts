/**
 * The page gate (spec 008 US1-1, research R-03). Next.js 16 `proxy.ts` (formerly
 * `middleware.ts`) cannot see the in-memory session store, so it checks the cookie's
 * signature only and redirects to `/sign-in` otherwise; every `/api/*` handler checks the
 * store itself and answers 401.
 */
import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionCookie } from "./lib/server/session-cookie";

export function proxy(request: NextRequest): NextResponse {
  const { TAMIZ_DASHBOARD_SESSION_SECRET: secret = "" } = process.env;
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (secret !== "" && cookie !== undefined && verifySessionCookie(cookie, secret) !== undefined) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/sign-in", request.url));
}

export const config = {
  // Every page except the sign-in page; data endpoints and assets are not pages.
  matcher: ["/((?!api/|_next/|sign-in|favicon\\.ico).*)"],
};
