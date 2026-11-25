#!/usr/bin/env node
// What the app's start-up JavaScript is made of (docs/perf/web-results.md): the chunks an export's index.html
// lists (or every chunk with --all), attributed to source files through the build's source maps.
//   FOLEVI_SOURCEMAPS=1 node scripts/build-shell.mjs --no-copy
//   node perf/startup-js.mjs [exportDir=out-shell] [--depth 3] [--grep <text>] [--html <page.html> --static <.next/static>]
// Prints bytes per source folder (to --depth parts) and the biggest files. --grep lists the sources whose path
// contains <text> and the chunk each is in.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { Buffer } from "node:buffer";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(join(process.cwd(), "package.json"));
let SourceMapConsumer;
try {
  ({ SourceMapConsumer } = require("source-map-js"));
} catch {
  const pnpm = resolve(import.meta.dirname, "../../../node_modules/.pnpm");
  const dir = readdirSync(pnpm).find((d) => d.startsWith("source-map-js@"));
  ({ SourceMapConsumer } = require(join(pnpm, dir, "node_modules/source-map-js")));
}

const argv = process.argv.slice(2);
const flag = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const root = resolve(argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--")) ?? "out-shell");
const depth = Number(flag("--depth", 3));
const grep = flag("--grep", null);
const all = argv.includes("--all");

// --html <file> --static <dir>: a website page's HTML (curl it from `next start`) and the build's static/ folder.
const htmlFile = flag("--html", null);
const staticDir = flag("--static", null);
const html = readFileSync(htmlFile ?? join(root, "index.html"), "utf8");
const chunks = all
  ? readdirSync(join(root, "_next/static/chunks")).filter((f) => f.endsWith(".js")).map((f) => `/_next/static/chunks/${f}`)
  : [...new Set(html.match(/\/_next\/static\/chunks\/[^"']+\.js/g) ?? [])];

const bySource = new Map();
const chunkOf = new Map();
let total = 0;
let unmapped = 0;
for (const chunk of chunks) {
  const file = staticDir ? join(staticDir, chunk.replace(/^\/_next\/static\//, "")) : join(root, chunk);
  const code = readFileSync(file, "utf8");
  total += Buffer.byteLength(code);
  const named = code.match(/\/\/# sourceMappingURL=(\S+)\s*$/)?.[1];
  const mapFile = named && !named.startsWith("data:") ? join(file, "..", named) : `${file}.map`;
  if (!existsSync(mapFile)) {
    unmapped += Buffer.byteLength(code);
    continue;
  }
  const lines = code.split("\n");
  const map = new SourceMapConsumer(JSON.parse(readFileSync(mapFile, "utf8")));
  const segs = [];
  map.eachMapping((m) => segs.push(m));
  segs.sort((a, b) => a.generatedLine - b.generatedLine || a.generatedColumn - b.generatedColumn);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const n = segs[i + 1];
    const end = n && n.generatedLine === s.generatedLine ? n.generatedColumn : (lines[s.generatedLine - 1]?.length ?? s.generatedColumn);
    const len = Math.max(0, end - s.generatedColumn);
    const src = (s.source ?? "(none)").replace(/^.*?\/node_modules\/\.pnpm\/[^/]+\/node_modules\//, "node_modules/").replace(/^webpack:\/\/\/?|^turbopack:\/\/\/?(\[project\]\/)?/, "").replace(/^.*?apps\/web\//, "");
    bySource.set(src, (bySource.get(src) ?? 0) + len);
    if (!chunkOf.has(src)) chunkOf.set(src, chunk.split("/").pop());
  }
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`${chunks.length} chunks, ${kb(total)} (${kb(unmapped)} without a source map)`);
if (grep) {
  for (const [s, n] of [...bySource].filter(([s]) => s.includes(grep)).sort((a, b) => b[1] - a[1])) console.log(kb(n).padStart(10), s, chunkOf.get(s));
  process.exit(0);
}
const groups = new Map();
for (const [s, n] of bySource) {
  const parts = s.split("/");
  const key = parts[0] === "node_modules" ? parts.slice(0, parts[1]?.startsWith("@") ? 3 : 2).join("/") : parts.slice(0, depth).join("/");
  groups.set(key, (groups.get(key) ?? 0) + n);
}
console.log("\nBy folder or package:");
for (const [k, n] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 45)) console.log(kb(n).padStart(10), k);
console.log("\nBiggest files:");
for (const [k, n] of [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(kb(n).padStart(10), k);
