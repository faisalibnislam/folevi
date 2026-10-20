// Phase 0 spikes for local mode (docs/LOCAL_MODE.md). Not part of the e2e suite.
//   cd apps/web && E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 npx playwright test --config spikes/playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 180_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://app.localhost:3002", viewport: { width: 1440, height: 900 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
