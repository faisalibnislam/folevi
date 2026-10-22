import { defineConfig, devices } from "@playwright/test";
import type { BackendModeOptions } from "./e2e/fixtures/localShell";

const baseURL = process.env.E2E_BASE_URL ?? "http://app.localhost:3000";
/** Where local-mode specs open the app: a `FOLEVI_BUILD=shell` dev server when there is one, else the same. */
const localBaseURL = process.env.E2E_LOCAL_BASE_URL ?? baseURL;
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

export default defineConfig<BackendModeOptions>({
  testDir: "./e2e",
  // The bundled shell's tests run against its static export with their own config (playwright.shell.config.ts).
  testIgnore: ["shell/**"],
  // CI machines are slower and every page compiles on first visit in `next dev`; tests that sign in twice
  // sat right at a one-minute limit there.
  timeout: process.env.CI ? 120_000 : 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  // Account mode runs every spec, as before. Local mode (docs/LOCAL_MODE_PLAN.md §5.4) runs the specs
  // tagged @both or @local, with a FakeShell in the page and Folevi and Convex blocked (e2e/fixtures/localShell.ts).
  projects: [
    { name: "account", grepInvert: /@local\b/, use: { ...desktop, backendMode: "account" } },
    { name: "local", grep: /@both\b|@local\b/, use: { ...desktop, baseURL: localBaseURL, backendMode: "local" } },
    // Folevi for Mac's web layer on WebKit, the native app's engine (docs/MAC_WEBKIT_PLAN.md §7): the specs tagged
    // @mac, against the shell export's dev server, in local mode. (npx playwright install webkit, once.)
    { name: "mac-webkit", grep: /@mac\b/, use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, baseURL: localBaseURL, backendMode: "local" } },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
