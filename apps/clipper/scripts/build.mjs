// Builds Folevi Web Clipper into dist/: bundles the service worker, the popup and the page extractor with
// esbuild (everything the extension runs is in the package; nothing loads from the network), copies the
// popup's HTML and CSS and the icons, and writes manifest.json with the version from package.json.
//
// FOLEVI_ORIGIN points a development build at a local Folevi (`pnpm build:dev` uses
// http://app.localhost:3002) and adds that origin to host_permissions. Releases (`pnpm package`) always
// build for https://app.folevi.com. CLIPPER_DIST builds somewhere other than dist/ (the web app's
// end-to-end test loads a development build from its own folder).
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = process.env.CLIPPER_DIST ?? join(root, "dist");
const PRODUCTION = "https://app.folevi.com";
const origin = (process.env.FOLEVI_ORIGIN ?? PRODUCTION).replace(/\/$/, "");
if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1|[\w.-]+\.localhost)(:\d+)?$/.test(origin)) throw new Error(`FOLEVI_ORIGIN must be https, or http on a local host: ${origin}`);
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const common = {
  bundle: true,
  target: "chrome116",
  legalComments: "none",
  logLevel: "warning",
  define: { __FOLEVI_ORIGIN__: JSON.stringify(origin), __CLIPPER_VERSION__: JSON.stringify(pkg.version) },
};
await build({ ...common, entryPoints: { background: join(root, "src/background.ts"), popup: join(root, "src/popup/popup.ts") }, outdir: dist, format: "esm" });
await build({ ...common, entryPoints: { extractor: join(root, "src/extractor.ts") }, outdir: dist, format: "iife" });

await cp(join(root, "src/popup/popup.html"), join(dist, "popup.html"));
await cp(join(root, "src/popup/popup.css"), join(dist, "popup.css"));
await cp(join(root, "icons"), join(dist, "icons"), { recursive: true });

const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
manifest.version = pkg.version;
if (origin !== PRODUCTION) {
  manifest.name = `${manifest.name} (development)`;
  manifest.host_permissions = [...manifest.host_permissions, `${origin}/*`];
}
await writeFile(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built Folevi Web Clipper ${pkg.version} for ${origin} in ${dist}`);
