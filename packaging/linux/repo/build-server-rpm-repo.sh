#!/usr/bin/env bash
# Build a signed rpm (dnf/yum) repository from folevi-server .rpm files.
#   build-server-rpm-repo.sh --rpms <dir> --out <dir> [--channel stable|beta]
# Output (serve <out> at https://pkg.folevi.com/rpm/<channel>, the address install.sh uses):
#   <arch>/*.rpm, <arch>/repodata/repomd.xml(.asc), RPM-GPG-KEY-folevi, folevi.repo
# Needs createrepo_c (Ubuntu: apt install createrepo-c). The packages themselves are signed by nfpm when
# FOLEVI_RPM_SIGNING_KEY_FILE is set (packaging/linux/build.sh); this script signs repomd.xml with
# FOLEVI_REPO_GPG_PRIVATE_KEY (ASCII-armored, from a CI secret, imported into a throwaway GNUPGHOME, never printed).
set -euo pipefail
rpms="" out="" channel="stable"
while [ $# -gt 0 ]; do
  case "$1" in --rpms) rpms="$2"; shift 2 ;; --out) out="$2"; shift 2 ;; --channel) channel="$2"; shift 2 ;; *) echo "unknown flag $1" >&2; exit 2 ;; esac
done
[ -d "$rpms" ] && [ -n "$out" ] || { echo "usage: $0 --rpms <dir> --out <dir>" >&2; exit 2; }
mkdir -p "$out"; out="$(cd "$out" && pwd)"
CREATEREPO="$(command -v createrepo_c || command -v createrepo || true)"
[ -n "$CREATEREPO" ] || { echo "createrepo_c missing (apt install createrepo-c)" >&2; exit 1; }

for f in "$rpms"/*.rpm; do
  case "$f" in *.x86_64.rpm) a=x86_64 ;; *.aarch64.rpm) a=aarch64 ;; *) continue ;; esac
  mkdir -p "$out/$a"; cp "$f" "$out/$a/"
done
for a in x86_64 aarch64; do
  [ -d "$out/$a" ] || continue
  "$CREATEREPO" --update "$out/$a" >/dev/null
done

cat > "$out/folevi.repo" <<REPO
[folevi]
name=Folevi Server
baseurl=https://pkg.folevi.com/rpm/$channel/\$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=https://pkg.folevi.com/rpm/$channel/RPM-GPG-KEY-folevi
REPO

if [ -n "${FOLEVI_REPO_GPG_PRIVATE_KEY:-}" ]; then
  GNUPGHOME="$(mktemp -d)"; export GNUPGHOME; chmod 700 "$GNUPGHOME"
  trap 'gpgconf --kill gpg-agent >/dev/null 2>&1 || true; rm -rf "$GNUPGHOME"' EXIT
  printf '%s\n' "$FOLEVI_REPO_GPG_PRIVATE_KEY" | gpg --batch --quiet --import 2>/dev/null
  keyid="$(gpg --batch --list-secret-keys --with-colons | awk -F: '/^sec/{print $5; exit}')"
  for a in x86_64 aarch64; do
    [ -f "$out/$a/repodata/repomd.xml" ] || continue
    gpg --batch --yes --pinentry-mode loopback --passphrase "${FOLEVI_REPO_GPG_PASSPHRASE:-}" -u "$keyid" \
      --detach-sign --armor -o "$out/$a/repodata/repomd.xml.asc" "$out/$a/repodata/repomd.xml"
  done
  gpg --batch --armor --export "$keyid" > "$out/RPM-GPG-KEY-folevi"
  echo "rpm repository signed (key $keyid) in $out"
else
  echo "WARNING: FOLEVI_REPO_GPG_PRIVATE_KEY is not set; repomd.xml is UNSIGNED (tests only)." >&2
fi
