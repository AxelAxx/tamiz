import { expect, type Page } from "@playwright/test";
import { CONTROL_URL, PASSPHRASE } from "./fixtures";

/** One request the E2E gateway received (its control port, `GET /__e2e/requests`). */
export interface ReceivedRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
}

async function control(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${CONTROL_URL}${path}`, init);
  if (!response.ok) throw new Error(`control ${path} answered ${response.status}`);
  return response.json();
}

export const gateway = {
  reset: () => control("/__e2e/reset", { method: "POST" }),
  requests: async () =>
    ((await control("/__e2e/requests")) as { requests: ReceivedRequest[] }).requests,
};

/** Signs in through the placeholder sign-in page and waits for the live traffic screen. */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/live$/);
}
