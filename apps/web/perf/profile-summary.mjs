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
const row = (ms, k) => `${ms.toFixed(0).padStart(7)} ms  ${k}`;
console.log(`total sampled ${total.toFixed(0)} ms`);
console.log("\nSelf time by file:");
for (const [k, ms] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(row(ms, k));
console.log("\nSelf time by function:");
for (const [k, ms] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(row(ms, k));
