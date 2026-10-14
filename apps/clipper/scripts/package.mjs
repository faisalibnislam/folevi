// Packs dist/ into release/folevi-clipper-<version>.zip for the Chrome Web Store and Edge Add-ons, with
// manifest.json at the root of the zip. Refuses a development build, and checks the bundle first: every
// file the manifest names is there, the version matches package.json, and no code runs from strings or
// loads from the network.
import { zipSync } from "fflate";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));

const fail = (message) => {
  console.error(`Not packaged: ${message}`);
  process.exit(1);
};

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else out.push(relative(dist, path).split("\\").join("/"));
  }
  return out.sort();
}

const all = await files(dist);
if (manifest.manifest_version !== 3) fail("manifest_version must be 3.");
if (manifest.version !== pkg.version) fail(`manifest version ${manifest.version} isn't package.json's ${pkg.version}.`);
if (manifest.name.includes("development") || manifest.host_permissions.some((h) => h !== "https://app.folevi.com/*")) fail("this is a development build. Run `pnpm package`, which builds for app.folevi.com.");
const named = [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon), "extractor.js", "popup.js", "popup.css"];
for (const f of named) if (!all.includes(f)) fail(`${f} is missing from dist/.`);
for (const f of all.filter((f) => f.endsWith(".js"))) {
  const code = await readFile(join(dist, f), "utf8");
  if (/\beval\s*\(|new Function\s*\(/.test(code)) fail(`${f} evaluates code from a string.`);
  if (/\bimport\s*\(\s*["'`]https?:|importScripts\s*\(/.test(code)) fail(`${f} loads code from elsewhere.`);
}

const entries = {};
for (const f of all) entries[f] = [new Uint8Array(await readFile(join(dist, f))), { mtime: new Date("2026-01-01T00:00:00Z") }];
const zip = zipSync(entries, { level: 9 });
await mkdir(join(root, "release"), { recursive: true });
const out = join(root, "release", `folevi-clipper-${pkg.version}.zip`);
await writeFile(out, zip);
console.log(`Packed ${all.length} files into ${relative(root, out)} (${(zip.length / 1024).toFixed(1)} KB)`);
