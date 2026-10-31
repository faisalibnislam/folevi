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
//
// The samples are read twice: as the Mac shows the web, and as the iPhone and iPad app does (<html
// data-native="ios">: Dynamic Type sizes, touch-sized controls; docs/IOS_REBUILD_PLAN.md section 3). Styles that
// differ on iOS go in WebStyles.ios, which `named` prefers on iOS.
//   pnpm styles:gen --app [--only frame,home]                (also reads the live app's elements listed in
//                                                            packages/design-tokens/match/app-styles/<area>.json
//                                                            from the Debug Mac app's web frame, into
//                                                            app-styles-cache/<area>.json)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extract } from "./style-extract.mjs";

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
  // Areas marked "ios" are the iPhone app's own screens, measured in the Simulator (apps/ios/scripts/screen-match.mjs).
  files = files.filter((f) => !JSON.parse(readFileSync(join(APP_DIR, f), "utf8")).ios);
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
    await mac.waitFor(dir, `return document.readyState === "complete" && !!document.querySelector('nav[aria-label="Folio"], [role="tablist"][aria-label="Page tools"]')`, 90_000);
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
// (<area>.ios.json: the same screens as the iPhone app's web draws them, apps/ios/scripts/gate-styles.mjs.)
const iosAppCache = { light: {}, dark: {} };
for (const f of existsSync(CACHE_DIR) ? readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json")).sort() : []) {
  const c = JSON.parse(readFileSync(join(CACHE_DIR, f), "utf8"));
  const into = f.endsWith(".ios.json") ? iosAppCache : appCache;
  Object.assign(into.light, c.light);
  Object.assign(into.dark, c.dark);
}

// The component samples (/dev/match/styles), cached in samples-cache.json; --no-samples reuses the cache (no web
// dev server needed, for work on the app's own screens).
const SAMPLES_CACHE = join(repo, "packages/design-tokens/match/samples-cache.json");
let themes;
if (process.argv.includes("--no-samples") && existsSync(SAMPLES_CACHE)) {
  themes = JSON.parse(readFileSync(SAMPLES_CACHE, "utf8"));
} else {
  const browser = await webkit.launch();
  const read = async (ios) => {
    const t = {};
    for (const scheme of ["light", "dark"]) {
      const page = await browser.newPage({ deviceScaleFactor: 2, colorScheme: scheme, viewport: { width: 900, height: 1400 } });
      const res = await page.goto(`${base}/dev/match/styles`, { waitUntil: "networkidle" });
      if (!res?.ok()) throw new Error(`${base}/dev/match/styles: HTTP ${res?.status()}`);
      await page.evaluate(([theme, ios]) => {
        const d = document.documentElement.dataset;
        d.theme = theme;
        if (ios) d.native = "ios";
        else d.desktop = "mac";
        d.chrome = "neutral";
      }, [scheme, ios]);
      await page.evaluate(() => document.fonts.ready);
      t[scheme] = await page.evaluate(extract);
      await page.close();
    }
    return t;
  };
  themes = await read(false);
  themes.ios = await read(true);
  await browser.close();

  writeFileSync(SAMPLES_CACHE, JSON.stringify(themes, null, 1) + "\n");
}
const iosThemes = themes.ios ?? { light: {}, dark: {} };
delete themes.ios;
Object.assign(iosThemes.light, iosAppCache.light);
Object.assign(iosThemes.dark, iosAppCache.dark);
Object.assign(themes.light, appCache.light);
Object.assign(themes.dark, appCache.dark);
// Styles only the iPhone app has (screens the Mac's harness doesn't reach, like the locked library): the same
// values everywhere, so `named` finds them.
for (const id of Object.keys(iosAppCache.light)) {
  if (themes.light[id] || !iosAppCache.dark[id]) continue;
  themes.light[id] = iosAppCache.light[id];
  themes.dark[id] = iosAppCache.dark[id];
}

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

const chunks = Array.from({ length: Math.ceil(ids.length / 25) }, (_, i) => ids.slice(i * 25, i * 25 + 25));
// The samples the iOS app's web draws differently.
const iosIds = ids.filter((id) => iosThemes.light[id] && iosThemes.dark[id] && (style(iosThemes.light[id]) !== style(themes.light[id]) || style(iosThemes.dark[id]) !== style(themes.dark[id])));
const iosChunks = Array.from({ length: Math.ceil(iosIds.length / 25) }, (_, i) => iosIds.slice(i * 25, i * 25 + 25));
const iosVars = vars.filter((k) => iosThemes.light[k] && iosThemes.dark[k] && (color(iosThemes.light[k].color) !== color(themes.light[k].color) || color(iosThemes.dark[k].color) !== color(themes.dark[k].color)));
const varLine = (k, t) => `        ${JSON.stringify(k.slice(4))}: ColorPair(light: ${color(t.light[k].color)}, dark: ${color(t.dark[k].color)})`;

const swift = `// Generated by scripts/web-styles.mjs from the web app's computed styles (/dev/match/styles in WebKit, as
// Folevi for Mac shows the web, and as the iOS app does for WebStyles.ios). Do not edit: change the web, then run
// pnpm styles:gen.
import CoreGraphics

public enum WebStyles {
    // Built one assignment at a time in small functions, never one big literal: the Swift type checker takes a
    // dictionary literal as one expression, and at this size it ran out of memory and froze the Mac (2026-10-28).
    public static let all: [String: WebStylePair] = {
        var d = [String: WebStylePair](minimumCapacity: ${ids.length})
${chunks.map((_, i) => `        add${i}(&d)`).join("\n")}
        return d
    }()
${chunks.map((part, i) => `
    private static func add${i}(_ d: inout [String: WebStylePair]) {
${part.map((id) => `        d[${JSON.stringify(id)}] = WebStylePair(\n            light: ${style(themes.light[id])},\n            dark: ${style(themes.dark[id])}\n        )`).join("\n")}
    }`).join("\n")}

    #if os(iOS)
    /// The samples the iPhone and iPad app's web draws differently (data-native="ios"); \`named\` prefers these.
    public static let ios: [String: WebStylePair] = {
        var d = [String: WebStylePair](minimumCapacity: ${iosIds.length})
${iosChunks.map((_, i) => `        addIos${i}(&d)`).join("\n")}
        return d
    }()
${iosChunks.map((part, i) => `
    private static func addIos${i}(_ d: inout [String: WebStylePair]) {
${part.map((id) => `        d[${JSON.stringify(id)}] = WebStylePair(\n            light: ${style(iosThemes.light[id])},\n            dark: ${style(iosThemes.dark[id])}\n        )`).join("\n")}
    }`).join("\n")}
    #endif

    /// The CSS colour variables (\`--mac-selected\`, \`--glass-hover\`), light and dark, as this platform's web has them.
    public static let vars: [String: ColorPair] = {
        var v: [String: ColorPair] = [
${vars.map((k) => "    " + varLine(k, themes)).join(",\n")},
        ]
        #if os(iOS)${iosVars.length ? `
        let ios: [String: ColorPair] = [
${iosVars.map((k) => "    " + varLine(k, iosThemes)).join(",\n")},
        ]
        v.merge(ios) { _, new in new }` : ""}
        #endif
        return v
    }()

    /// A style by its \`data-style\` id ("button.primary.md"), as this platform's web draws it. Missing ids are a
    /// programming error (the generated file and the samples are checked together).
    public static func named(_ id: String) -> WebStylePair {
        #if os(iOS)
        if let s = ios[id] { return s }
        #endif
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
  console.log(`wrote ${out} (${ids.length} styles, ${iosIds.length} different on iOS)`);
}
