// SPIKE S1: loads deep links in Chromium against the SPA-fallback server and prints what the probe saw.
//   node spikes/s1-shell/serve.mjs 4319 & node spikes/s1-shell/check.mjs http://127.0.0.1:4319
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:4319";
const browser = await chromium.launch();
const results = [];
for (const path of ["/d/01JABCDEFGHJKMNPQRSTVWXYZ0", "/tasks/today", "/settings/appearance?x=1", "/documents"]) {
  const page = await browser.newPage();
  const logs = [];
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && logs.push(`${m.type()}: ${m.text().slice(0, 160)}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message.slice(0, 160)}`));
  const failed = [];
  page.on("requestfailed", (r) => failed.push(`${r.url().slice(0, 100)} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url().slice(0, 100)}`));
  await page.goto(base + path);
  await page.waitForFunction(() => window.__shellProbe?.hydrated, null, { timeout: 15000 });
  const probe = await page.evaluate(() => window.__shellProbeRun());
  // Client navigation the way lib/app/router.tsx does it (pushState), then the probe's pathname again.
  await page.evaluate(() => history.pushState(null, "", "/calendar/2026-10"));
  await page.waitForFunction(() => window.__shellProbe?.pathname === "/calendar/2026-10", null, { timeout: 5000 }).catch(() => {});
  const afterPush = await page.evaluate(() => window.__shellProbe?.pathname);
  const visible = (await page.locator("body").innerText()).slice(0, 120).replace(/\s+/g, " ");
  results.push({ path, pathname: probe.pathname, locationPath: probe.locationPath, afterPush, fontVar: probe.fontVar, bodyFont: probe.bodyFont, fontsLoaded: probe.fontsLoaded, tailwind: probe.tailwind, visible, logs: logs.slice(0, 8), failed: failed.slice(0, 8) });
  await page.close();
}
console.log(JSON.stringify(results, null, 2));
await browser.close();
