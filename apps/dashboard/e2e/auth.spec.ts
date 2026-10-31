import { expect, test } from "@playwright/test";
import { DASHBOARD_URL, DATA_ENDPOINTS, PAGES, PASSPHRASE } from "./support/fixtures";
import { gateway, signIn } from "./support/gateway";

// Spec 008 US1-1, US1-2, US1-4, US1-5 (tasks.md T005).

const SAME_ORIGIN = { origin: DASHBOARD_URL };

test.beforeEach(async () => {
  await gateway.reset();
});

test("US1-1 without a session every page redirects to sign-in and every data endpoint answers 401", async ({
  page,
  request,
}) => {
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page, `${path} redirects`).toHaveURL(/\/sign-in$/);
  }
  for (const endpoint of DATA_ENDPOINTS) {
    const response = await request.fetch(endpoint.path, {
      method: endpoint.method,
      headers: SAME_ORIGIN,
      ...("body" in endpoint ? { data: endpoint.body } : {}),
    });
    expect(response.status(), `${endpoint.method} ${endpoint.path}`).toBe(401);
    expect((await response.json()).error.type).toBe("unauthenticated");
  }
  const signOut = await request.delete("/api/session", { headers: SAME_ORIGIN });
  expect(signOut.status()).toBe(401);
  expect(await gateway.requests()).toEqual([]);
});

test("US1-2 the right passphrase lands on live traffic; a wrong one says so", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Passphrase").fill("not the passphrase");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Wrong passphrase.")).toHaveAttribute("role", "alert");
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByRole("heading", { name: "Live traffic" })).toBeVisible();

  const [cookie] = (await page.context().cookies()).filter((c) => c.name === "tamiz_session");
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
  // At most 8 hours.
  const remaining = (cookie?.expires ?? 0) - Date.now() / 1000;
  expect(remaining).toBeGreaterThan(8 * 3600 - 60);
  expect(remaining).toBeLessThanOrEqual(8 * 3600);
});

test("US1-2 the sixth failure in a minute is refused with 429 and Retry-After", async ({
  request,
}) => {
  const headers = { ...SAME_ORIGIN, "x-forwarded-for": "203.0.113.42" };
  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await request.post("/api/session", {
      headers,
      data: { passphrase: `wrong ${attempt}` },
    });
    expect(response.status(), `attempt ${attempt}`).toBe(401);
  }
  const refused = await request.post("/api/session", {
    headers,
    data: { passphrase: PASSPHRASE },
  });
  expect(refused.status()).toBe(429);
  expect(Number(refused.headers()["retry-after"])).toBeGreaterThan(0);
  expect((await refused.json()).error.type).toBe("rate_limited");
});

test("US1-4 sign-out ends the session and the old cookie stops working", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const cookies = await page.context().cookies();
  expect((await page.request.get("/api/audit")).status()).toBe(200);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect((await page.request.get("/api/audit")).status()).toBe(401);

  const replay = await browser.newContext({ baseURL: DASHBOARD_URL });
  await replay.addCookies(cookies);
  const response = await replay.request.get("/api/audit");
  expect(response.status()).toBe(401);
  expect((await response.json()).error.type).toBe("unauthenticated");
  await replay.close();
});

test("US1-5 cross-origin writes are refused and nothing reaches the gateway", async ({ page }) => {
  await signIn(page);
  await gateway.reset();
  const simulate = DATA_ENDPOINTS.find((e) => e.path === "/api/simulate");

  for (const headers of [
    { origin: "https://evil.example" },
    { referer: "https://evil.example/page" },
    {},
  ]) {
    const post = await page.request.post("/api/simulate", {
      headers,
      data: simulate && "body" in simulate ? simulate.body : {},
    });
    expect(post.status(), JSON.stringify(headers)).toBe(403);
    expect((await post.json()).error.type).toBe("forbidden_origin");

    const signOut = await page.request.delete("/api/session", { headers });
    expect(signOut.status(), JSON.stringify(headers)).toBe(403);
  }
  expect(await gateway.requests()).toEqual([]);

  // The refused sign-out did not end the session.
  expect((await page.request.get("/api/gateway-health")).status()).toBe(200);
});
