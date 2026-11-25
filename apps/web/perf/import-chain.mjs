#!/usr/bin/env node
// Why a module is in a bundle (docs/perf/web-results.md): the shortest chain of static imports (not `import type`,
// not `import()`) from an entry file to any file whose path contains <target>.
//   node perf/import-chain.mjs <entry file> <target text> [--all]
// --all prints, for each first file on the way that matches the target, the chain to it.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const web = resolve(import.meta.dirname, "..");
const repo = resolve(web, "../..");
const [entryArg, target, ...rest] = process.argv.slice(2);
const all = rest.includes("--all");
const PACKAGES = { "@folevi/editor-schema": "packages/editor-schema/src/index.ts", "@folevi/local-store": "packages/local-store/src/index.ts", "@folevi/ai-prompts": "packages/ai-prompts/src/index.ts", "@folevi/design-tokens": "packages/design-tokens/src/index.ts" };

function resolveFile(base) {
  for (const s of ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"]) {
    const f = base + s;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}
function resolveSpec(spec, from) {
  if (spec.startsWith("@/")) return resolveFile(join(web, "src", spec.slice(2)));
  if (spec.startsWith(".")) return resolveFile(resolve(dirname(from), spec));
  if (PACKAGES[spec]) return join(repo, PACKAGES[spec]);
  const pkg = Object.keys(PACKAGES).find((p) => spec.startsWith(p + "/"));
  if (pkg) return resolveFile(join(repo, PACKAGES[pkg].replace(/\/index\.ts$/, ""), spec.slice(pkg.length + 1)));
  return null;
}
function imports(file) {
  const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[5]) {
      out.push(m[5]);
      continue;
    }
    if (m[2]) continue;
    // `import { type A, type B }` only: still erased.
    const names = m[3].replace(/^\{|\}$/g, "").split(",").map((x) => x.trim()).filter(Boolean);
    if (m[3].startsWith("{") && names.length && names.every((n) => n.startsWith("type "))) continue;
    out.push(m[4]);
  }
  return out;
}

/**
 * The shortest static import chain from `entryFile` to each first file whose repository path contains `target`
 * (all of them with `all`), as lists of repository paths; empty when nothing reaches it.
 */
export function importChains(entryFile, target, all = false) {
  const entry = resolve(entryFile);
  const prev = new Map([[entry, null]]);
  const queue = [entry];
  const hits = [];
  while (queue.length) {
    const f = queue.shift();
    if (relative(repo, f).includes(target) && f !== entry) {
      hits.push(f);
      if (!all) break;
      continue;
    }
    for (const spec of imports(f)) {
      const g = resolveSpec(spec, f);
      if (g && !prev.has(g)) {
        prev.set(g, f);
        queue.push(g);
      }
    }
  }
  return hits.map((h) => {
    const chain = [];
    for (let f = h; f; f = prev.get(f)) chain.unshift(relative(repo, f));
    return chain;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const chains = importChains(entryArg, target, all);
  if (!chains.length) console.log(`no static import chain from ${entryArg} to "${target}"`);
  for (const c of chains) console.log(c.join("\n  -> "), "\n");
}
