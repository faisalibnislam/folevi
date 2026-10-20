// electron-builder with one of the app's configs (electron-builder.yml, electron-builder.dist.yml) and two
// overrides a release needs: the interface built into the app comes from the production export (not the
// development one in web/), and the build can go to another folder (a dry run).
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(join(root, "package.json"));
const builder = require("electron-builder");
const yaml = createRequire(require.resolve("electron-builder"))("js-yaml");

/**
 * electron-builder's options for the config file with `web` (the export shipped as Resources/web) and the
 * output folder replaced. electron-builder loads the file named by `extends` and lays these over it (an array
 * replaces the file's, an object merges into it).
 */
export function releaseConfig({ config = "electron-builder.yml", web, output }) {
  const base = yaml.load(readFileSync(join(root, config), "utf8"));
  const extraResources = (base.extraResources ?? []).map((r) => (r && typeof r === "object" && r.to === "web" ? { ...r, from: web } : r));
  if (!extraResources.some((r) => r && typeof r === "object" && r.to === "web")) throw new Error(`${config} doesn't ship the interface as Resources/web`);
  // The whole config, never laid over the file: electron-builder joins arrays with the file it finds in the
  // project, which would ship both exports (the development one landing on top). buildMac writes this to a
  // file of its own and points electron-builder at it alone.
  return { ...base, extraResources, ...(output ? { directories: { ...(base.directories ?? {}), output } } : {}) };
}

/** The release's config as a file in the project (a path makes electron-builder read only that file). */
function configFile(cfg) {
  const file = join(root, ".release-config.json");
  writeFileSync(file, JSON.stringify(cfg, null, 2));
  return file;
}

/** Builds the Mac app (electron-builder's programmatic API). */
export async function buildMac({ config, web, output, targets = ["dir"], arch = "arm64", universal = false }) {
  if (!existsSync(join(web, "index.html"))) throw new Error(`No interface export at ${web}`);
  const { Platform, Arch } = builder;
  const archs = universal ? [Arch.universal] : [Arch[arch]];
  return await builder.build({
    projectDir: root,
    targets: Platform.MAC.createTarget(targets, ...archs),
    config: configFile(releaseConfig({ config, web, output })),
    publish: "never",
  });
}
