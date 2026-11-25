#!/usr/bin/env node
// Where a CPU profile's time went (docs/perf/web-results.md): self time per source file and per function, mapped
// through the export's source maps (build it with FOLEVI_SOURCEMAPS=1 and measure against it with PERF_ROOT).
//   node perf/profile-summary.mjs <file.cpuprofile> [exportDir=.next-perf-maps] [--top 30]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pnpm = resolve(import.meta.dirname, "../../../node_modules/.pnpm");
const { SourceMapConsumer } = require(join(pnpm, readdirSync(pnpm).find((d) => d.startsWith("source-map-js@")), "node_modules/source-map-js"));

const [file, rootArg = ".next-perf-maps", ...rest] = process.argv.slice(2);
const top = Number(rest[rest.indexOf("--top") + 1] ?? 30) || 30;
const root = resolve(rootArg);
const profile = JSON.parse(readFileSync(file, "utf8"));
const maps = new Map();
function mapFor(url) {
  if (maps.has(url)) return maps.get(url);
  let consumer = null;
  try {
    const path = join(root, new URL(url).pathname);
    if (existsSync(path)) {
      const code = readFileSync(path, "utf8");
      const named = code.match(/\/\/# sourceMappingURL=(\S+)\s*$/)?.[1];
      const mapFile = named ? join(path, "..", named) : `${path}.map`;
      if (existsSync(mapFile)) consumer = new SourceMapConsumer(JSON.parse(readFileSync(mapFile, "utf8")));
    }
  } catch {
    consumer = null;
  }
  maps.set(url, consumer);
  return consumer;
}
const clean = (s) => (s ?? "?").replace(/^.*?\/node_modules\/\.pnpm\/[^/]+\/node_modules\//, "node_modules/").replace(/^turbopack:\/\/\/?(\[project\]\/)?/, "").replace(/^.*?apps\/web\//, "");

const dt = new Map();
const ids = profile.samples ?? [];
const deltas = profile.timeDeltas ?? [];
for (let i = 0; i < ids.length; i++) dt.set(ids[i], (dt.get(ids[i]) ?? 0) + (deltas[i] ?? 0) / 1000);
const byFile = new Map();
const byFn = new Map();
let total = 0;
for (const node of profile.nodes) {
  const ms = dt.get(node.id) ?? 0;
  if (!ms) continue;
  total += ms;
  const cf = node.callFrame;
  let src = cf.url ? clean(cf.url) : `(${cf.functionName || "native"})`;
  let fn = cf.functionName || "(anonymous)";
  const c = cf.url ? mapFor(cf.url) : null;
  if (c && cf.lineNumber >= 0) {
    const o = c.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
    if (o.source) {
      src = clean(o.source);
      fn = `${o.name ?? fn} (${src}:${o.line})`;
    }
  }
  if (["(idle)", "(program)", "(garbage collector)"].includes(cf.functionName)) src = cf.functionName;
  byFile.set(src, (byFile.get(src) ?? 0) + ms);
  byFn.set(fn, (byFn.get(fn) ?? 0) + ms);
}
// Inclusive time (self and everything it called) per function of the app's own code (src/, packages/): which
// component or hook a slow interaction spent its time in. Recursion is counted once per stack.
const nodesById = new Map(profile.nodes.map((n) => [n.id, n]));
const parentOf = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parentOf.set(c, n.id);
const nameOf = new Map();
for (const n of profile.nodes) {
  const cf = n.callFrame;
  const c = cf.url ? mapFor(cf.url) : null;
  let label = null;
  if (c && cf.lineNumber >= 0) {
    const o = c.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
    if (o.source) {
      const src = clean(o.source);
      if (/^(src|packages)\//.test(src)) label = `${o.name ?? cf.functionName ?? "?"} (${src}:${o.line})`;
    }
  }
  nameOf.set(n.id, label);
}
const inclusive = new Map();
for (const n of profile.nodes) {
  const ms = dt.get(n.id) ?? 0;
  if (!ms) continue;
  const seen = new Set();
  for (let id = n.id; id !== undefined; id = parentOf.get(id)) {
    const label = nameOf.get(id);
    if (label && !seen.has(label)) {
      seen.add(label);
      inclusive.set(label, (inclusive.get(label) ?? 0) + ms);
    }
  }
}
void nodesById;
const row = (ms, k) => `${ms.toFixed(0).padStart(7)} ms  ${k}`;
console.log(`total sampled ${total.toFixed(0)} ms`);
console.log("\nSelf time by file:");
for (const [k, ms] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(row(ms, k));
console.log("\nSelf time by function:");
for (const [k, ms] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(row(ms, k));
console.log("\nInclusive time, the app's own functions:");
for (const [k, ms] of [...inclusive].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(row(ms, k));
