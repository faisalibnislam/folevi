#!/usr/bin/env bash
# Builds Folevi's rpm repository (Fedora, RHEL/Alma/Rocky 9+, openSUSE) from release .rpm files: each package
# signed, the metadata signed. dnf and zypper read the same repository. Builds locally only: uploading it to
# folevi.com/download/linux/rpm is a separate step the owner approves (docs/LINUX.md, "Repositories").
#
# Layout:
#   rpm/x86_64/folevi-<version>-1.x86_64.rpm
#   rpm/aarch64/folevi-<version>-1.aarch64.rpm
#   rpm/<arch>/repodata/repomd.xml{,.asc}
#   rpm/folevi.repo          what people drop into /etc/yum.repos.d/ (dnf) or /etc/zypp/repos.d/ (zypper)
#   rpm/RPM-GPG-KEY-folevi   the public key
#
# Usage: FOLEVI_REPO_KEY=<gpg key id> packaging/linux/repo/build-rpm-repo.sh <dir with .rpms> <out dir>
#   Needs createrepo_c, rpm-sign (rpmsign) and gpg with the private key (never in the repo).
set -euo pipefail
RPMS="${1:?dir with .rpm files}"; OUT="${2:?output dir}"
KEY="${FOLEVI_REPO_KEY:?set FOLEVI_REPO_KEY to the signing key id}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$OUT/rpm"
mkdir -p "$REPO/x86_64" "$REPO/aarch64"

# Release files are named Folevi-<v>-1.<arch>.rpm; the repository uses the package's own name. Only new files are
# signed (a package already in the repository keeps its signature).
shopt -s nullglob nocaseglob
NEW=()
for f in "$RPMS"/folevi-*.rpm; do
  name="$(rpm -qp --qf '%{NAME}-%{VERSION}-%{RELEASE}.%{ARCH}.rpm' "$f" 2>/dev/null)"
  arch="$(rpm -qp --qf '%{ARCH}' "$f" 2>/dev/null)"
  case "$arch" in x86_64|aarch64) ;; *) continue ;; esac
  [[ -e "$REPO/$arch/$name" ]] && continue
  cp "$f" "$REPO/$arch/$name"; NEW+=("$REPO/$arch/$name")
done
shopt -u nocaseglob

if (( ${#NEW[@]} )); then rpmsign --define "_gpg_name $KEY" --define "__gpg $(command -v gpg)" --addsign "${NEW[@]}"; fi
# One repository per architecture (folevi.repo's baseurl ends in $basearch).
for arch in x86_64 aarch64; do
  createrepo_c --update "$REPO/$arch"
  gpg --batch --yes --local-user "$KEY" --armor --detach-sign -o "$REPO/$arch/repodata/repomd.xml.asc" "$REPO/$arch/repodata/repomd.xml"
done
gpg --batch --yes --armor --export "$KEY" > "$REPO/RPM-GPG-KEY-folevi"
cp "$HERE/folevi.repo" "$REPO/folevi.repo"

echo "rpm repository ready in $REPO (not uploaded)"
