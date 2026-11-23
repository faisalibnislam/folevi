#!/usr/bin/env node
// The web app's icons for Folevi for Android (docs/ANDROID_NATIVE_PLAN.md): the Kotlin twin of
// scripts/icons-codegen.mjs. Every lucide-react icon apps/web/src imports, as SVG path data (circles, rects,
// lines and polylines turned into paths), into apps/android/app/src/main/java/com/folevi/android/design/
// WebIcons.kt. The app's FoleviIcon builds a Compose ImageVector from it, stroked as lucide draws (24 dp grid,
// round caps and joins, stroke width 2).
//
//   pnpm icons:gen:kotlin            write the Kotlin file
//   pnpm icons:gen:kotlin --check    fail if it is out of date (CI)
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webSrc = join(repo, "apps/web/src");
const out = join(repo, "apps/android/app/src/main/java/com/folevi/android/design/WebIcons.kt");
const check = process.argv.includes("--check");

// lucide-react as the web app resolves it.
const require = createRequire(join(repo, "apps/web/package.json"));
const lucideRoot = dirname(dirname(require.resolve("lucide-react")));
const lucideEsm = existsSync(join(lucideRoot, "esm")) ? join(lucideRoot, "esm") : join(lucideRoot, "dist/esm");
const version = JSON.parse(readFileSync(join(dirname(lucideRoot), "package.json"), "utf8")).version;

// Export name (X, XIcon, LucideX) -> icon file name (x).
const exportsToFile = new Map();
for (const m of readFileSync(join(lucideEsm, "lucide-react.mjs"), "utf8").matchAll(/export \{([^}]+)\} from '\.\/icons\/([a-z0-9-]+)\.mjs'/g)) {
  for (const part of m[1].split(",")) {
    const name = part.trim().replace(/^default as /, "");
    if (name) exportsToFile.set(name, m[2]);
  }
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(tsx?|jsx?)$/.test(entry)) acc.push(p);
  }
  return acc;
}

const used = new Set();
const unknown = new Set();
for (const file of walk(webSrc)) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']lucide-react["']/g)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (!name || /^(LucideIcon|LucideProps|LucideIconNode|LucideIconData|IconNode|SVGAttributes|createLucideIcon|useLucideContext|Icon|icons)$/.test(name)) continue;
      const fileName = exportsToFile.get(name);
      if (fileName) used.add(fileName);
      else unknown.add(name);
    }
  }
}
if (unknown.size) console.warn(`not lucide icons, skipped: ${[...unknown].sort().join(", ")}`);

/** The icon's drawing (`__iconData.node`), from its module (which imports React, as the web app does). */
const nodes = new Map();
for (const fileName of used) {
  const mod = await import(pathToFileURL(join(lucideEsm, "icons", `${fileName}.mjs`)).href);
  if (!Array.isArray(mod.__iconData?.node)) throw new Error(`can't read lucide icon ${fileName}`);
  nodes.set(fileName, mod.__iconData.node);
}
const iconNode = (fileName) => nodes.get(fileName);

const num = (v) => {
  const x = Number(v ?? 0);
  if (!Number.isFinite(x)) throw new Error(`not a number: ${v}`);
  return `${Math.round(x * 1000) / 1000}`;
};
const pts = (s) => String(s).trim().split(/[\s,]+/).map(Number);

/** One lucide element as SVG path data. */
function pathOf([tag, a]) {
  switch (tag) {
    case "path":
      return a.d;
    case "circle": {
      const [cx, cy, r] = [Number(a.cx), Number(a.cy), Number(a.r)];
      return `M${num(cx - r)} ${num(cy)}a${num(r)} ${num(r)} 0 1 0 ${num(2 * r)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-2 * r)} 0Z`;
    }
    case "ellipse": {
      const [cx, cy, rx, ry] = [Number(a.cx), Number(a.cy), Number(a.rx), Number(a.ry)];
      return `M${num(cx - rx)} ${num(cy)}a${num(rx)} ${num(ry)} 0 1 0 ${num(2 * rx)} 0a${num(rx)} ${num(ry)} 0 1 0 ${num(-2 * rx)} 0Z`;
    }
    case "rect": {
      const x = Number(a.x ?? 0), y = Number(a.y ?? 0), w = Number(a.width), h = Number(a.height);
      const rx = Math.min(Number(a.rx ?? a.ry ?? 0), w / 2), ry = Math.min(Number(a.ry ?? a.rx ?? 0), h / 2);
      if (!rx && !ry) return `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}Z`;
      return `M${num(x + rx)} ${num(y)}h${num(w - 2 * rx)}a${num(rx)} ${num(ry)} 0 0 1 ${num(rx)} ${num(ry)}v${num(h - 2 * ry)}a${num(rx)} ${num(ry)} 0 0 1 ${num(-rx)} ${num(ry)}h${num(-(w - 2 * rx))}a${num(rx)} ${num(ry)} 0 0 1 ${num(-rx)} ${num(-ry)}v${num(-(h - 2 * ry))}a${num(rx)} ${num(ry)} 0 0 1 ${num(rx)} ${num(-ry)}Z`;
    }
    case "line":
      return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
    case "polyline":
    case "polygon": {
      const p = pts(a.points);
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i + 1 < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      return tag === "polygon" ? d + "Z" : d;
    }
    default:
      throw new Error(`unknown lucide element ${tag}`);
  }
}

const entry = (s) => {
  const e = s.replace(/-/g, "_").toUpperCase();
  return /^[0-9]/.test(e) ? `I_${e}` : e;
};
const names = [...used].sort();
const kotlin = `// Generated by scripts/icons-codegen-kotlin.mjs from lucide-react ${version}. Do not edit.
// The icons apps/web/src imports (${names.length}), as SVG path data on lucide's 24 dp grid.
package com.folevi.android.design

enum class WebIcon(val lucide: String, val paths: List<String>) {
${names.map((x) => `    ${entry(x)}(${JSON.stringify(x)}, listOf(${iconNode(x).map((nd) => JSON.stringify(pathOf(nd))).join(", ")})),`).join("\n")}
}
`;

if (check) {
  if (!existsSync(out) || readFileSync(out, "utf8") !== kotlin) {
    console.error(`${out} is out of date: run pnpm icons:gen:kotlin`);
    process.exit(1);
  }
} else {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, kotlin);
  console.log(`wrote ${out} (${names.length} icons, lucide-react ${version})`);
}
