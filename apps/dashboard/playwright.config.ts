/**
 * Browser flows against the E2E gateway (spec 008 research R-13, tasks.md T014): the real
 * gateway app with in-memory fakes and a control port, and `next start` on a production
 * build (`pnpm --filter @tamiz/dashboard build` first). Chromium only; one worker, because
 * the gateway's state and the dashboard's sessions are shared.
 */
import { defineConfig, devices } from "@playwright/test";
import {
  ADMIN_KEY,
  CLIENT_KEY,
  CONTROL_PORT,
  CONTROL_URL,
  DASHBOARD_PORT,
  DASHBOARD_URL,
  GATEWAY_PORT,
  GATEWAY_URL,
  PASSPHRASE,
  SESSION_SECRET,
} from "./e2e/support/fixtures";
import { hashPassphrase } from "./src/lib/server/passphrase";

const { CI } = process.env;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI !== undefined,
  retries: CI === undefined ? 0 : 1,
  reporter: CI === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: DASHBOARD_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @tamiz/gateway e2e-gateway",
      url: `${CONTROL_URL}/__e2e/requests`,
      env: {
        TAMIZ_E2E_GATEWAY_PORT: String(GATEWAY_PORT),
        TAMIZ_E2E_CONTROL_PORT: String(CONTROL_PORT),
        TAMIZ_E2E_ADMIN_KEY: ADMIN_KEY,
        TAMIZ_E2E_CLIENT_KEY: CLIENT_KEY,
      },
      reuseExistingServer: CI === undefined,
      timeout: 60_000,
    },
    {
      command: `pnpm exec next start -p ${DASHBOARD_PORT}`,
      url: `${DASHBOARD_URL}/api/health`,
      env: {
        TAMIZ_GATEWAY_URL: GATEWAY_URL,
        TAMIZ_DASHBOARD_ADMIN_KEY: ADMIN_KEY,
        TAMIZ_DASHBOARD_PASSPHRASE_HASH: hashPassphrase(PASSPHRASE),
        TAMIZ_DASHBOARD_SESSION_SECRET: SESSION_SECRET,
        TAMIZ_DASHBOARD_PUBLIC_URL: DASHBOARD_URL,
        // The rate-limit test sends its own X-Forwarded-For, so its lock-out stays apart
        // from the other tests' address.
        TAMIZ_DASHBOARD_TRUST_PROXY: "true",
      },
      reuseExistingServer: CI === undefined,
      timeout: 60_000,
    },
  ],
});
