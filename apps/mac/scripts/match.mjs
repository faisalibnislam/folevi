#!/usr/bin/env node
// Screenshot diffs between the web app and Folevi for Mac (docs/MAC_REBUILD_PLAN.md section 3.2).
//
// For every specimen in packages/design-tokens/match/specimens.json, light and dark:
//   1. the web: Playwright in WebKit opens <base>/dev/match/<id> (the web's real CSS) as the Mac app shows the
//      web (<html data-desktop="mac">) and photographs #specimen at the file's scale;
//   2. the Mac: `swift test --filter MatchShotTests` in apps/native-kit draws the same specimen in a window;
//   3. a pixel diff: a pixel differs when no pixel of the other picture within `threshold.radius` (anti-aliasing)
//      is within `threshold.channel` on every channel; a specimen passes at most `threshold.maxRatio` of its
//      pixels differing (and the same size).
// Writes apps/mac/match-report/ (untracked): web/, native/, diff/ and index.html with the three side by side,
// and report.json. Exits 1 when a specimen fails.
//
//   node apps/mac/scripts/match.mjs [--base http://app.localhost:3012] [--only type-roles,icons] [--skip-native]
//
// The web dev server must be running (the "mac-rebuild-web-3012" entry in .claude/launch.json, or any
// `next dev` of apps/web).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(join(repo, "apps/web/package.json"));
const { webkit } = require("@playwright/test");

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const base = (arg("--base") ?? process.env.FOLEVI_MATCH_BASE ?? "http://app.localhost:3012").replace(/\/$/, "");
const only = arg("--only")?.split(",");
const skipNative = process.argv.includes("--skip-native");

const file = JSON.parse(readFileSync(join(repo, "packages/design-tokens/match/specimens.json"), "utf8"));
const specimens = file.specimens.filter((s) => !only || only.includes(s.id));
const out = join(repo, "apps/mac/match-report");
for (const d of ["web", "diff"]) {
  rmSync(join(out, d), { recursive: true, force: true });
  mkdirSync(join(out, d), { recursive: true });
}
mkdirSync(join(out, "native"), { recursive: true });

// 1. The web.
const browser = await webkit.launch();
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ deviceScaleFactor: file.scale, colorScheme: scheme, viewport: { width: 900, height: 1200 } });
  for (const s of specimens) {
    const res = await page.goto(`${base}/dev/match/${s.id}`, { waitUntil: "networkidle" });
    if (!res?.ok()) throw new Error(`${base}/dev/match/${s.id}: HTTP ${res?.status()}`);
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.desktop = "mac";
      document.documentElement.dataset.chrome = "neutral";
    }, scheme);
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#specimen").screenshot({ path: join(out, "web", `${s.id}-${scheme}.png`), animations: "disabled", caret: "hide" });
  }
  await page.close();
}

// 2. The Mac.
if (!skipNative) {
  rmSync(join(out, "native"), { recursive: true, force: true });
  execFileSync("swift", ["test", "--filter", "MatchShotTests"], {
    cwd: join(repo, "apps/native-kit"),
    env: { ...process.env, FOLEVI_MATCH_OUT: join(out, "native") },
    stdio: ["ignore", "ignore", "inherit"],
  });
}

// 3. The diff, in the browser's canvas (no image library needed): both pictures decoded there, compared
// channel by channel, and the differences drawn in red over the faded web picture.
const differ = await browser.newPage();
const dataUrl = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;
const results = [];
for (const s of specimens) {
  for (const scheme of ["light", "dark"]) {
    const name = `${s.id}-${scheme}.png`;
    const nativePath = join(out, "native", name);
    if (!existsSync(nativePath)) {
      results.push({ id: s.id, scheme, pass: false, reason: "no native picture" });
      continue;
    }
    const r = await differ.evaluate(
      async ({ webUrl, nativeUrl, channel, radius }) => {
        const load = (src) => new Promise((ok, fail) => Object.assign(new Image(), { onload() { ok(this); }, onerror: fail, src }));
        const [a, b] = await Promise.all([load(webUrl), load(nativeUrl)]);
        const w = Math.max(a.width, b.width), h = Math.max(a.height, b.height);
        const pixels = (img) => {
          const c = new OffscreenCanvas(w, h);
          const ctx = c.getContext("2d", { colorSpace: "srgb" });
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, w, h, { colorSpace: "srgb" }).data;
        };
        const pa = pixels(a), pb = pixels(b);
        const close = (p, i, q, j) => Math.max(Math.abs(p[i] - q[j]), Math.abs(p[i + 1] - q[j + 1]), Math.abs(p[i + 2] - q[j + 2]), Math.abs(p[i + 3] - q[j + 3])) <= channel;
        // Anti-aliasing tolerance: a pixel matches when the other picture has a close pixel within `radius`
        // (text edges from two engines' sub-pixel positioning); anything moved by more still shows.
        const near = (p, i, q, x, y) => {
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              const xx = x + dx, yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              if (close(p, i, q, (yy * w + xx) * 4)) return true;
            }
          }
          return false;
        };
        const c = new OffscreenCanvas(w, h);
        const ctx = c.getContext("2d");
        const out = ctx.createImageData(w, h);
        let differing = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4;
            const inside = x < a.width && y < a.height && x < b.width && y < b.height;
            const bad = !inside || (!near(pa, o, pb, x, y) || !near(pb, o, pa, x, y));
            if (bad) differing++;
            const g = Math.round(((pa[o] + pa[o + 1] + pa[o + 2]) / 3) * 0.3 + 178);
            out.data[o] = bad ? 255 : g;
            out.data[o + 1] = bad ? 0 : g;
            out.data[o + 2] = bad ? 0 : g;
            out.data[o + 3] = 255;
          }
        }
        ctx.putImageData(out, 0, 0);
        const blob = await c.convertToBlob({ type: "image/png" });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { web: [a.width, a.height], native: [b.width, b.height], differing, total: w * h, png: btoa(bin) };
      },
      { webUrl: dataUrl(join(out, "web", name)), nativeUrl: dataUrl(nativePath), channel: file.threshold.channel, radius: file.threshold.radius ?? 0 },
    );
    writeFileSync(join(out, "diff", name), Buffer.from(r.png, "base64"));
    const ratio = r.differing / r.total;
    const sameSize = r.web[0] === r.native[0] && r.web[1] === r.native[1];
    results.push({
      id: s.id,
      scheme,
      web: r.web,
      native: r.native,
      ratio: Number(ratio.toFixed(5)),
      pass: sameSize && ratio <= file.threshold.maxRatio,
      reason: sameSize ? undefined : "different size",
    });
  }
}
await browser.close();

writeFileSync(join(out, "report.json"), JSON.stringify({ base, threshold: file.threshold, results }, null, 2));
const pct = (r) => (r.ratio === undefined ? "" : `${(r.ratio * 100).toFixed(2)}%`);
const rows = results
  .map(
    (r) => `<section class="${r.pass ? "pass" : "fail"}">
  <h2>${r.id} · ${r.scheme} · ${r.pass ? "pass" : "FAIL"} ${pct(r)} ${r.reason ? `(${r.reason})` : ""}</h2>
  <p>web ${r.web?.join(" x ") ?? "?"} px · native ${r.native?.join(" x ") ?? "?"} px</p>
  <div class="row"><figure><figcaption>Web</figcaption><img src="web/${r.id}-${r.scheme}.png"></figure><figure><figcaption>Folevi for Mac</figcaption><img src="native/${r.id}-${r.scheme}.png"></figure><figure><figcaption>Differences</figcaption><img src="diff/${r.id}-${r.scheme}.png"></figure></div>
</section>`,
  )
  .join("\n");
writeFileSync(
  join(out, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Web vs Mac</title>
<style>body{font:14px -apple-system,sans-serif;margin:24px;background:#f4f4f4;color:#111}h1{font-size:20px}h2{font-size:15px;margin:0 0 4px}
section{background:#fff;border-radius:10px;padding:16px;margin:0 0 16px}section.fail h2{color:#c0261b}section.pass h2{color:#1d7a3a}
.row{display:flex;gap:16px;flex-wrap:wrap}figure{margin:0}figcaption{font-size:12px;color:#666;margin-bottom:4px}img{width:280px;border:1px solid #ddd;display:block}p{margin:0 0 8px;color:#666;font-size:12px}</style>
<h1>Web vs Folevi for Mac: ${results.filter((r) => r.pass).length} of ${results.length} pass</h1>
<p>Threshold: a pixel differs when no pixel of the other picture within ${file.threshold.radius ?? 0} px is within ${file.threshold.channel} on every channel; a specimen passes at ${(file.threshold.maxRatio * 100).toFixed(1)}% or less, same size. Web from ${base} in WebKit as the Mac app shows it (data-desktop="mac").</p>
${rows}`,
);

for (const r of results) console.log(`${r.pass ? "pass" : "FAIL"}  ${r.id} ${r.scheme}  ${pct(r)}${r.reason ? `  ${r.reason}` : ""}  web ${r.web?.join("x") ?? "?"} native ${r.native?.join("x") ?? "?"}`);
console.log(`report: ${join(out, "index.html")}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
