#!/usr/bin/env node
// Builds Folevi for Windows on any computer (this Mac included: electron-builder cross-builds Windows targets),
// one native build per architecture, never one run under emulation:
//   release/arm64/Folevi-Setup-<version>-arm64.exe  Folevi-<version>-arm64.zip  latest.yml   (Windows on ARM)
//   release/x64/Folevi-Setup-<version>-x64.exe      Folevi-<version>-x64.zip    latest.yml   (Intel and AMD)
// Each folder is what https://folevi.com/download/windows/<arch>/ would hold. Nothing is signed (the owner's
// choice for now) and nothing is uploaded: publishing is a separate step the owner approves.
//
//   node scripts/dist.mjs                 both architectures, with the interface in web/ (must be a production export)
//   node scripts/dist.mjs --arch arm64    one architecture
//   node scripts/dist.mjs --dev-shell     allows a development export (a test build against the dev backend)
//   node scripts/dist.mjs --dir           unpacked folders only (release/<arch>/win-*-unpacked), quicker
// Make the export first: node ../web/scripts/build-shell.mjs --platform windows --production --required
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};
const require = createRequire(join(root, "package.json"));
const builder = require("electron-builder");
const yaml = createRequire(require.resolve("electron-builder"))("js-yaml");

/** The architectures asked for (both unless --arch names one). */
export function archsFrom(value) {
  if (value === null || value === undefined) return ["arm64", "x64"];
  if (value !== "arm64" && value !== "x64") throw new Error(`dist: --arch is arm64 or x64, not ${value}`);
  return [value];
}

/** Problems with the export in web/ for a build that people will install (empty when it's fine). */
export function exportProblems(webDir, o = {}) {
  if (!existsSync(join(webDir, "index.html"))) return [`no interface in ${webDir} (run build-shell.mjs --platform windows --production)`];
  let info = null;
  try {
    info = JSON.parse(readFileSync(join(webDir, "shell/build.json"), "utf8"));
  } catch {
    return ["web/shell/build.json is missing or unreadable"];
  }
  const problems = [];
  if (info.platform !== "windows") problems.push(`the export is for ${info.platform}, not windows`);
  if (!o.devShell && info.target !== "production") problems.push("the export is a development build (pass --dev-shell to allow it)");
  if (o.version && info.appVersion !== o.version) problems.push(`the export was built for ${info.appVersion}, the app is ${o.version}`);
  return problems;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

async function main() {
  run(process.execPath, ["scripts/version.mjs"]);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const problems = exportProblems(join(root, "web"), { devShell: argv.includes("--dev-shell"), version: pkg.foleviVersion });
  if (problems.length) throw new Error(`dist: ${problems.join("; ")}`);
  rmSync(join(root, "dist"), { recursive: true, force: true });
  run(join(root, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"]);
  run(process.execPath, ["scripts/cloud-config.mjs"]);
  const base = yaml.load(readFileSync(join(root, "electron-builder.yml"), "utf8"));
  const { Platform, Arch } = builder;
  const targets = argv.includes("--dir") ? ["dir"] : ["nsis", "zip"];
  for (const arch of archsFrom(flag("--arch"))) {
    const output = join(root, "release", arch);
    rmSync(output, { recursive: true, force: true });
    // One architecture a run, each in its own folder: one run with both would make a single installer holding both.
    const config = { ...base, directories: { ...base.directories, output }, win: { ...base.win, target: targets.map((target) => ({ target, arch: [arch] })) } };
    const file = join(root, ".release-config.json");
    writeFileSync(file, JSON.stringify(config, null, 2));
    console.log(`\ndist: Folevi ${pkg.foleviVersion} for Windows ${arch}`);
    await builder.build({ projectDir: root, targets: Platform.WINDOWS.createTarget(targets, Arch[arch]), config: file, publish: "never" });
  }
  rmSync(join(root, ".release-config.json"), { force: true });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("dist.mjs")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
