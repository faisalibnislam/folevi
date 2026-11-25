#!/usr/bin/env bash
# Uploads the apt and rpm repositories made by build-apt-repo.sh and build-rpm-repo.sh to R2 (bucket folevi-updates,
# prefix linux/), served at https://folevi.com/download/linux/apt and /rpm. ONLY with the owner's OK
# (docs/LINUX.md, "Repositories").
#
# Packages and hashed repodata files never change once uploaded (cached for a year); the indexes that name them
# (Release, InRelease, Packages, repomd.xml and their signatures) are no-cache. Packages go up first and the
# indexes last, so nobody is pointed at a file that isn't there yet.
#
# Usage: packaging/linux/repo/upload-repos.sh <out dir holding apt/ and rpm/> [--dry-run]
# Needs `npx wrangler` logged in to the account that owns folevi-updates.
set -euo pipefail
OUT="$(cd "${1:?out dir}" && pwd)"; DRY="${2:-}"
BUCKET=folevi-updates/linux
IMMUTABLE="public, max-age=31536000, immutable"

type_of() {
  case "$1" in
    *.deb) echo application/vnd.debian.binary-package ;;
    *.rpm) echo application/x-rpm ;;
    *.gz) echo application/gzip ;;
    *.bz2) echo application/x-bzip2 ;;
    *.xml) echo "application/xml" ;;
    *.gpg) echo application/pgp-keys ;;
    *.asc|*/RPM-GPG-KEY-folevi) echo "application/pgp-keys" ;;
    *) echo "text/plain; charset=utf-8" ;;
  esac
}

put() { # <relative path> <cache-control>
  echo "put $BUCKET/$1"
  [[ "$DRY" == "--dry-run" ]] && return
  npx --yes wrangler r2 object put "$BUCKET/$1" --file "$OUT/$1" --content-type "$(type_of "$1")" \
    --cache-control "$2" --remote >/dev/null
}

cd "$OUT"
# 1. Files that never change: packages and hashed repodata.
while IFS= read -r f; do put "$f" "$IMMUTABLE"; done < <(
  find apt/pool rpm -type f \( -name '*.deb' -o -name '*.rpm' -o -path '*/repodata/*-*' \) | sort)
# 2. Keys and the repo files people add, then the indexes, the top-level signed ones last.
for f in $(find apt rpm -maxdepth 1 -type f | sort) \
         $(find apt/dists -type f -name 'Packages*' | sort) \
         $(find rpm -path '*/repodata/repomd.xml' -type f | sort) $(find rpm -path '*/repodata/repomd.xml.asc' -type f | sort) \
         apt/dists/stable/Release apt/dists/stable/Release.gpg apt/dists/stable/InRelease; do
  put "$f" "no-cache"
done
echo "Repositories published at https://folevi.com/download/linux/apt and https://folevi.com/download/linux/rpm"
