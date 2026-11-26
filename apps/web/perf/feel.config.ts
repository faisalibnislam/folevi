import { defineConfig, devices } from "@playwright/test";

// How the app feels signed in (perf/feel.spec.ts): headless Chromium, nothing takes over the desktop.
// The servers are started by hand; see the spec's header.
export default defineConfig({
  testDir: ".",
  testMatch: /feel\.spec\.ts$/,
  timeout: 1_800_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://app.localhost:3000", headless: true, actionTimeout: 60_000, viewport: { width: 1440, height: 900 } },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
