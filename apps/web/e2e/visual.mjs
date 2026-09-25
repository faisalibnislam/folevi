// Visual QA helper (not a test): captures key screens in light and dark at several widths.
// Usage: node e2e/visual.mjs <outDir>
import { chromium } from "@playwright/test";
const out = process.argv[2] ?? "/tmp/folevi-shots";
const APP = "http://app.localhost:3000";
const browser = await chromium.launch();
async function shoot(theme, width, height, label, paths) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: 1 });
  const email = process.env.SHOT_EMAIL ?? "ada@example.com";
  await context.request.post(`${APP}/api/dev-auth/session`, { form: { email, name: "Ada Example", returnTo: "/documents" }, headers: { origin: APP }, maxRedirects: 0 });
  const page = await context.newPage();
  await page.addInitScript((t) => localStorage.setItem("folevi:appearance", t), theme);
  for (const [name, path] of paths) {
    await page.goto(`${APP}${path}`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${label}-${theme}-${width}-${name}.png` });
  }
  await context.close();
}
const paths = JSON.parse(process.env.SHOT_PATHS ?? '[["docs","/documents"]]');
for (const theme of (process.env.SHOT_THEMES ?? "light,dark").split(",")) {
  for (const w of (process.env.SHOT_WIDTHS ?? "1440").split(",").map(Number)) {
    await shoot(theme, w, w < 800 ? 844 : 900, "app", paths);
  }
}
await browser.close();
console.log("done");
