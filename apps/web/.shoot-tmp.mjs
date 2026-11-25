import { chromium } from "@playwright/test";
const out = "/tmp/claude-0/-home-user-folevi/4ea84c49-68b5-5e3a-a575-21f2dd4d890a/scratchpad/server-page";
const url = process.argv[2] ?? "http://127.0.0.1:4110/server";
const tag = process.argv[3] ?? "";
const only = process.argv[4];
const browser = await chromium.launch();
for (const [name, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
  for (const scheme of ["light", "dark"]) {
    if (only && only !== `${name}-${scheme}`) continue;
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "networkidle" });
    if (scheme === "dark") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    // The site scrolls inside its shell: find the scroller and make the page as tall as its content.
    const full = await page.evaluate(() => {
      const els = [...document.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
      els.sort((a, b) => b.scrollHeight - a.scrollHeight);
      return els[0] ? els[0].scrollHeight + 120 : document.documentElement.scrollHeight;
    });
    await page.setViewportSize({ width, height: Math.min(full, 16000) });
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log(name, scheme, "height", full, "horizontal overflow:", overflow);
    await page.screenshot({ path: `${out}/server-${name}-${scheme}${tag}.png` });
    await page.close();
  }
}
await browser.close();
