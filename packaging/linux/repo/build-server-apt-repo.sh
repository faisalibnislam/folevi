#!/usr/bin/env bash
# Build a signed apt repository from folevi-server .deb files.
#   build-server-apt-repo.sh --debs <dir> --out <dir> [--suite stable] [--component main]
# Output layout (serve <out> at https://pkg.folevi.com/apt):
#   pool/main/f/folevi-server/*.deb
#   dists/<suite>/{Release,InRelease,Release.gpg}
#   dists/<suite>/main/binary-{amd64,arm64}/Packages{,.gz}
#   folevi-archive-keyring.gpg   (public key, binary, for /usr/share/keyrings)
# Signing: FOLEVI_REPO_GPG_PRIVATE_KEY holds an ASCII-armored private key (from a CI secret), optional
# FOLEVI_REPO_GPG_PASSPHRASE. The key goes into a throwaway GNUPGHOME that is deleted on exit. It is never
# printed. Without a key the repository is built unsigned (for tests) and the script says so.
set -euo pipefail
debs="" out="" suite="stable" component="main"
while [ $# -gt 0 ]; do
  case "$1" in
    --debs) debs="$2"; shift 2 ;; --out) out="$2"; shift 2 ;;
    --suite) suite="$2"; shift 2 ;; --component) component="$2"; shift 2 ;;
    *) echo "unknown flag $1" >&2; exit 2 ;;
  esac
done
[ -d "$debs" ] && [ -n "$out" ] || { echo "usage: $0 --debs <dir> --out <dir>" >&2; exit 2; }
command -v dpkg-scanpackages >/dev/null || { echo "dpkg-scanpackages missing (apt install dpkg-dev)" >&2; exit 1; }
mkdir -p "$out"; out="$(cd "$out" && pwd)"
pool="pool/$component/f/folevi-server"
mkdir -p "$out/$pool"
cp "$debs"/*.deb "$out/$pool/"

archs=()
cd "$out"
for a in amd64 arm64; do
  d="dists/$suite/$component/binary-$a"
  mkdir -p "$d"
  dpkg-scanpackages --multiversion --arch "$a" pool /dev/null > "$d/Packages" 2>/dev/null
  gzip -9nkf "$d/Packages"
  [ -s "$d/Packages" ] && archs+=("$a")
done

# Release file with MD5Sum and SHA256 over every index (what apt-ftparchive would write).
python3 - "$out/dists/$suite" "$suite" "$component" <<'PY'
import hashlib, os, sys, email.utils, time
root, suite, comp = sys.argv[1], sys.argv[2], sys.argv[3]
files = []
for dp, _, fns in os.walk(root):
    for fn in sorted(fns):
        if fn in ("Release", "InRelease", "Release.gpg"):
            continue
        p = os.path.join(dp, fn)
        files.append((os.path.relpath(p, root), open(p, "rb").read()))
files.sort()
date = email.utils.formatdate(int(os.environ.get("SOURCE_DATE_EPOCH", time.time())), usegmt=True)
lines = ["Origin: Folevi", "Label: Folevi", f"Suite: {suite}", f"Codename: {suite}", f"Date: {date}",
         "Architectures: amd64 arm64", f"Components: {comp}", "Description: Folevi Server packages",
         "Acquire-By-Hash: no"]
for name, algo in (("MD5Sum", hashlib.md5), ("SHA256", hashlib.sha256)):
    lines.append(f"{name}:")
    for rel, data in files:
        lines.append(f" {algo(data).hexdigest()} {len(data):>16} {rel}")
open(os.path.join(root, "Release"), "w").write("\n".join(lines) + "\n")
PY

if [ -n "${FOLEVI_REPO_GPG_PRIVATE_KEY:-}" ]; then
  GNUPGHOME="$(mktemp -d)"; export GNUPGHOME; chmod 700 "$GNUPGHOME"
  trap 'gpgconf --kill gpg-agent >/dev/null 2>&1 || true; rm -rf "$GNUPGHOME"' EXIT
  printf '%s\n' "$FOLEVI_REPO_GPG_PRIVATE_KEY" | gpg --batch --quiet --import 2>/dev/null
  keyid="$(gpg --batch --list-secret-keys --with-colons | awk -F: '/^sec/{print $5; exit}')"
  pass=(--pinentry-mode loopback --passphrase "${FOLEVI_REPO_GPG_PASSPHRASE:-}")
  gpg --batch --yes "${pass[@]}" -u "$keyid" --clearsign -o "dists/$suite/InRelease" "dists/$suite/Release"
  gpg --batch --yes "${pass[@]}" -u "$keyid" -abs -o "dists/$suite/Release.gpg" "dists/$suite/Release"
  gpg --batch --export "$keyid" > folevi-archive-keyring.gpg
  gpg --batch --armor --export "$keyid" > folevi-archive-keyring.asc
  echo "apt repository signed (key $keyid) in $out"
else
  echo "WARNING: FOLEVI_REPO_GPG_PRIVATE_KEY is not set; the apt repository is UNSIGNED (tests only)." >&2
fi
echo "apt repository: $out (architectures: ${archs[*]:-none})"
