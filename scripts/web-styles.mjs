#!/usr/bin/env node
// The web app's component styles for Folevi for Mac (docs/MAC_REBUILD_PLAN.md section 3.1). Rather than copying
// CSS by hand (color-mix, layered shadows, the Mac's own overrides), this reads what WebKit computes for every
// element marked `data-style` on /dev/match/styles (apps/web/src/app/dev/match/samples.tsx), light and dark, as
// the Mac app shows the web (<html data-desktop="mac" data-chrome="neutral">), and writes it as Swift:
// apps/native-kit/Sources/FoleviDesign/Generated/WebStyles.swift. FoleviDesign's `.webBox(...)` and the
// components draw from it; the screenshot diffs (pnpm match) check the result.
//
//   pnpm styles:gen [--base http://app.localhost:3012]      (needs the web dev server)
//   pnpm styles:gen --no-samples                             (the component samples from samples-cache.json)
//   pnpm styles:gen --check                                  (fails when the Swift file is out of date)
//   pnpm styles:gen --app [--only frame,home]                (also reads the live app's elements listed in
//                                                            packages/design-tokens/match/app-styles/<area>.json
//                                                            from the Debug Mac app's web frame, into
//                                                            app-styles-cache/<area>.json)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
function extract(tags) {
  // (App mode: mark the elements first, by selector, as the samples page marks its own with data-style.)
  if (tags) {
    // No transitions: a window behind others doesn't run them, so a colour caught mid-change would stay there.
    if (!document.getElementById("__webStylesStill")) {
      const still = document.createElement("style");
      still.id = "__webStylesStill";
      still.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
      document.documentElement.appendChild(still);
    }
    for (const [id, t] of Object.entries(tags)) {
      if (id === "__vars") continue;
      let el = [...document.querySelectorAll(t.selector)][t.nth ?? 0];
      for (let i = 0; el && i < (t.parent ?? 0); i++) el = el.parentElement;
      if (el) el.setAttribute("data-style", id);
    }
  }
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
  // CSS custom properties that are colours (app mode: the Mac's own variables), as "var:<name>".
  for (const name of tags?.__vars?.names ?? []) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
    if (v) result[`var:${name}`] = { color: rgba(v) };
  }
  for (const el of document.querySelectorAll("[data-style]")) {
    if (tags && !tags[el.dataset.style]) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    result[el.dataset.style] = {
      x: Math.round(r.left * 100) / 100,
      y: Math.round(r.top * 100) / 100,
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

/**
 * App mode: the running web app in the Debug Mac app's web frame (screens.mjs's scratch library). Each file in
 * packages/design-tokens/match/app-styles/ lists one area's screens and elements (frame.json, home.json, ...);
 * its result goes to app-styles-cache/<same name>, so areas are read (and merged) independently.
 */
const APP_DIR = join(repo, "packages/design-tokens/match/app-styles");
const CACHE_DIR = join(repo, "packages/design-tokens/match/app-styles-cache");

async function fromApp(only) {
  const mac = await import(pathToFileURL(join(repo, "apps/mac/scripts/mac.mjs")).href);
  const dir = join(repo, "apps/mac/build/run/screens");
  if (!existsSync(join(dir, "fixture.json"))) throw new Error("No scratch library yet: run node apps/mac/scripts/screens.mjs --fresh first.");
  let files = readdirSync(APP_DIR).filter((f) => f.endsWith(".json") && (!only || only.includes(f.replace(/\.json$/, ""))));
  // Areas marked "gates": the screens before the app, each from a fresh scratch folder (apps/mac/scripts/gates.mjs).
  const gateFiles = files.filter((f) => JSON.parse(readFileSync(join(APP_DIR, f), "utf8")).gates);
  files = files.filter((f) => !gateFiles.includes(f));
  if (gateFiles.length) {
    const g = await import(pathToFileURL(join(repo, "apps/mac/scripts/gates.mjs")).href);
    for (const file of gateFiles) {
      const spec = JSON.parse(readFileSync(join(APP_DIR, file), "utf8"));
      const out = { light: {}, dark: {} };
      for (const screen of Object.keys(spec.screens)) {
        const gate = g.GATES.find((x) => x.id === screen);
        if (!gate) throw new Error(`${file}: no gate ${screen} in apps/mac/scripts/gates.mjs`);
        const gdir = await g.enterGate(gate, { web: true });
        try {
          await mac.command(gdir, { cmd: "resize", width: 1280, height: 820 });
          for (const scheme of ["light", "dark"]) {
            await mac.command(gdir, { cmd: "appearance", value: scheme });
            await new Promise((r) => setTimeout(r, 800));
            if (spec.prepare?.[screen]) {
              await mac.evaluate(gdir, spec.prepare[screen]);
              await new Promise((r) => setTimeout(r, 600));
            }
            const tags = Object.fromEntries(Object.entries(spec.styles).filter(([, t]) => t.screen === screen));
            if (screen === Object.keys(spec.screens)[0]) tags.__vars = { names: spec.vars ?? [] };
            Object.assign(out[scheme], await mac.evaluate(gdir, `return (${extract.toString()})(${JSON.stringify(tags)})`));
          }
        } finally {
          await g.quitGate(gdir);
        }
      }
      const missing = Object.keys(spec.styles).filter((id) => !out.light[id]);
      if (missing.length) console.warn(`${file}: not found in the app: ${missing.join(", ")}`);
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(join(CACHE_DIR, file), JSON.stringify(out, null, 1) + "\n");
      console.log(`${file}: ${Object.keys(out.light).length} styles`);
    }
    if (!files.length) return;
  }
  await mac.launch({ dir, env: { FOLEVI_TEST_FOLDER: `${dir}-library`, FOLEVI_WEB_FRAME: "1" } });
  try {
    await mac.waitFor(dir, `return document.readyState === "complete" && !!document.querySelector('nav[aria-label="Folio"]')`, 90_000);
    await mac.command(dir, { cmd: "resize", width: 1280, height: 820 });
    for (const file of files) {
      const spec = JSON.parse(readFileSync(join(APP_DIR, file), "utf8"));
      const out = { light: {}, dark: {} };
      for (const scheme of ["light", "dark"]) {
        await mac.command(dir, { cmd: "appearance", value: scheme });
        for (const [screen, link] of Object.entries(spec.screens)) {
          await mac.command(dir, { cmd: "open", url: link });
          await new Promise((r) => setTimeout(r, 1500));
          // A screen may need a step first (open a menu, a dialog): its `prepare` script runs in the page.
          if (spec.prepare?.[screen]) {
            await mac.evaluate(dir, spec.prepare[screen]);
            await new Promise((r) => setTimeout(r, 600));
          }
          const tags = Object.fromEntries(Object.entries(spec.styles).filter(([, t]) => t.screen === screen));
          if (screen === Object.keys(spec.screens)[0]) tags.__vars = { names: spec.vars ?? [] };
          const found = await mac.evaluate(dir, `return (${extract.toString()})(${JSON.stringify(tags)})`);
          Object.assign(out[scheme], found);
        }
      }
      const missing = Object.keys(spec.styles).filter((id) => !out.light[id]);
      if (missing.length) console.warn(`${file}: not found in the app: ${missing.join(", ")}`);
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(join(CACHE_DIR, file), JSON.stringify(out, null, 1) + "\n");
      console.log(`${file}: ${Object.keys(out.light).length} styles`);
    }
  } finally {
    await mac.command(dir, { cmd: "quit" }).catch(() => undefined);
  }
}

const onlyArg = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;
if (process.argv.includes("--app")) await fromApp(onlyArg);
const appCache = { light: {}, dark: {} };
for (const f of existsSync(CACHE_DIR) ? readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json")).sort() : []) {
  const c = JSON.parse(readFileSync(join(CACHE_DIR, f), "utf8"));
  Object.assign(appCache.light, c.light);
  Object.assign(appCache.dark, c.dark);
}

// The component samples (/dev/match/styles), cached in samples-cache.json; --no-samples reuses the cache (no web
// dev server needed, for work on the app's own screens).
const SAMPLES_CACHE = join(repo, "packages/design-tokens/match/samples-cache.json");
let themes;
if (process.argv.includes("--no-samples") && existsSync(SAMPLES_CACHE)) {
  themes = JSON.parse(readFileSync(SAMPLES_CACHE, "utf8"));
} else {
  const browser = await webkit.launch();
  themes = {};
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

  writeFileSync(SAMPLES_CACHE, JSON.stringify(themes, null, 1) + "\n");
}
Object.assign(themes.light, appCache.light);
Object.assign(themes.dark, appCache.dark);

const vars = Object.keys(themes.light).filter((k) => k.startsWith("var:")).sort();
const ids = Object.keys(themes.light).filter((k) => !k.startsWith("var:")).sort();
const n = (v) => (v === null || v === undefined || Number.isNaN(v) ? "nil" : `${Math.round(v * 1000) / 1000}`);
const color = ([r, g, b, a]) => `RGBA(${r}, ${g}, ${b}${a === 1 ? "" : `, ${n(a)}`})`;
const family = (f) => (/spectral/i.test(f) ? ".display" : /mono/i.test(f) ? ".mono" : ".sans");
const style = (s) => {
  const grad = s.gradient && !s.gradient.unsupported ? `WebGradient(angle: ${n(s.gradient.angle)}, stops: [${s.gradient.stops.map(color).join(", ")}])` : "nil";
  const shadows = s.shadows.map((l) => `ShadowLayer(x: ${n(l.x)}, y: ${n(l.y)}, blur: ${n(l.blur)}, spread: ${n(l.spread)}, color: ${color(l.color)}${l.inset ? ", inset: true" : ""})`).join(", ");
  return `WebComputedStyle(x: ${n(s.x)}, y: ${n(s.y)}, width: ${n(s.width)}, height: ${n(s.height)}, padding: WebInsets(${s.padding.map((p) => n(p ?? 0)).join(", ")}), margin: WebInsets(${s.margin.map((p) => n(p ?? 0)).join(", ")}), radius: ${n(s.radius)}, background: ${color(s.background)}, gradient: ${grad}, shadows: [${shadows}], borderWidth: ${n(s.border.width)}, borderColor: ${color(s.border.color)}, color: ${color(s.color)}, opacity: ${n(s.opacity)}, family: ${family(s.fontFamily)}, fontSize: ${n(s.fontSize)}, fontWeight: ${n(s.fontWeight)}, lineHeight: ${n(s.lineHeight)}, letterSpacing: ${n(s.letterSpacing)}, gap: ${n(s.gap)}, backdropBlur: ${n(s.backdropBlur)})`;
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

    /// The Mac's CSS colour variables (\`--mac-selected\`, \`--glass-hover\`), light and dark.
    public static let vars: [String: ColorPair] = [
${vars.map((k) => `        ${JSON.stringify(k.slice(4))}: ColorPair(light: ${color(themes.light[k].color)}, dark: ${color(themes.dark[k].color)})`).join(",\n")},
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
