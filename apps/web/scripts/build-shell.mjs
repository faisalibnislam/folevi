#!/usr/bin/env node
// Builds the app shell the Mac app carries built in (docs/LOCAL_MODE_PLAN.md §1, WP1):
//   pnpm --filter @folevi/web build:shell [--no-copy] [--required]
// 1. `next build` with FOLEVI_BUILD=shell: a static export of src/app/*.shell.tsx into out-shell/.
// 2. Prunes what only the website uses from the export (public/ is copied in whole by Next).
// 3. Snapshots admin-managed themes and switched-off templates (scripts/snapshot-themes.mjs).
// 4. Checks the export (index.html, no route-handler, admin or marketing output) and reports its size.
// 5. Copies out-shell/ to apps/desktop/web/ (git-ignored), unless --no-copy.
// --required makes an unreachable deployment fail the build instead of shipping an empty snapshot (releases).
// The iPhone and iPad app (apps/ios/www) is paused and isn't copied to.
import { spawnSync } from "node:child_process";
import { cp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { snapshotThemes } from "./snapshot-themes.mjs";

const web = resolve(import.meta.dirname, "..");
const out = join(web, "out-shell");
const desktopWeb = resolve(web, "../desktop/web");
const args = new Set(process.argv.slice(2));

/**
 * Files and folders from public/ the shell leaves out: the marketing site's art, the website's service worker,
 * search-console verification, the PWA manifest's icons and the browser-tab icons (the shell has neither), the
 * images only server-rendered emails and Open Graph cards use. Note covers, the brand marks and everything
 * else stay. A path ending in "/" is a folder.
 */
export const PRUNE = ["marketing/", "sw.js", /^google[0-9a-f]+\.html$/, "icons/", "favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "apple-icon.png", "icon.svg", "brand/email/", "brand/folevi-mark-256.png"];

// Next reads .env files itself; the snapshot reads the same deployment address. Earlier files win, like Next's
// order for a production build, and nothing overrides what the environment already sets.
for (const f of [".env.production.local", ".env.local", ".env.production", ".env"]) {
  if (existsSync(join(web, f))) process.loadEnvFile(join(web, f));
}

async function sizeOf(path) {
  const s = await stat(path);
  if (!s.isDirectory()) return s.size;
  let total = 0;
  for (const e of await readdir(path)) total += await sizeOf(join(path, e));
  return total;
}
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

async function prune() {
  const removed = [];
  for (const rule of PRUNE) {
    if (typeof rule === "string") {
      const p = join(out, rule);
      if (existsSync(p)) {
        await rm(p, { recursive: true, force: true });
        removed.push(rule);
      }
    } else {
      for (const name of await readdir(out)) {
        if (rule.test(name)) {
          await rm(join(out, name), { force: true });
          removed.push(name);
        }
      }
    }
  }
  return removed;
}

/**
 * Next writes its script tags at the top of <head>, ahead of the layout's own tags, and a CSP meta tag only
 * governs what comes after it. Moves the policy to just after <meta charset> in every page so it covers all of
 * them (React leaves an unknown tag order in <head> alone when it hydrates).
 */
async function hoistCsp() {
  const meta = /<meta http-equiv="Content-Security-Policy" content="[^"]*"\/>/;
  for (const name of await readdir(out)) {
    if (!name.endsWith(".html")) continue;
    const file = join(out, name);
    const html = await readFile(file, "utf8");
    const tag = meta.exec(html)?.[0];
    if (!tag) throw new Error(`build-shell: ${name} has no Content-Security-Policy meta tag`);
    const charset = '<meta charSet="utf-8"/>';
    if (!html.includes(charset)) throw new Error(`build-shell: ${name} has no charset meta tag`);
    await writeFile(file, html.replace(tag, "").replace(charset, charset + tag));
  }
}

/** The export's own checks; e2e/shell/export.spec.ts asserts the same and more. */
async function verify() {
  const problems = [];
  if (!existsSync(join(out, "index.html"))) problems.push("no index.html");
  for (const p of ["api", "admin", "s", "signin", "signup", "manifest.webmanifest", "sitemap.xml", "robots.txt", "sw.js", "marketing"]) {
    if (existsSync(join(out, p)) || existsSync(join(out, `${p}.html`))) problems.push(`unexpected ${p} in the export`);
  }
  if (problems.length) throw new Error(`build-shell: ${problems.join("; ")}`);
}

const start = Date.now();
// `next build` rewrites next-env.d.ts (never committed); put it back as it was.
const nextEnv = join(web, "next-env.d.ts");
const nextEnvBefore = existsSync(nextEnv) ? await readFile(nextEnv, "utf8") : null;
await rm(out, { recursive: true, force: true });
const env = { ...process.env, FOLEVI_BUILD: "shell", NEXT_TELEMETRY_DISABLED: "1" };
// The export must land in out-shell/, whatever a second dev server's build folder is set to.
delete env.NEXT_DIST_DIR;
const build = spawnSync(join(web, "node_modules/.bin/next"), ["build"], { cwd: web, stdio: "inherit", env });
if (nextEnvBefore !== null) await writeFile(nextEnv, nextEnvBefore);
if (build.status !== 0) process.exit(build.status ?? 1);

const removed = await prune();
await hoistCsp();
const snap = await snapshotThemes({ outDir: out, required: args.has("--required") });
await verify();

const report = [];
for (const [label, path] of [
  ["JavaScript and CSS", "_next/static/chunks"],
  ["Fonts", "_next/static/media"],
  ["Note covers", "covers"],
  ["Snapshot", "shell"],
]) {
  if (existsSync(join(out, path))) report.push(`  ${label.padEnd(20)} ${mb(await sizeOf(join(out, path)))}`);
}
console.log(`\nbuild-shell: out-shell/ ${mb(await sizeOf(out))} in ${((Date.now() - start) / 1000).toFixed(0)} s`);
console.log(report.join("\n"));
console.log(`  pruned: ${removed.join(", ") || "nothing"}`);
console.log(`  snapshot: ${snap.themes} theme rows, ${snap.images} images, ${snap.disabledTemplates} templates switched off (${snap.source ?? "none"})`);

if (!args.has("--no-copy")) {
  await rm(desktopWeb, { recursive: true, force: true });
  await cp(out, desktopWeb, { recursive: true });
  console.log(`  copied to ${relative(process.cwd(), desktopWeb) || desktopWeb}`);
}
