import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect } from "vitest";

/**
 * One MSW server per test file (research R-14). Unhandled requests are an error, and
 * `afterEach` also asserts that none happened, so no test can reach the real network.
 */
export function useMswServer(): ReturnType<typeof setupServer> {
  const server = setupServer();
  const unhandled: string[] = [];

  server.events.on("request:unhandled", ({ request }) => {
    unhandled.push(`${request.method} ${request.url}`);
  });

  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => {
    server.resetHandlers();
    expect(unhandled).toEqual([]);
    unhandled.length = 0;
  });
  afterAll(() => server.close());

  return server;
}
