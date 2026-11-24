#!/usr/bin/env bash
# Builds Folevi's rpm repository (Fedora, RHEL/Alma/Rocky 9+, openSUSE) from release .rpm files: each package
# signed, the metadata signed. dnf and zypper read the same repository. Builds locally only: uploading it to
# folevi.com/linux/rpm is a separate step the owner approves (docs/LINUX.md, "Repositories").
#
# Layout:
#   rpm/x86_64/folevi-<version>-1.x86_64.rpm
#   rpm/aarch64/folevi-<version>-1.aarch64.rpm
#   rpm/repodata/repomd.xml{,.asc}
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

for f in "$RPMS"/folevi-*.rpm; do
  case "$f" in
    *x86_64.rpm) cp -n "$f" "$REPO/x86_64/" ;;
    *aarch64.rpm) cp -n "$f" "$REPO/aarch64/" ;;
  esac
done

rpmsign --define "_gpg_name $KEY" --addsign "$REPO"/x86_64/*.rpm "$REPO"/aarch64/*.rpm
createrepo_c --update "$REPO"
gpg --batch --yes --local-user "$KEY" --armor --detach-sign -o "$REPO/repodata/repomd.xml.asc" "$REPO/repodata/repomd.xml"
gpg --batch --yes --armor --export "$KEY" > "$REPO/RPM-GPG-KEY-folevi"
cp "$HERE/folevi.repo" "$REPO/folevi.repo"

echo "rpm repository ready in $REPO (not uploaded)"
