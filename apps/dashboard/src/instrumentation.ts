/**
 * Runs once when the server starts (spec 008 US1-6, FR-005): an invalid configuration
 * stops the process with every problem listed, before any request is served.
 */
export async function register(): Promise<void> {
  const { NEXT_RUNTIME, NEXT_PHASE } = process.env;
  if (NEXT_RUNTIME !== "nodejs") return;
  if (NEXT_PHASE === "phase-production-build") return;
  const { serverContext } = await import("./lib/server/context");
  serverContext();
}
