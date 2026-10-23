#!/usr/bin/env node
// Builds the app shell the Mac app carries built in (docs/LOCAL_MODE_PLAN.md §1, WP1):
//   pnpm --filter @folevi/web build:shell [--no-copy] [--required] [--production] [--dest <dir>]
// 1. `next build` with FOLEVI_BUILD=shell: a static export of src/app/*.shell.tsx into out-shell/.
// 2. Prunes what only the website uses from the export (public/ is copied in whole by Next).
// 3. Snapshots admin-managed themes and switched-off templates (scripts/snapshot-themes.mjs).
// 4. Checks the export (index.html, no route-handler, admin or marketing output) and reports its size.
// 5. Copies out-shell/ to apps/desktop/web/ (git-ignored), unless --no-copy.
// --required makes an unreachable deployment fail the build instead of shipping an empty snapshot (releases).
// --production (what `pnpm release` builds): Folevi's production deployment and website are baked in, never the
// development values in .env.local, and the export is checked for them afterwards. It builds into
// .next-shell-release/ so a development export in out-shell/ is left alone. Without it the build reads the
// .env files as before (development). --dest copies the export somewhere other than apps/desktop/web.
// Every build writes shell/build.json: which deployment it talks to, and the IndexedDB schema version it opens
// (the Mac app's handoff refuses a website database that is newer, docs/LOCAL_MODE.md).
// --platform ios: the export the iPhone and iPad app carries (apps/ios/web, docs/IOS.md), in .next-shell-ios (or
// .next-shell-ios-release with --production), with Folevi's version in shell/build.json.
// --app-version <v>: the version shell/build.json records (else version.json's, the one version of every app).
// --platform android: the export Folevi for Android carries (apps/android/web, docs/ANDROID_PLAN.md), built in a
// folder of its own (.next-shell-android, or .next-shell-android-release with --production) so it never replaces
// another app's export while it builds, with Folevi's version in shell/build.json.
import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotThemes } from "./snapshot-themes.mjs";

const web = resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const args = new Set(argv);
const production = args.has("--production");
/** The value after a flag ("--dest <dir>"), or null. */
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
/** Which app the export is for: "mac" (the default), "android" or "ios". */
const platform = flagValue("--platform") ?? "mac";
if (!["mac", "android", "ios"].includes(platform)) throw new Error(`build-shell: unknown --platform ${platform}`);
const android = platform === "android";
const ios = platform === "ios";
const outName = android ? (production ? ".next-shell-android-release" : ".next-shell-android") : ios ? (production ? ".next-shell-ios-release" : ".next-shell-ios") : production ? ".next-shell-release" : "out-shell";
const out = join(web, outName);
const desktopWeb = resolve(flagValue("--dest") ?? resolve(web, android ? "../android/web" : ios ? "../ios/web" : "../desktop/web"));

/**
 * Folevi in production (docs/DEPLOYMENT.md): the Convex deployment and the website a release talks to. A release
 * shell must never carry .env.local's development deployment, whatever the shell running the build exports.
 */
export const PRODUCTION_ENV = {
  NEXT_PUBLIC_CONVEX_URL: "https://fastidious-clownfish-123.convex.cloud",
  NEXT_PUBLIC_CONVEX_SITE_URL: "https://fastidious-clownfish-123.convex.site",
  NEXT_PUBLIC_APP_URL: "https://app.folevi.com",
  NEXT_PUBLIC_MARKETING_URL: "https://folevi.com",
};

/**
 * Files and folders from public/ the shell leaves out: the marketing site's art, the website's service worker,
 * search-console verification, the PWA manifest's icons and the browser-tab icons (the shell has neither), the
 * images only server-rendered emails and Open Graph cards use. Note covers, the brand marks and everything
 * else stay. A path ending in "/" is a folder.
 */
export const PRUNE = ["marketing/", "sw.js", /^google[0-9a-f]+\.html$/, "icons/", "favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "apple-icon.png", "icon.svg", "brand/email/", "brand/folevi-mark-256.png"];

const ENV_FILES = [".env.production.local", ".env.local", ".env.production", ".env", ".env.development", ".env.development.local"];

/** Every KEY=value in the app's .env files (the values a production build must not carry). */
export function envFileValues(dir = web) {
  const values = new Map();
  for (const f of ENV_FILES) {
    if (!existsSync(join(dir, f))) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
      if (!values.has(m[1])) values.set(m[1], value);
    }
  }
  return values;
}

/**
 * The environment `next build` runs with. Next reads the .env files itself (even .env.local in a production
 * build) but never replaces a variable the environment already has, so a production build sets every public
 * variable: the production values, and an empty string for any other NEXT_PUBLIC_ one the files name.
 */
export function buildEnv(base, { production: prod, files }) {
  const env = { ...base, FOLEVI_BUILD: "shell", NEXT_TELEMETRY_DISABLED: "1" };
  // The export must land in its own folder, whatever a second dev server's build folder is set to.
  delete env.NEXT_DIST_DIR;
  if (!prod) return env;
  for (const key of files.keys()) if (key.startsWith("NEXT_PUBLIC_")) env[key] = "";
  for (const key of Object.keys(env)) if (key.startsWith("NEXT_PUBLIC_")) env[key] = "";
  Object.assign(env, PRODUCTION_ENV, { NODE_ENV: "production" });
  return env;
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

async function textFiles(dir) {
  const outFiles = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) outFiles.push(...(await textFiles(p)));
    else if (/\.(js|mjs|html|txt|json|css|map)$/.test(e.name)) outFiles.push(p);
  }
  return outFiles;
}

/**
 * A production export's baked-in addresses: the production deployment is there, and no value from the .env
 * files is (no development deployment, no localhost, no secret), unless it's also a production value.
 */
export async function checkBakedEnv(dir, files) {
  const allowed = new Set(Object.values(PRODUCTION_ENV));
  const forbidden = [...new Set(files.values())].filter((v) => v.length >= 8 && !allowed.has(v) && !/^(true|false|production|development)$/i.test(v));
  forbidden.push("localhost:", "app.localhost");
  const found = new Set();
  let production = 0;
  for (const file of await textFiles(dir)) {
    const text = await readFile(file, "utf8");
    if (text.includes(PRODUCTION_ENV.NEXT_PUBLIC_CONVEX_URL)) production++;
    for (const v of forbidden) if (text.includes(v)) found.add(`${relative(dir, file)}: ${v.length > 24 ? `${v.slice(0, 12)}…` : v}`);
  }
  const problems = [...found].slice(0, 10);
  if (!production) problems.push(`${PRODUCTION_ENV.NEXT_PUBLIC_CONVEX_URL} isn't in the export`);
  return problems;
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

/** The IndexedDB schema version the export opens (src/lib/sync/db.ts DB_VERSION). */
export async function dbVersion() {
  const m = /export const DB_VERSION = (\d+);/.exec(await readFile(join(web, "src/lib/sync/db.ts"), "utf8"));
  if (!m) throw new Error("build-shell: can't find DB_VERSION in src/lib/sync/db.ts");
  return Number(m[1]);
}

/** shell/build.json: what this export is (read by the Mac app, apps/desktop/src/shellBuild.ts). */
async function writeBuildInfo(env) {
  // Folevi's one version (version.json at the repo root, scripts/version.mjs), the same for every app.
  const { version } = JSON.parse(await readFile(resolve(web, "../../version.json"), "utf8"));
  const info = {
    v: 1,
    target: production ? "production" : "development",
    platform,
    convexUrl: env.NEXT_PUBLIC_CONVEX_URL ?? null,
    siteUrl: env.NEXT_PUBLIC_APP_URL || "https://app.folevi.com",
    dbVersion: await dbVersion(),
    // --app-version: the version a release script was given (apps/mac/scripts/release.mjs passes version.json's).
    appVersion: flagValue("--app-version") ?? version,
    builtAt: new Date().toISOString(),
  };
  await mkdir(join(out, "shell"), { recursive: true });
  await writeFile(join(out, "shell/build.json"), `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

async function main() {
  const files = envFileValues();
  if (production) {
    // The snapshot reads the same deployment the build bakes in.
    Object.assign(process.env, PRODUCTION_ENV);
  } else {
    // Next reads .env files itself; the snapshot reads the same deployment address. Earlier files win, like Next's
    // order for a production build, and nothing overrides what the environment already sets.
    for (const f of ENV_FILES.slice(0, 4)) {
      if (existsSync(join(web, f))) process.loadEnvFile(join(web, f));
    }
  }
  const start = Date.now();
  // `next build` rewrites next-env.d.ts and may add its types folder to tsconfig.json (neither is committed
  // from a build); put them back as they were.
  const kept = new Map();
  for (const f of ["next-env.d.ts", "tsconfig.json"]) if (existsSync(join(web, f))) kept.set(f, await readFile(join(web, f), "utf8"));
  await rm(out, { recursive: true, force: true });
  const env = buildEnv(process.env, { production, files });
  if (production || android || ios) env.NEXT_DIST_DIR = outName;
  const build = spawnSync(join(web, "node_modules/.bin/next"), ["build"], { cwd: web, stdio: "inherit", env });
  for (const [f, text] of kept) await writeFile(join(web, f), text);
  if (build.status !== 0) process.exit(build.status ?? 1);

  const removed = await prune();
  await hoistCsp();
  const snap = await snapshotThemes({ outDir: out, required: args.has("--required") });
  await verify();
  const info = await writeBuildInfo(production ? env : process.env);
  if (production) {
    const problems = await checkBakedEnv(out, files);
    if (problems.length) throw new Error(`build-shell: the production export carries development values:\n  ${problems.join("\n  ")}`);
  }

  const report = [];
  for (const [label, path] of [
    ["JavaScript and CSS", "_next/static/chunks"],
    ["Fonts", "_next/static/media"],
    ["Note covers", "covers"],
    ["Snapshot", "shell"],
  ]) {
    if (existsSync(join(out, path))) report.push(`  ${label.padEnd(20)} ${mb(await sizeOf(join(out, path)))}`);
  }
  console.log(`\nbuild-shell: ${outName}/ ${mb(await sizeOf(out))} in ${((Date.now() - start) / 1000).toFixed(0)} s (${info.target}: ${info.convexUrl ?? "no deployment"}, ${info.siteUrl}, IndexedDB v${info.dbVersion})`);
  console.log(report.join("\n"));
  console.log(`  pruned: ${removed.join(", ") || "nothing"}`);
  console.log(`  snapshot: ${snap.themes} theme rows, ${snap.images} images, ${snap.disabledTemplates} templates switched off (${snap.source ?? "none"})`);

  if (!args.has("--no-copy")) {
    await rm(desktopWeb, { recursive: true, force: true });
    await cp(out, desktopWeb, { recursive: true });
    console.log(`  copied to ${relative(process.cwd(), desktopWeb) || desktopWeb}`);
  }
}

// Run as a script (imported by tests, it only exports its helpers).
if (import.meta.main ?? process.argv[1] === fileURLToPath(import.meta.url)) await main();
