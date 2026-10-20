import { defineConfig, devices } from "@playwright/test";

// The bundled app shell (docs/LOCAL_MODE_PLAN.md §1, WP1): checks the static export in out-shell/ and drives it
// in Chromium behind a static server with the hosts' SPA fallback (scripts/serve-shell.mjs). Build it first:
//   pnpm --filter @folevi/web test:shell           (builds, then runs these)
//   npx playwright test --config playwright.shell.config.ts   (an existing out-shell/)
// The signed-in test also needs the dev server: E2E_BASE_URL=http://app.localhost:3002.
const port = Number(process.env.SHELL_PORT ?? 4319);

export default defineConfig({
  testDir: "./e2e/shell",
  timeout: process.env.CI ? 180_000 : 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "shell", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `node scripts/serve-shell.mjs ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
