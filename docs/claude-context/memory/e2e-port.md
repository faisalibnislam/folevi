---
name: e2e-port
description: "Run Folevi e2e against the dev server on 3002 (E2E_BASE_URL); port 3000 may be another project's app"
metadata:
  node_type: memory
  type: reference
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-10-11T06:54:22.350Z
---

Playwright defaults to http://app.localhost:3000 (apps/web/playwright.config.ts, e2e/helpers.ts APP). On 2026-10-11 another project ("Macloving") was listening on 3000, so every e2e test silently ran against the wrong app and failed. Folevi's dev server is web-3002.

**How to apply:** run e2e as `E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 npx playwright test …` from apps/web. If many unrelated tests fail at once, check `lsof -iTCP:3000` before debugging.
