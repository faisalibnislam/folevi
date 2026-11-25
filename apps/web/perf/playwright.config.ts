import { defineConfig, devices } from "@playwright/test";
import type { BackendModeOptions } from "../e2e/fixtures/localShell";

// The web app's speed with a big library (docs/perf/web-results.md): the production shell export (the same
// components the website, the Mac, iPhone, iPad, Android and Windows apps show) in local mode, served the way the
// apps serve it. Headless Chromium only: nothing takes over the desktop. See perf/web-perf.spec.ts for how to run.
const port = Number(process.env.PERF_PORT ?? 4330);
const root = process.env.PERF_ROOT ?? "out-shell";

export default defineConfig<BackendModeOptions>({
  testDir: ".",
  testMatch: /web-perf\.spec\.ts$/,
  timeout: 3_600_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, actionTimeout: 60_000 },
  projects: [{ name: "local", use: { ...devices["Desktop Chrome"], backendMode: "local" } }],
  webServer: {
    command: `node scripts/serve-shell.mjs ${port} ${root}`,
    cwd: "..",
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
