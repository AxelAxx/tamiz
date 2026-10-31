/** `GET /api/health`: the dashboard itself, for the container healthcheck (spec 008 R-16). */
export function GET(): Response {
  return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
