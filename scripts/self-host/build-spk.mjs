#!/usr/bin/env node
// Wraps a Folevi Server bundle (build-bundle.mjs) as a Synology DSM 7 package (.spk), following the layout in
// Synology's DSM 7 developer guide. Synology's toolkit isn't needed: an .spk is an uncompressed tar holding
//   INFO, package.tgz (the bundle, installed to /var/packages/folevi-server/target), scripts/, conf/,
//   WIZARD_UIFILES/, PACKAGE_ICON.PNG, PACKAGE_ICON_256.PNG, LICENSE
// The package runs as its own user (conf/privilege), keeps its data in a shared folder chosen in the install
// wizard (conf/resource data-share; default "folevi"), opens port 8810 (port-config), and puts a Folevi Server
// icon in DSM's main menu that opens the setup page.
//
//   node scripts/self-host/build-spk.mjs --bundle <bundle folder> [--out dir]
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]);
    return acc;
  }, []),
);
if (!args.bundle) throw new Error("--bundle <folder> is required");
const BUNDLE = path.resolve(args.bundle);
const info = JSON.parse(fs.readFileSync(path.join(BUNDLE, "bundle.json"), "utf8"));
const OUT_DIR = path.resolve(args.out ?? path.dirname(BUNDLE));
const PKG = "folevi-server";
const PORT = 8810;

// DSM arch names: the generic 64-bit families plus the platform names of current models, so Package Center
// matches every 64-bit model of that chip family.
const ARCHES = {
  x86_64: "x86_64",
  aarch64: "aarch64 armv8 rtd1296 rtd1619b armada37xx",
  "darwin-arm64": "noarch",
};
const arch = ARCHES[info.arch];
if (!arch) throw new Error(`unknown bundle arch ${info.arch}`);
const spkName = `Folevi-Server-${info.version}-${info.arch}.spk`;

const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 26, ...opts });
const work = fs.mkdtempSync(path.join(os.tmpdir(), "folevi-spk-"));
const pkgRoot = path.join(work, "package");
const spkRoot = path.join(work, "spk");
const write = (file, text, mode = 0o644) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode });
};

// --- package.tgz: the bundle, the DSM main-menu entry (ui/) and the port description -------------------
console.log("== package.tgz");
fs.cpSync(BUNDLE, pkgRoot, { recursive: true, verbatimSymlinks: true });
const icon = path.join(ROOT, "apps/web/public/icons/icon-512.png");
const iconAt = (size, dest) => sh("sips", ["-z", String(size), String(size), icon, "--out", dest]);
fs.mkdirSync(path.join(pkgRoot, "ui/images"), { recursive: true });
for (const size of [16, 24, 32, 48, 64, 72, 256]) iconAt(size, path.join(pkgRoot, "ui/images", `folevi-${size}.png`));
write(
  path.join(pkgRoot, "ui/config"),
  `${JSON.stringify(
    {
      ".url": {
        "app.folevi.server": {
          type: "url",
          title: "Folevi Server",
          desc: "Set up your Folevi Server and see how it's doing",
          icon: "images/folevi-{0}.png",
          protocol: "http",
          port: String(PORT),
          url: "/folevi-server/",
          allUsers: false,
          grantPrivilege: "local",
          advanceGrantPrivilege: true,
        },
      },
    },
    null,
    2,
  )}\n`,
);
write(path.join(pkgRoot, "conf", `${PKG}.sc`), `[${PKG}]\ntitle="Folevi Server"\ndesc="Folevi Server (web app and sync)"\nport_forward="yes"\ndst.ports="${PORT}/tcp"\n`);

// No macOS metadata, owned by root, GNU format for the long node_modules paths.
const tarEnv = { ...process.env, COPYFILE_DISABLE: "1" };
const tarFlags = ["--no-xattrs", "--no-mac-metadata", "--no-acls", "--uid", "0", "--gid", "0", "--uname", "root", "--gname", "root"];
fs.mkdirSync(spkRoot, { recursive: true });
sh("tar", ["-czf", path.join(spkRoot, "package.tgz"), ...tarFlags, "--format", "gnutar", "-C", pkgRoot, "."], { env: tarEnv, stdio: "inherit" });
const tgz = path.join(spkRoot, "package.tgz");
const md5 = crypto.createHash("md5").update(fs.readFileSync(tgz)).digest("hex");
const extractSize = Math.ceil(Number(sh("du", ["-sk", pkgRoot]).toString().split("\t")[0]));

// --- INFO --------------------------------------------------------------------------------------------------
const infoLines = {
  package: PKG,
  version: info.version,
  os_min_ver: "7.0-40000",
  displayname: "Folevi Server",
  description: "Your own Folevi notes server on this NAS: the Folevi web app, sync, sharing and nightly backups, with your notes kept in a shared folder you choose. Test build.",
  arch,
  maintainer: "Airly Studio",
  maintainer_url: "https://folevi.com",
  distributor: "Airly Studio",
  distributor_url: "https://folevi.com",
  support_url: "https://folevi.com/support",
  helpurl: "https://folevi.com/docs",
  beta: "yes",
  thirdparty: "yes",
  ctl_stop: "yes",
  startable: "yes",
  adminport: String(PORT),
  adminprotocol: "http",
  adminurl: "/folevi-server/",
  checkport: "yes",
  dsmuidir: "ui",
  dsmappname: "app.folevi.server",
  extractsize: String(extractSize),
  checksum: md5,
  create_time: new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14),
};
write(path.join(spkRoot, "INFO"), `${Object.entries(infoLines).map(([k, v]) => `${k}="${String(v).replace(/"/g, "'")}"`).join("\n")}\n`);

// --- conf/: privilege (its own user, never root) and resource (shared folder, port) --------------------
write(path.join(spkRoot, "conf/privilege"), `${JSON.stringify({ defaults: { "run-as": "package" } }, null, 2)}\n`);
write(
  path.join(spkRoot, "conf/resource"),
  `${JSON.stringify(
    {
      "port-config": { "protocol-file": `conf/${PKG}.sc` },
      "data-share": { shares: [{ name: "{{wizard_shared_folder}}", permission: { rw: [PKG] } }] },
    },
    null,
    2,
  )}\n`,
);

// --- The install wizard: which shared folder ---------------------------------------------------------------
write(
  path.join(spkRoot, "WIZARD_UIFILES/install_uifile"),
  `${JSON.stringify(
    [
      {
        step_title: "Where Folevi keeps its data",
        items: [
          {
            type: "textfield",
            desc: "Folevi Server keeps your notes, files, backups and logs in a shared folder. Type a new name to create it (we suggest folevi), or the name of an empty shared folder you already have. Hyper Backup and snapshots of this folder cover everything.",
            subitems: [
              {
                key: "wizard_shared_folder",
                desc: "Shared folder",
                defaultValue: "folevi",
                validator: { allowBlank: false, regex: { expr: "/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,31}$/", errorText: "Use letters, numbers, spaces, dots, dashes or underscores." } },
              },
            ],
          },
        ],
      },
      {
        step_title: "After installing",
        items: [
          {
            desc: `Folevi Server starts by itself. Open it from the Folevi Server icon in the main menu, or at http://&lt;your NAS address&gt;:${PORT}/folevi-server/. The first start takes a few minutes. Then you name the server and create your account.`,
          },
        ],
      },
    ],
    null,
    2,
  )}\n`,
);

// --- scripts/ -------------------------------------------------------------------------------------------------
const common = `#!/bin/sh
# Folevi Server (scripts/self-host/build-spk.mjs). DSM 7 runs these as the package's own user.
PKG="${PKG}"
VAR="\${SYNOPKG_PKGVAR:-/var/packages/$PKG/var}"
TARGET="\${SYNOPKG_PKGDEST:-/var/packages/$PKG/target}"
`;
const postinst = `${common}
# Remember the shared folder picked in the wizard (the variable is only set during install).
if [ -n "\${wizard_shared_folder:-}" ]; then
  printf '%s' "$wizard_shared_folder" > "$VAR/share_name"
fi
[ -s "$VAR/share_name" ] || printf '%s' folevi > "$VAR/share_name"
exit 0
`;
const noop = `${common}exit 0\n`;
const startStop = `${common}
PID_FILE="$VAR/folevi-server.pid"
OUT="$VAR/folevi-server.out"
SHARE=$(cat "$VAR/share_name" 2>/dev/null || echo folevi)

data_dir() {
  # For testing the scripts off a NAS only.
  [ -n "\${FOLEVI_TEST_DATA:-}" ] && { echo "$FOLEVI_TEST_DATA"; return; }
  # DSM 7 links each data-share folder here (conf/resource).
  d="/var/packages/$PKG/shares/$SHARE"
  [ -d "$d" ] && { (cd "$d" && pwd -P); return; }
  for v in /volume*; do [ -d "$v/$SHARE" ] && { echo "$v/$SHARE"; return; }; done
  return 1
}

running() {
  [ -s "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

case "$1" in
  start)
    running && exit 0
    DATA=$(data_dir) || { echo "Folevi Server can't find its shared folder \\"$SHARE\\"." > "$SYNOPKG_TEMP_LOGFILE" 2>/dev/null; exit 1; }
    mkdir -p "$VAR/tmp"
    [ -f "$OUT" ] && [ "$(wc -c < "$OUT")" -gt 1048576 ] && mv "$OUT" "$OUT.1"
    FOLEVI_DATA="$DATA" FOLEVI_VAR="$VAR" FOLEVI_PORT=${PORT} FOLEVI_BIND=0.0.0.0 \\
      nohup "$TARGET/bin/folevi-server" >> "$OUT" 2>&1 < /dev/null &
    echo $! > "$PID_FILE"
    sleep 2
    running || { echo "Folevi Server stopped right after starting. Open $DATA/logs/launcher.log in File Station to see why." > "$SYNOPKG_TEMP_LOGFILE" 2>/dev/null; exit 1; }
    exit 0
    ;;
  stop)
    if running; then
      PID=$(cat "$PID_FILE")
      kill -TERM "$PID" 2>/dev/null
      i=0
      while kill -0 "$PID" 2>/dev/null && [ $i -lt 25 ]; do sleep 1; i=$((i + 1)); done
      kill -0 "$PID" 2>/dev/null && kill -KILL "$PID" 2>/dev/null
    fi
    rm -f "$PID_FILE"
    exit 0
    ;;
  status)
    running && exit 0
    exit 3
    ;;
  log)
    echo "$OUT"
    exit 0
    ;;
  *)
    exit 1
    ;;
esac
`;
write(path.join(spkRoot, "scripts/postinst"), postinst, 0o755);
write(path.join(spkRoot, "scripts/start-stop-status"), startStop, 0o755);
for (const s of ["preinst", "preuninst", "postuninst", "preupgrade", "postupgrade"]) write(path.join(spkRoot, "scripts", s), noop, 0o755);

// --- Icons and license ----------------------------------------------------------------------------------
iconAt(72, path.join(spkRoot, "PACKAGE_ICON.PNG"));
iconAt(256, path.join(spkRoot, "PACKAGE_ICON_256.PNG"));
write(
  path.join(spkRoot, "LICENSE"),
  `Folevi Server test build ${info.version}. Copyright Airly Studio. For testing by Folevi's owner only.\n\nIt bundles the Convex backend (FSL-1.1-Apache-2.0), Node.js (MIT), and the GNU C Library and GCC runtime\nlibraries from Ubuntu 22.04 (LGPL, GPL with the GCC Runtime Library Exception). Their licenses are in\n/var/packages/${PKG}/target/LICENSES after installing.\n`,
);

// --- The .spk: an uncompressed tar, package.tgz last-ish like the toolkit -----------------------------------
const spk = path.join(OUT_DIR, spkName);
fs.rmSync(spk, { force: true });
const entries = ["INFO", "LICENSE", "PACKAGE_ICON.PNG", "PACKAGE_ICON_256.PNG", "WIZARD_UIFILES", "conf", "scripts", "package.tgz"];
sh("tar", ["-cf", spk, ...tarFlags, "--format", "ustar", "-C", spkRoot, ...entries], { env: tarEnv, stdio: "inherit" });
fs.rmSync(work, { recursive: true, force: true });
const bytes = fs.statSync(spk).size;
console.log(`\n${spk} (${(bytes / 1e6).toFixed(0)} MB, package.tgz md5 ${md5})`);
