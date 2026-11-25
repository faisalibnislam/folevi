#!/usr/bin/env bash
# Writes latest.json, the download manifest for Folevi Server, from the built package files.
#
#   packaging/manifest/make-latest.sh --version 1.6.0 --out latest.json [--channel beta] [--released-at ISO]
#                                     [--base-url URL] <package files or folders>...
#
# Folders are searched for .spk .qpkg .apk .tpk .upk .deb .rpm and the Unraid .txz / .tar.xz files (folevi.plg is
# not a file entry: it is unraidPluginUrl). Each file becomes {platform, arch, name, url, sha256, sizeBytes}, url
# being baseUrl + name. A name seen twice (the same package in two folders) must have the same SHA-256.
# Defaults: --channel beta, --released-at now (UTC), --base-url https://folevi.com/download/server/<version>/.
# The files are uploaded later, by hand, to R2 (folevi-updates: server/<version>/<name> and server/latest.json);
# this script uploads nothing.
set -euo pipefail
version="" out="" channel=beta released="" base=""
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --version) version="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --channel) channel="$2"; shift 2 ;;
    --released-at) released="$2"; shift 2 ;;
    --base-url) base="$2"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    -*) echo "make-latest: unknown option $1" >&2; exit 2 ;;
    *) args+=("$1"); shift ;;
  esac
done
[ -n "$version" ] && [ -n "$out" ] && [ ${#args[@]} -gt 0 ] || { sed -n '2,14p' "$0" >&2; exit 2; }
case "$version" in *[!0-9A-Za-z.+-]*|"") echo "make-latest: odd version $version" >&2; exit 2 ;; esac
case "$channel" in stable|beta) ;; *) echo "make-latest: --channel must be stable or beta" >&2; exit 2 ;; esac
[ -n "$released" ] || released="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
[ -n "$base" ] || base="https://folevi.com/download/server/$version/"
case "$base" in https://*/) ;; *) echo "make-latest: --base-url must be https:// and end with /" >&2; exit 2 ;; esac

exec python3 -I - "$version" "$out" "$channel" "$released" "$base" "${args[@]}" <<'PY'
import hashlib, json, os, re, sys

version, out, channel, released, base, *inputs = sys.argv[1:]

def platform_of(name):
    n = name.lower()
    for ext, plat in ((".spk", "synology"), (".qpkg", "qnap"), (".apk", "asustor"), (".tpk", "terramaster"),
                      (".upk", "ugreen"), (".deb", "deb"), (".rpm", "rpm")):
        if n.endswith(ext):
            return plat
    # Unraid: the plugin package and the server archive (folevi-plugin-*.txz, folevi-server-*.tar.xz).
    if n.endswith(".txz") or (n.endswith(".tar.xz") and n.startswith("folevi-server-")):
        return "unraid"
    return None

def arch_of(name):
    n = name.lower()
    if re.search(r"(x86[_-]64|amd64|x64)", n):
        return "x86_64"
    if re.search(r"(aarch64|arm64|armv8|arm_64)", n):
        return "aarch64"
    return None

files = []
for i in inputs:
    if os.path.isdir(i):
        for root, _, names in os.walk(i):
            files += [os.path.join(root, n) for n in names]
    elif os.path.isfile(i):
        files.append(i)
    else:
        sys.exit(f"make-latest: not found: {i}")

entries = {}
for f in sorted(files):
    name = os.path.basename(f)
    plat = platform_of(name)
    if plat is None:
        continue
    if plat == "unraid" and name.startswith("folevi-server-") and name.endswith(".tar.xz") and "unraid" not in f.split(os.sep):
        continue  # a bundle tarball outside the Unraid output is not a download
    arch = arch_of(name)
    if arch is None:
        sys.exit(f"make-latest: cannot tell the chip of {name}")
    if version not in name:
        sys.exit(f"make-latest: {name} does not carry version {version}")
    h = hashlib.sha256()
    with open(f, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    e = {"platform": plat, "arch": arch, "name": name, "url": base + name, "sha256": h.hexdigest(),
         "sizeBytes": os.path.getsize(f)}
    if name in entries:
        if entries[name]["sha256"] != e["sha256"]:
            sys.exit(f"make-latest: two different files named {name}")
        continue
    entries[name] = e

if not entries:
    sys.exit("make-latest: no package files found")
order = ["synology", "qnap", "asustor", "terramaster", "ugreen", "unraid", "deb", "rpm"]
listed = sorted(entries.values(), key=lambda e: (order.index(e["platform"]), e["arch"], e["name"]))
doc = {
    "version": version,
    "releasedAt": released,
    "channel": channel,
    "notesUrl": "https://folevi.com/changelog",
    "baseUrl": base,
    "files": listed,
    "unraidPluginUrl": "https://folevi.com/download/server/folevi.plg",
    "installScript": "https://get.folevi.com/server",
    "dockerImage": f"ghcr.io/folevi/folevi-server:{version}",
}
with open(out, "w") as fh:
    json.dump(doc, fh, indent=2)
    fh.write("\n")
print(f"make-latest: wrote {out} ({len(listed)} files)", file=sys.stderr)
PY
