#!/usr/bin/env node
// Builds the Folevi Server bundle, folevi-server-<version>-linux-<arch> (docs/SELF_HOSTING_PLAN.md §5.8): one
// self-contained folder that the Synology package (build-spk.mjs), and later the QNAP package and the container,
// wrap. Layout:
//   bin/folevi-server            the launcher (scripts/self-host/server/folevi-server.sh)
//   bin/convex-local-backend     Convex's backend program for this chip
//   node/bin/node                Node.js for this chip
//   lib/cxx/                     Ubuntu 22.04's libstdc++ and libgcc_s, used when the system's are older
//   lib/glibc/                   Ubuntu 22.04's glibc and loader too, used when the system's glibc is older
//   web/                         the web app's standalone server (server edition build)
//   functions/push-request.json.br  Folevi's functions, bundled, ready to push (no npm needed on the server)
//   supervisor/                  supervisor.mjs and pages.mjs
//   bundle.json, LICENSES/
//
//   node scripts/self-host/build-bundle.mjs --arch x86_64|aarch64|darwin-arm64 [--version 0.1.0] [--build 1]
//     [--out dir] [--downloads dir] [--skip-web-build] [--skip-functions]
// darwin-arm64 is for testing on a Mac: this Mac's node and the cached macOS backend, no bundled libraries.
// Downloads (fetched once with the owner's OK, see docs/self-hosting/SYNOLOGY.md) are checked against the
// checksums below before use. Nothing inside them is run here.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]);
    return acc;
  }, []),
);
const ARCH = args.arch ?? "x86_64";
const VERSION = args.version ?? "0.1.0";
const BUILD = Number(args.build ?? 1);
const FULL_VERSION = `${VERSION}-${String(BUILD).padStart(4, "0")}`;
const DOWNLOADS = path.resolve(args.downloads ?? path.join(os.homedir(), "Library/Caches/folevi-server-build/downloads"));
const OUT_PARENT = path.resolve(args.out ?? path.join(os.homedir(), "Library/Caches/folevi-server-build/out"));
const NAME = `folevi-server-${FULL_VERSION}-${ARCH === "darwin-arm64" ? "darwin-arm64" : `linux-${ARCH}`}`;
const OUT = path.join(OUT_PARENT, NAME);

const CONVEX_RELEASE = "precompiled-2026-11-21-cf39368";
const NODE_VERSION = "v24.22.2";
const PINNED = {
  "convex/convex-local-backend-x86_64-unknown-linux-gnu.zip": "a7bf39daa91535b93a4c59943bcf5c963c3852b021f02be132145500904b5f1d",
  "convex/convex-local-backend-aarch64-unknown-linux-gnu.zip": "309cab736b37e5af742cf002732d920d453681cc721934c31ff0962a0806a1d7",
  "convex/LICENSE.md": "563cea54ba1ad9d2a1b36f4a62b1ebdc3e1dcfb8776a7afee06c99aad5294588",
  "node/node-v24.22.2-linux-x64.tar.xz": "48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75",
  "node/node-v24.22.2-linux-arm64.tar.xz": "eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8",
  "ubuntu/debs/libc6_2.35-0ubuntu3.18_amd64.deb": "cbed4dfa159019c759edae73ece1af67817e163686ad8925a26c90849ba1660a",
  "ubuntu/debs/libstdc++6_12.3.0-1ubuntu1~22.04.3_amd64.deb": "29ef3d289b272704b75141906c8f683db0f2bdb0942061366691333bfb289bdc",
  "ubuntu/debs/libgcc-s1_12.3.0-1ubuntu1~22.04.3_amd64.deb": "d383e642d83263147f7b4b69fb92cf1036e5246c6be3accf10b77f986684589a",
  "ubuntu/debs/libc6_2.35-0ubuntu3.18_arm64.deb": "552390697756c005f8eff39b03392b2d8c6e148420c3e237d779fb44e54b5e72",
  "ubuntu/debs/libstdc++6_12.3.0-1ubuntu1~22.04.3_arm64.deb": "59d244119e6129c7e9c0897491c0e210e925d15881b2dedcf8965ceb4fbf1aa3",
  "ubuntu/debs/libgcc-s1_12.3.0-1ubuntu1~22.04.3_arm64.deb": "46626e1af6b159061e055f843654ee1f0f1e65fa280331ed47ee76ba1b1f6045",
};

const sh = (cmd, cmdArgs, opts = {}) => execFileSync(cmd, cmdArgs, { stdio: [opts.input ? "pipe" : "ignore", "pipe", "inherit"], maxBuffer: 1 << 28, ...opts });
const step = (m) => console.log(`\n== ${m}`);

function verified(rel) {
  const file = path.join(DOWNLOADS, rel);
  if (!fs.existsSync(file)) throw new Error(`missing download ${file}`);
  const sum = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (sum !== PINNED[rel]) throw new Error(`checksum mismatch for ${rel}: ${sum}`);
  return file;
}

/** Follows symlinks inside an unpacked package folder (an absolute link points into that folder, not this Mac). */
function realIn(root, p) {
  for (let i = 0; i < 20; i++) {
    const st = fs.lstatSync(p);
    if (!st.isSymbolicLink()) return p;
    const t = fs.readlinkSync(p);
    p = path.isAbsolute(t) ? path.join(root, t) : path.join(path.dirname(p), t);
    if (!path.resolve(p).startsWith(path.resolve(root))) throw new Error(`link outside the package: ${t}`);
  }
  throw new Error(`too many links: ${p}`);
}

/** A fresh, empty folder for unpacking one download (never run anything from it). */
function scratch(name) {
  const dir = path.join(OUT_PARENT, ".unpack", `${NAME}-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const linuxArch = { x86_64: { node: "x64", deb: "amd64", triplet: "x86_64-linux-gnu", loader: "ld-linux-x86-64.so.2" }, aarch64: { node: "arm64", deb: "arm64", triplet: "aarch64-linux-gnu", loader: "ld-linux-aarch64.so.1" } }[ARCH];
if (!linuxArch && ARCH !== "darwin-arm64") throw new Error(`unknown --arch ${ARCH}`);

fs.rmSync(OUT, { recursive: true, force: true });
for (const d of ["bin", "node/bin", "lib/cxx", "lib/glibc", "functions", "supervisor", "LICENSES"]) fs.mkdirSync(path.join(OUT, d), { recursive: true });

// --- The web app (server edition, standalone) -----------------------------------------------------------
const webDir = path.join(ROOT, "apps/web");
const distDir = ".next-server";
if (!args["skip-web-build"]) {
  step("building the web app (server edition)");
  // next build rewrites next-env.d.ts for the other build folder; put it back afterwards.
  const nextEnv = path.join(webDir, "next-env.d.ts");
  const nextEnvBefore = fs.readFileSync(nextEnv, "utf8");
  process.on("exit", () => fs.writeFileSync(nextEnv, nextEnvBefore));
  sh("npx", ["turbo", "run", "build", "--filter=./apps/web"], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_FOLEVI_EDITION: "server",
      // Only server-side code uses these (src/lib/serverEdition.ts); the browser uses its own origin.
      NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:38510",
      NEXT_PUBLIC_CONVEX_SITE_URL: "http://127.0.0.1:38511",
      NEXT_PUBLIC_APP_URL: "http://localhost",
      NEXT_PUBLIC_MARKETING_URL: "http://localhost",
      NEXT_DIST_DIR: distDir,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
}
step("copying the web app");
const standalone = path.join(webDir, distDir, "standalone");
if (!fs.existsSync(path.join(standalone, "apps/web/server.js"))) throw new Error("no standalone build; run without --skip-web-build");
fs.cpSync(standalone, path.join(OUT, "web"), { recursive: true, verbatimSymlinks: true });
fs.cpSync(path.join(webDir, distDir, "static"), path.join(OUT, "web/apps/web", distDir, "static"), { recursive: true });
fs.cpSync(path.join(webDir, "public"), path.join(OUT, "web/apps/web/public"), { recursive: true });
// Native image resizing (sharp) is built for this Mac; leave it out of a Linux bundle (Folevi's pages use plain <img>).
if (ARCH !== "darwin-arm64") {
  const pnpmDir = path.join(OUT, "web/node_modules/.pnpm");
  for (const d of fs.existsSync(pnpmDir) ? fs.readdirSync(pnpmDir) : []) if (/darwin|win32/.test(d)) fs.rmSync(path.join(pnpmDir, d), { recursive: true, force: true });
  const left = sh("find", [path.join(OUT, "web"), "-name", "*.node"]).toString().trim();
  if (left) throw new Error(`native modules left in the web app:\n${left}`);
}
// Build-time .env files must not ship (the server's settings come from the supervisor).
for (const f of sh("find", [path.join(OUT, "web"), "-maxdepth", "3", "-name", ".env*"]).toString().split("\n").filter(Boolean)) fs.rmSync(f, { force: true });

// --- Folevi's functions, as a push request --------------------------------------------------------------
if (!args["skip-functions"]) {
  step("bundling Folevi's functions");
  const tmp = scratch("push");
  const env = { ...process.env, CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:9", CONVEX_SELF_HOSTED_ADMIN_KEY: "__FOLEVI_ADMIN_KEY__" };
  delete env.CONVEX_DEPLOYMENT;
  delete env.CONVEX_DEPLOY_KEY;
  // --write-push-request writes the request and stops before contacting any deployment. Never --prod.
  sh("npx", ["convex", "deploy", "--yes", "--typecheck=disable", "--codegen=disable", "--push-all-modules", "--write-push-request", path.join(tmp, "push-request")], { cwd: ROOT, env, stdio: ["ignore", "ignore", "inherit"] });
  const json = fs.readFileSync(path.join(tmp, "push-request.json"), "utf8");
  const parsed = JSON.parse(json);
  if (parsed.adminKey !== "__FOLEVI_ADMIN_KEY__") throw new Error("unexpected admin key in the push request");
  if (parsed.dryRun !== false || parsed.appDefinition.unchangedModuleHashes.length) throw new Error("unexpected push request");
  fs.writeFileSync(path.join(OUT, "functions/push-request.json.br"), zlib.brotliCompressSync(Buffer.from(json), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }));
  console.log(`${parsed.appDefinition.changedModules.length} modules, components: ${parsed.componentDefinitions.map((c) => c.definitionPath).join(", ")}`);
}

// --- The backend, Node and the libraries ------------------------------------------------------------------
step("adding the backend, Node and libraries");
if (ARCH === "darwin-arm64") {
  const mac = path.join(os.homedir(), ".cache/convex/binaries", CONVEX_RELEASE, "convex-local-backend");
  fs.copyFileSync(mac, path.join(OUT, "bin/convex-local-backend"));
  fs.copyFileSync(process.execPath, path.join(OUT, "node/bin/node"));
} else {
  const zipDir = scratch("convex");
  sh("unzip", ["-q", verified(`convex/convex-local-backend-${ARCH}-unknown-linux-gnu.zip`), "-d", zipDir]);
  fs.copyFileSync(path.join(zipDir, "convex-local-backend"), path.join(OUT, "bin/convex-local-backend"));
  fs.copyFileSync(verified("convex/LICENSE.md"), path.join(OUT, "LICENSES/convex-backend-LICENSE.md"));

  const nodeDir = scratch("node");
  const base = `node-${NODE_VERSION}-linux-${linuxArch.node}`;
  sh("tar", ["-xJf", verified(`node/${base}.tar.xz`), "-C", nodeDir, `${base}/bin/node`, `${base}/LICENSE`]);
  fs.copyFileSync(path.join(nodeDir, base, "bin/node"), path.join(OUT, "node/bin/node"));
  fs.copyFileSync(path.join(nodeDir, base, "LICENSE"), path.join(OUT, "LICENSES/node-LICENSE"));

  for (const pkg of ["libc6_2.35-0ubuntu3.18", "libstdc++6_12.3.0-1ubuntu1~22.04.3", "libgcc-s1_12.3.0-1ubuntu1~22.04.3"]) {
    const deb = verified(`ubuntu/debs/${pkg}_${linuxArch.deb}.deb`);
    const dir = scratch(pkg.split("_")[0]);
    const data = sh("ar", ["p", deb, "data.tar.zst"]);
    const tarball = sh("zstd", ["-dc"], { input: data });
    sh("tar", ["-xf", "-", "-C", dir], { input: tarball });
    // Ubuntu 22.04 ships libraries in both lib/<triplet> and usr/lib/<triplet>.
    const found = [path.join(dir, "lib", linuxArch.triplet), path.join(dir, "usr/lib", linuxArch.triplet)].filter((d) => fs.existsSync(d));
    for (const [from, f] of found.flatMap((d) => fs.readdirSync(d).map((f) => [d, f]))) {
      const src = path.join(from, f);
      if (!/\.so(\.|$)/.test(f)) continue;
      const real = realIn(dir, src);
      if (fs.statSync(real).isDirectory()) continue;
      // libstdc++ and libgcc_s go in both folders; glibc's own libraries only in lib/glibc.
      const targets = pkg.startsWith("libc6") ? ["lib/glibc"] : ["lib/glibc", "lib/cxx"];
      for (const t of targets) fs.copyFileSync(real, path.join(OUT, t, f));
    }
    const loaderSrc = [path.join(dir, "usr/lib", linuxArch.triplet, linuxArch.loader), path.join(dir, "lib", linuxArch.triplet, linuxArch.loader), path.join(dir, "usr/lib64", linuxArch.loader), path.join(dir, "lib64", linuxArch.loader), path.join(dir, "usr/lib", linuxArch.loader), path.join(dir, "lib", linuxArch.loader)].find((p) => fs.lstatSync(p, { throwIfNoEntry: false }));
    if (pkg.startsWith("libc6")) {
      if (!loaderSrc) throw new Error("glibc loader not found in libc6");
      fs.copyFileSync(realIn(dir, loaderSrc), path.join(OUT, "lib/glibc", linuxArch.loader));
      fs.chmodSync(path.join(OUT, "lib/glibc", linuxArch.loader), 0o755);
    }
    const copyright = path.join(dir, "usr/share/doc", pkg.split("_")[0], "copyright");
    if (fs.existsSync(copyright)) fs.copyFileSync(copyright, path.join(OUT, "LICENSES", `${pkg.split("_")[0]}-copyright`));
  }
}
fs.chmodSync(path.join(OUT, "bin/convex-local-backend"), 0o755);
fs.chmodSync(path.join(OUT, "node/bin/node"), 0o755);

// --- The supervisor, launcher and notes -----------------------------------------------------------------
step("adding the supervisor");
for (const f of ["supervisor.mjs", "pages.mjs"]) fs.copyFileSync(path.join(ROOT, "scripts/self-host/server", f), path.join(OUT, "supervisor", f));
fs.writeFileSync(path.join(OUT, "supervisor/package.json"), `${JSON.stringify({ type: "module", private: true }, null, 2)}\n`);
fs.copyFileSync(path.join(ROOT, "scripts/self-host/server/folevi-server.sh"), path.join(OUT, "bin/folevi-server"));
fs.chmodSync(path.join(OUT, "bin/folevi-server"), 0o755);
let commit = "unknown";
try {
  commit = sh("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
} catch {
  // not a git checkout
}
const bundle = { name: "Folevi Server", version: FULL_VERSION, arch: ARCH, builtAt: new Date().toISOString(), commit, convexBackend: CONVEX_RELEASE, node: NODE_VERSION, libraries: ARCH === "darwin-arm64" ? null : "Ubuntu 22.04: glibc 2.35-0ubuntu3.18, libstdc++6 12.3.0-1ubuntu1~22.04.3" };
fs.writeFileSync(path.join(OUT, "bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`);
fs.writeFileSync(
  path.join(OUT, "LICENSES/README.txt"),
  [
    "Folevi Server bundles these programs, each under its own license:",
    "",
    `- Convex backend (${CONVEX_RELEASE}), https://github.com/get-convex/convex-backend, FSL-1.1-Apache-2.0: convex-backend-LICENSE.md`,
    `- Node.js ${NODE_VERSION}, https://nodejs.org: node-LICENSE`,
    "- GNU C Library 2.35 and the GCC 12 runtime (libstdc++, libgcc_s) from Ubuntu 22.04, LGPL and GPL with the GCC",
    "  Runtime Library Exception (libc6-copyright; the GCC runtime's is in Ubuntu's gcc-12-base package). Sources:",
    "  https://launchpad.net/ubuntu/+source/glibc and https://launchpad.net/ubuntu/+source/gcc-12",
    "- The web app's open-source dependencies keep their notices inside web/node_modules.",
    "",
  ].join("\n"),
);

const size = sh("du", ["-sh", OUT]).toString().split("\t")[0];
console.log(`\nBundle ready: ${OUT} (${size})`);
fs.rmSync(path.join(OUT_PARENT, ".unpack"), { recursive: true, force: true });
