// A test account with a small library on the local backend, for measuring the apps signed in (docs/perf/feel-results.md,
// apps/mac/scripts/perf-feel.mjs). Headless Chromium; never the owner's account or data.
//
//   node perf/test-account.ts [notes]      (from apps/web; the website on app.localhost:3000, the local backend up)
//
// Prints { email, password } for the app to sign in with.
import { chromium } from "@playwright/test";
import { completeOnboarding, confirmEmail, PASSWORD, seedDemo, signUp, uniqueEmail } from "../e2e/helpers.ts";

const notes = Number(process.argv[2] ?? 300);
const browser = await chromium.launch();
const page = await browser.newPage();
const email = uniqueEmail("macfeel");
await signUp(page, { email, name: "Mac Feel" });
await confirmEmail(page, email);
await completeOnboarding(page);
for (let i = 0; ; i++) {
  try {
    seedDemo(email, { notes, folders: 12, tags: 8 });
    break;
  } catch (e) {
    if (i > 10) throw e;
    await page.waitForTimeout(2000);
  }
}
await browser.close();
console.log(JSON.stringify({ email, password: PASSWORD }));
