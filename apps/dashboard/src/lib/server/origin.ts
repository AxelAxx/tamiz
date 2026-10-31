/**
 * Cross-origin writes are refused (spec 008 FR-004, research R-04): a non-GET request must
 * carry an `Origin` (or, without one, a `Referer`) from the dashboard's public origin.
 */
import "server-only";

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(url: string): string | undefined {
  return URL.canParse(url) ? new URL(url).origin : undefined;
}

export function isSameOrigin(request: Request, allowedOrigin: string): boolean {
  if (READS.has(request.method)) return true;
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === allowedOrigin;
  const referer = request.headers.get("referer");
  return referer !== null && originOf(referer) === allowedOrigin;
}
