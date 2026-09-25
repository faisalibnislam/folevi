#!/usr/bin/env node
// Renders the cover SVGs to PNG (1600×500) for the Mac app, so both clients show identical art.
// Run from apps/web: node scripts/rasterize-covers.mjs
import { chromium } from "@playwright/test";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = resolve(import.meta.dirname, "../../../packages/design-tokens/covers");
const out = resolve(import.meta.dirname, "../../macos/Folevi/Resources/Covers");
mkdirSync(out, { recursive: true });
const list = JSON.parse(readFileSync(resolve(src, "covers.json"), "utf8"));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 500 } });
for (const { id } of list) {
  const svg = readFileSync(resolve(src, `${id}.svg`), "utf8");
  await page.setContent(`<body style="margin:0">${svg.replace("<svg ", '<svg width="1600" height="500" ')}</body>`);
  await page.screenshot({ path: resolve(out, `${id}.png`), clip: { x: 0, y: 0, width: 1600, height: 500 } });
}
copyFileSync(resolve(src, "covers.json"), resolve(out, "covers.json"));
await browser.close();
console.log(`rendered ${list.length} covers to ${out}`);
