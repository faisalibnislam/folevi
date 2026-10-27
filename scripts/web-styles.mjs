#!/usr/bin/env node
// The web app's component styles for Folevi for Mac (docs/MAC_REBUILD_PLAN.md section 3.1). Rather than copying
// CSS by hand (color-mix, layered shadows, the Mac's own overrides), this reads what WebKit computes for every
// element marked `data-style` on /dev/match/styles (apps/web/src/app/dev/match/samples.tsx), light and dark, as
// the Mac app shows the web (<html data-desktop="mac" data-chrome="neutral">), and writes it as Swift:
// apps/native-kit/Sources/FoleviDesign/Generated/WebStyles.swift. FoleviDesign's `.webBox(...)` and the
// components draw from it; the screenshot diffs (pnpm match) check the result.
//
//   pnpm styles:gen [--base http://app.localhost:3012]      (needs the web dev server)
//   pnpm styles:gen --check                                  (fails when the Swift file is out of date)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(repo, "apps/web/package.json"));
const { webkit } = require("@playwright/test");
const out = join(repo, "apps/native-kit/Sources/FoleviDesign/Generated/WebStyles.swift");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const base = (arg("--base") ?? process.env.FOLEVI_MATCH_BASE ?? "http://app.localhost:3012").replace(/\/$/, "");
const check = process.argv.includes("--check");

/** Runs in the page: every [data-style] element's computed style, colours resolved to sRGB through a canvas. */
function extract() {
  const ctx = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
  const probe = document.createElement("i");
  document.body.append(probe);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const round3 = (v) => Math.round(v * 1000) / 1000;
  const linToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255;
  const oklab = (L, a, b, alpha) => {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      clamp(linToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
      clamp(linToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
      clamp(linToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
      round3(alpha),
    ];
  };
  const num = (v, pct = 1) => (v.endsWith("%") ? (Number.parseFloat(v) / 100) * pct : Number.parseFloat(v));
  // Exact sRGB from the computed value (rgb(), color(srgb), oklab(), oklch()); a canvas only as a last resort.
  const rgba = (css) => {
    if (!css || css === "none" || css === "transparent") return [0, 0, 0, 0];
    probe.style.color = "";
    probe.style.color = css;
    const v = getComputedStyle(probe).color.trim();
    let m = v.match(/^rgba?\(([^)]*)\)$/);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean);
      return [clamp(num(p[0], 255)), clamp(num(p[1], 255)), clamp(num(p[2], 255)), round3(p[3] === undefined ? 1 : num(p[3]))];
    }
    m = v.match(/^color\(srgb\s+([^)]*)\)$/);
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean);
      return [clamp(num(p[0]) * 255), clamp(num(p[1]) * 255), clamp(num(p[2]) * 255), round3(p[3] === undefined ? 1 : num(p[3]))];
    }
    m = v.match(/^oklab\(([^)]*)\)$/);
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean);
      return oklab(num(p[0]), num(p[1], 0.4), num(p[2], 0.4), p[3] === undefined ? 1 : num(p[3]));
    }
    m = v.match(/^oklch\(([^)]*)\)$/);
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean);
      const c = num(p[1], 0.4), h = (Number.parseFloat(p[2]) * Math.PI) / 180;
      return oklab(num(p[0]), c * Math.cos(h), c * Math.sin(h), p[3] === undefined ? 1 : num(p[3]));
    }
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], round3(d[3] / 255)];
  };
  // Splits at top-level commas (not inside parentheses).
  const split = (s) => {
    const parts = [];
    let depth = 0, cur = "";
    for (const ch of s) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  };
  const colorRe = /(rgba?\([^)]*\)|oklab\([^)]*\)|oklch\([^)]*\)|color\([^)]*\)|color-mix\((?:[^()]|\([^)]*\))*\)|#[0-9a-f]{3,8}\b|\btransparent\b|\bwhite\b|\bblack\b)/i;
  const shadows = (s) =>
    !s || s === "none"
      ? []
      : split(s).map((layer) => {
          const color = layer.match(colorRe)?.[0] ?? "black";
          const rest = layer.replace(color, " ");
          const nums = [...rest.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
          return { x: nums[0] ?? 0, y: nums[1] ?? 0, blur: nums[2] ?? 0, spread: nums[3] ?? 0, color: rgba(color), inset: /\binset\b/.test(rest) };
        });
  const gradient = (img) => {
    if (!img || img === "none") return null;
    const m = img.match(/linear-gradient\((.*)\)$/);
    if (!m) return { unsupported: img };
    const parts = split(m[1]);
    let angle = 180;
    if (/deg$|^to /.test(parts[0])) {
      const p = parts.shift();
      angle = p === "to bottom" ? 180 : p === "to top" ? 0 : Number.parseFloat(p);
    }
    return { angle, stops: parts.map((p) => rgba(p.match(colorRe)?.[0] ?? p)) };
  };
  const px = (v) => (v === "normal" || v === "" ? null : Number.parseFloat(v));
  const result = {};
  for (const el of document.querySelectorAll("[data-style]")) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    result[el.dataset.style] = {
      width: Math.round(r.width * 100) / 100,
      height: Math.round(r.height * 100) / 100,
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px),
      margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].map(px),
      radius: px(cs.borderTopLeftRadius) ?? 0,
      background: rgba(cs.backgroundColor),
      gradient: gradient(cs.backgroundImage),
      shadows: shadows(cs.boxShadow),
      border: { width: px(cs.borderTopWidth) ?? 0, color: rgba(cs.borderTopColor) },
      color: rgba(cs.color),
      opacity: Number(cs.opacity),
      fontFamily: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
      fontSize: px(cs.fontSize),
      fontWeight: Number(cs.fontWeight),
      lineHeight: px(cs.lineHeight),
      letterSpacing: px(cs.letterSpacing) ?? 0,
      gap: px(cs.columnGap) ?? 0,
      backdropBlur: Number((cs.backdropFilter || cs.webkitBackdropFilter || "").match(/blur\(([\d.]+)px\)/)?.[1] ?? 0),
    };
  }
  return result;
}

const browser = await webkit.launch();
const themes = {};
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ deviceScaleFactor: 2, colorScheme: scheme, viewport: { width: 900, height: 1400 } });
  const res = await page.goto(`${base}/dev/match/styles`, { waitUntil: "networkidle" });
  if (!res?.ok()) throw new Error(`${base}/dev/match/styles: HTTP ${res?.status()}`);
  await page.evaluate((theme) => {
    const d = document.documentElement.dataset;
    d.theme = theme;
    d.desktop = "mac";
    d.chrome = "neutral";
  }, scheme);
  await page.evaluate(() => document.fonts.ready);
  themes[scheme] = await page.evaluate(extract);
  await page.close();
}
await browser.close();

const ids = Object.keys(themes.light).sort();
const n = (v) => (v === null || v === undefined || Number.isNaN(v) ? "nil" : `${Math.round(v * 1000) / 1000}`);
const color = ([r, g, b, a]) => `RGBA(${r}, ${g}, ${b}${a === 1 ? "" : `, ${n(a)}`})`;
const family = (f) => (/spectral/i.test(f) ? ".display" : /mono/i.test(f) ? ".mono" : ".sans");
const style = (s) => {
  const grad = s.gradient && !s.gradient.unsupported ? `WebGradient(angle: ${n(s.gradient.angle)}, stops: [${s.gradient.stops.map(color).join(", ")}])` : "nil";
  const shadows = s.shadows.map((l) => `ShadowLayer(x: ${n(l.x)}, y: ${n(l.y)}, blur: ${n(l.blur)}, spread: ${n(l.spread)}, color: ${color(l.color)}${l.inset ? ", inset: true" : ""})`).join(", ");
  return `WebComputedStyle(width: ${n(s.width)}, height: ${n(s.height)}, padding: WebInsets(${s.padding.map((p) => n(p ?? 0)).join(", ")}), margin: WebInsets(${s.margin.map((p) => n(p ?? 0)).join(", ")}), radius: ${n(s.radius)}, background: ${color(s.background)}, gradient: ${grad}, shadows: [${shadows}], borderWidth: ${n(s.border.width)}, borderColor: ${color(s.border.color)}, color: ${color(s.color)}, opacity: ${n(s.opacity)}, family: ${family(s.fontFamily)}, fontSize: ${n(s.fontSize)}, fontWeight: ${n(s.fontWeight)}, lineHeight: ${n(s.lineHeight)}, letterSpacing: ${n(s.letterSpacing)}, gap: ${n(s.gap)}, backdropBlur: ${n(s.backdropBlur)})`;
};
const unsupported = ids.filter((id) => themes.light[id].gradient?.unsupported || themes.dark[id]?.gradient?.unsupported);
if (unsupported.length) console.warn(`backgrounds drawn as their colour only (unsupported image): ${unsupported.join(", ")}`);

const swift = `// Generated by scripts/web-styles.mjs from the web app's computed styles (/dev/match/styles in WebKit, as
// Folevi for Mac shows the web). Do not edit: change the web, then run pnpm styles:gen.
import CoreGraphics

public enum WebStyles {
    public static let all: [String: WebStylePair] = [
${ids.map((id) => `        ${JSON.stringify(id)}: WebStylePair(\n            light: ${style(themes.light[id])},\n            dark: ${style(themes.dark[id])}\n        )`).join(",\n")},
    ]

    /// A style by its \`data-style\` id ("button.primary.md"). Missing ids are a programming error (the
    /// generated file and the samples are checked together).
    public static func named(_ id: String) -> WebStylePair {
        guard let s = all[id] else { preconditionFailure("no web style \\(id): add it to apps/web/src/app/dev/match/samples.tsx and run pnpm styles:gen") }
        return s
    }
}
`;

if (check) {
  if (!existsSync(out) || readFileSync(out, "utf8") !== swift) {
    console.error(`${out} is out of date: run pnpm styles:gen`);
    process.exit(1);
  }
} else {
  writeFileSync(out, swift);
  console.log(`wrote ${out} (${ids.length} styles)`);
}
