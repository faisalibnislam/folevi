// The pixel diff of the web vs Mac screenshot checks (match.mjs: specimens; screens.mjs: whole screens), in a
// WebKit page's canvas, so no image library is needed: both pictures decoded there, compared channel by channel
// with an anti-aliasing radius, and the differences drawn in red over the faded web picture. Writes the
// side-by-side report.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dataUrl = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;

const compare = async ({ webUrl, nativeUrl, channel, radius }) => {
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
};

/**
 * Compares out/web/<name>.png with out/native/<name>.png for each item ({ id, scheme }), writes out/diff/, and
 * returns the results.
 */
export async function diffAll(browser, out, items, threshold) {
  const page = await browser.newPage();
  const results = [];
  for (const { id, scheme } of items) {
    const name = `${id}-${scheme}.png`;
    const webPath = join(out, "web", name);
    const nativePath = join(out, "native", name);
    if (!existsSync(nativePath) || !existsSync(webPath)) {
      results.push({ id, scheme, pass: false, reason: existsSync(webPath) ? "no native picture" : "no web picture" });
      continue;
    }
    const r = await page.evaluate(compare, { webUrl: dataUrl(webPath), nativeUrl: dataUrl(nativePath), channel: threshold.channel, radius: threshold.radius ?? 0 });
    writeFileSync(join(out, "diff", name), Buffer.from(r.png, "base64"));
    const ratio = r.differing / r.total;
    // threshold.sizeSlack: pixels a side may differ by (the iOS run's 1: at 3x, CSS's 1/64 pt layout and SwiftUI's
    // pixel grid can end a column a pixel, 0.33 pt, apart).
    const slack = threshold.sizeSlack ?? 0;
    const sameSize = Math.abs(r.web[0] - r.native[0]) <= slack && Math.abs(r.web[1] - r.native[1]) <= slack;
    results.push({ id, scheme, web: r.web, native: r.native, ratio: Number(ratio.toFixed(5)), pass: sameSize && ratio <= threshold.maxRatio, reason: sameSize ? undefined : "different size" });
  }
  await page.close();
  return results;
}

const pct = (r) => (r.ratio === undefined ? "" : `${(r.ratio * 100).toFixed(2)}%`);

/** report.json and index.html (web, Mac and differences side by side), and a line per result on stdout. */
export function writeReport(out, { title, note, threshold, results, imageWidth = 280 }) {
  writeFileSync(join(out, "report.json"), JSON.stringify({ title, threshold, results }, null, 2));
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
    `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:14px -apple-system,sans-serif;margin:24px;background:#f4f4f4;color:#111}h1{font-size:20px}h2{font-size:15px;margin:0 0 4px}
section{background:#fff;border-radius:10px;padding:16px;margin:0 0 16px}section.fail h2{color:#c0261b}section.pass h2{color:#1d7a3a}
.row{display:flex;gap:16px;flex-wrap:wrap}figure{margin:0}figcaption{font-size:12px;color:#666;margin-bottom:4px}img{width:${imageWidth}px;border:1px solid #ddd;display:block}p{margin:0 0 8px;color:#666;font-size:12px}</style>
<h1>${title}: ${results.filter((r) => r.pass).length} of ${results.length} pass</h1>
<p>Threshold: a pixel differs when no pixel of the other picture within ${threshold.radius ?? 0} px is within ${threshold.channel} on every channel; a picture passes at ${(threshold.maxRatio * 100).toFixed(1)}% or less, ${threshold.sizeSlack ? `sizes within ${threshold.sizeSlack} px` : "same size"}. ${note ?? ""}</p>
${rows}`,
  );
  for (const r of results) console.log(`${r.pass ? "pass" : "FAIL"}  ${r.id} ${r.scheme}  ${pct(r)}${r.reason ? `  ${r.reason}` : ""}  web ${r.web?.join("x") ?? "?"} native ${r.native?.join("x") ?? "?"}`);
  console.log(`report: ${join(out, "index.html")}`);
}
