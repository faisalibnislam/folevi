// Builds a minimal FUNCTIONS_DIR for the Folevi Server bundle (called by prepare-functions.sh; see its header).
//
//   node server/bundle/prepare-functions.mjs <repo> <out>
//
// The Convex CLI bundles convex/ with esbuild at deploy time, so functions/ needs convex/ and only the packages
// that bundle reads, plus the CLI's own runtime (convex, esbuild, prettier, ws). We find them by running esbuild
// the way the CLI does (isolate modules: platform browser with conditions convex+module; "use node" modules:
// platform node) with a metafile, take every package a bundled file lives in, add each one's declared
// dependencies (not peers, so optional peers such as next or react are never pulled in), and lay them out as a
// plain node_modules tree (one copy per name at the top, a nested copy where two versions are needed). Source
// maps, type declarations and docs are dropped.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const [repoArg, outArg] = process.argv.slice(2);
if (!repoArg || !outArg) {
  console.error("usage: prepare-functions.mjs <repo> <out>");
  process.exit(2);
}
const repo = path.resolve(repoArg);
const out = path.resolve(outArg);
const convexDir = path.join(repo, "convex");
const log = (...a) => console.error("prepare-functions:", ...a);

const requireFromRepo = createRequire(path.join(repo, "package.json"));
// The Convex CLI's own esbuild, so resolution matches the deploy exactly.
const convexReal = fs.realpathSync(path.join(repo, "node_modules", "convex"));
const esbuild = createRequire(path.join(convexReal, "package.json"))("esbuild");

// ---- 1. Entry points, as the Convex CLI picks them (bundler/index.js entryPoints).
const ENTRY_EXT = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".jsx"];
const entries = [];
(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) {
      if (e.name === "_generated" || e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(path.join(dir, e.name), r);
    } else if (ENTRY_EXT.some((x) => e.name.endsWith(x)) && !e.name.endsWith(".d.ts") && !e.name.startsWith(".")) {
      entries.push(path.join(dir, e.name));
    }
  }
})(convexDir, "");
const useNode = /^\s*("|')use node("|');?\s*$/m;
const nodeEntries = entries.filter((f) => useNode.test(fs.readFileSync(f, "utf8")));
const isolateEntries = entries.filter((f) => !nodeEntries.includes(f));
log(`${entries.length} entry points (${nodeEntries.length} "use node")`);

const builtins = new Set(requireFromRepo("node:module").builtinModules.flatMap((m) => [m, `node:${m}`]));
async function metafile(entryPoints, platform) {
  if (!entryPoints.length) return { inputs: {} };
  const r = await esbuild.build({
    entryPoints,
    bundle: true,
    platform,
    format: "esm",
    target: "esnext",
    jsx: "automatic",
    outdir: "/nonexistent-out",
    outbase: convexDir,
    conditions: ["convex", "module"],
    write: false,
    metafile: true,
    logLevel: "error",
    absWorkingDir: repo,
    // The isolate bundle shims or rejects node builtins; either way no package is read for them.
    external: platform === "browser" ? [...builtins] : [],
    loader: { ".wasm": "binary" },
  });
  return r.metafile;
}
const metas = [await metafile(isolateEntries, "browser"), await metafile(nodeEntries, "node")];

// ---- 2. Packages: every package a bundled file lives in, plus declared dependencies.
function packageRoot(file) {
  // The nearest folder above `file` with a package.json that has a name, inside a node_modules folder or
  // under packages/ (workspace packages).
  let dir = path.dirname(file);
  while (dir !== path.dirname(dir)) {
    const pj = path.join(dir, "package.json");
    if (fs.existsSync(pj)) {
      try {
        const j = JSON.parse(fs.readFileSync(pj, "utf8"));
        if (j.name && (dir.includes(`${path.sep}node_modules${path.sep}`) || dir.startsWith(path.join(repo, "packages")))) {
          return { dir, name: j.name, json: j };
        }
      } catch {}
    }
    dir = path.dirname(dir);
  }
  return null;
}
const pkgs = new Map(); // realpath -> {dir, name, json}
const readFiles = new Set(); // realpaths of every file a bundle read (workspace packages copy only these)
const edges = new Map(); // realpath -> Map(name -> realpath)
function addPkg(p) {
  if (!pkgs.has(p.dir)) {
    pkgs.set(p.dir, p);
    edges.set(p.dir, new Map());
    return true;
  }
  return false;
}
function addEdge(fromDir, name, toDir) {
  if (fromDir && fromDir !== toDir) edges.get(fromDir).set(name, toDir);
}
for (const meta of metas) {
  for (const [input, info] of Object.entries(meta.inputs)) {
    if (input.includes(":")) continue; // virtual (plugin namespaces)
    const abs = fs.realpathSync(path.resolve(repo, input));
    readFiles.add(abs);
    const p = packageRoot(abs);
    if (!p) continue;
    addPkg(p);
    for (const imp of info.imports || []) {
      if (imp.external || !imp.path || imp.path.includes(":")) continue;
      const q = packageRoot(fs.realpathSync(path.resolve(repo, imp.path)));
      if (q) {
        addPkg(q);
        addEdge(p.dir, q.name, q.dir);
      }
    }
  }
}
// The CLI itself.
const cli = packageRoot(path.join(convexReal, "package.json"));
addPkg(cli);

// Resolve dependency `name` the way Node does from package folder `from` (pnpm: siblings in the same
// .pnpm/<id>/node_modules; workspace packages: their own node_modules).
function resolveFrom(from, name) {
  let dir = from;
  while (dir !== path.dirname(dir)) {
    const cand = path.basename(dir) === "node_modules" ? path.join(dir, name) : path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(cand, "package.json"))) return fs.realpathSync(cand);
    dir = path.dirname(dir);
  }
  return null;
}
const queue = [...pkgs.keys()];
while (queue.length) {
  const dir = queue.shift();
  const j = pkgs.get(dir).json;
  const deps = { ...(j.dependencies || {}), ...(j.optionalDependencies || {}) };
  for (const name of Object.keys(deps)) {
    const r = resolveFrom(dir, name);
    if (!r) {
      if (!(j.optionalDependencies || {})[name]) log(`warning: ${j.name} needs ${name}, which is not installed`);
      continue;
    }
    const p = packageRoot(path.join(r, "package.json"));
    if (!p) continue;
    if (addPkg(p)) queue.push(p.dir);
    addEdge(dir, p.name, p.dir);
  }
}

// ---- 3. Layout. The top level gets, per name, the copy the repo root resolves (else the first seen); other
// versions are nested under the package that needs them.
const top = new Map(); // name -> realpath
for (const [dir, p] of pkgs) {
  const rootPick = resolveFrom(repo, p.name);
  if (rootPick && pkgs.has(rootPick)) top.set(p.name, rootPick);
}
for (const [dir, p] of pkgs) if (!top.has(p.name)) top.set(p.name, dir);

const nm = path.join(out, "node_modules");
const placed = new Map(); // dest folder -> realpath
const SKIP_FILE = /(\.map|\.d\.ts|\.d\.mts|\.d\.cts|\.tsbuildinfo)$|^(CHANGELOG|HISTORY)(\.md)?$|^README(\.md|\.markdown)?$/i;
const SKIP_DIR = new Set(["node_modules", "test", "tests", "__tests__", ".github", "docs", "example", "examples"]);
function copyPkg(src, dest, isWorkspace) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name) || (isWorkspace && e.name.startsWith("."))) continue;
      copyPkg(s, d, isWorkspace);
    } else if (e.isSymbolicLink()) {
      const t = fs.realpathSync(s);
      if (fs.statSync(t).isDirectory()) copyPkg(t, d, isWorkspace);
      else fs.copyFileSync(t, d);
    } else if (!SKIP_FILE.test(e.name)) {
      fs.copyFileSync(s, d);
      fs.chmodSync(d, fs.statSync(s).mode & 0o777);
    }
  }
}
// Workspace packages (TypeScript sources, some with large assets such as design-tokens' covers): only the files
// the bundles read, plus package.json.
function copyWorkspacePkg(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(src, "package.json"), path.join(dest, "package.json"));
  for (const f of readFiles) {
    if (!f.startsWith(src + path.sep)) continue;
    const rel = path.relative(src, f);
    if (rel.split(path.sep).includes("node_modules")) continue;
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    fs.copyFileSync(f, path.join(dest, rel));
  }
}
function place(real, destDir) {
  if (placed.has(destDir)) return;
  placed.set(destDir, real);
  const p = pkgs.get(real);
  if (real.includes(`${path.sep}node_modules${path.sep}`)) copyPkg(real, destDir, false);
  else copyWorkspacePkg(real, destDir);
  for (const [name, depReal] of edges.get(real)) {
    // What Node would find from destDir.
    let found = null;
    let d = destDir;
    while (d.startsWith(nm)) {
      const cand = path.basename(d) === "node_modules" ? path.join(d, name) : path.join(d, "node_modules", name);
      if (placed.has(cand)) {
        found = placed.get(cand);
        break;
      }
      d = path.dirname(d);
    }
    if (found === depReal) continue;
    if (!found && top.get(name) === depReal) continue; // placed at the top later
    place(depReal, path.join(destDir, "node_modules", name));
    log(`nested ${name} under ${p.name}`);
  }
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(nm, { recursive: true });
for (const [name, real] of top) place(real, path.join(nm, name));

// ---- 4. The app: convex/ (with _generated), convex.json, tsconfig, a package.json without workspace links.
fs.cpSync(convexDir, path.join(out, "convex"), {
  recursive: true,
  filter: (s) => !/(^|\/)(\.env[^/]*|node_modules)$/.test(s),
});
// Files convex/ reaches by relative path outside itself (convex/lib/folderColors.ts imports
// ../../packages/design-tokens/covers/*.json): same place relative to convex/.
for (const f of readFiles) {
  const rel = path.relative(repo, f);
  if (rel.startsWith("..") || rel.startsWith(`convex${path.sep}`) || rel.split(path.sep).includes("node_modules")) continue;
  fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
  fs.copyFileSync(f, path.join(out, rel));
}
// Folevi Server's auth config replaces the cloud one (auth.config.server.ts says why).
fs.copyFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "auth.config.server.ts"), path.join(out, "convex", "auth.config.ts"));
for (const f of ["convex.json", "tsconfig.json"]) {
  if (fs.existsSync(path.join(repo, f))) fs.copyFileSync(path.join(repo, f), path.join(out, f));
}
const rootPkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
const deps = {};
for (const [k, v] of Object.entries(rootPkg.dependencies || {})) {
  const r = pkgs.get(resolveFrom(repo, k));
  deps[k] = r ? r.json.version : v;
}
fs.writeFileSync(
  path.join(out, "package.json"),
  JSON.stringify({ name: "folevi-server-functions", private: true, type: rootPkg.type || "module", dependencies: deps }, null, 2) + "\n",
);
log(`${pkgs.size} packages: ${[...top.keys()].sort().join(" ")}`);
