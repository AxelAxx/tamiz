import { expect, test } from "@playwright/test";
import { ADMIN_KEY, DASHBOARD_URL, DATA_ENDPOINTS, PAGES } from "./support/fixtures";
import { gateway, signIn } from "./support/gateway";

// Spec 008 US1-3, FR-002 (tasks.md T006, first version; extended in T053).

test("US1-3 the admin key reaches the gateway on every call and the browser never sees it", async ({
  page,
}) => {
  await gateway.reset();
  const received: string[] = [];
  page.on("response", async (response) => {
    const headers = JSON.stringify(await response.allHeaders());
    const body = await response.text().catch(() => "");
    received.push(`${response.url()}\n${headers}\n${body}`);
  });

  await signIn(page);
  const storages: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    storages.push(
      await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
    );
  }
  // Every data endpoint, called from the page so its responses are recorded as well.
  for (const endpoint of DATA_ENDPOINTS) {
    const status = await page.evaluate(
      async ({ method, path, body }) => {
        const response = await fetch(path, {
          method,
          headers: { "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return response.status;
      },
      {
        method: endpoint.method,
        path: endpoint.path,
        body: "body" in endpoint ? endpoint.body : undefined,
      },
    );
    expect(status, `${endpoint.method} ${endpoint.path}`).toBe(200);
  }
  await page.waitForLoadState("networkidle");

  const cookies = JSON.stringify(await page.context().cookies(DASHBOARD_URL));
  const everything = [...received, ...storages, cookies].join("\n");
  expect(received.length).toBeGreaterThan(PAGES.length);
  expect(everything).not.toContain(ADMIN_KEY);

  const calls = await gateway.requests();
  expect(calls.map((c) => c.path.split("?")[0])).toEqual(
    expect.arrayContaining([
      "/health",
      "/v1/admin/audit",
      "/v1/admin/cost",
      "/v1/admin/providers",
      "/v1/simulate",
    ]),
  );
  for (const call of calls) {
    expect(call.authorization, `${call.method} ${call.path}`).toBe(`Bearer ${ADMIN_KEY}`);
  }
});
