#!/usr/bin/env bash
# Builds Folevi's apt repository (Ubuntu, Debian, Mint, Pop!_OS, elementary) from release .deb files, signed with
# the Folevi Linux signing key. Builds locally only: uploading it to folevi.com/linux/apt is a separate step the
# owner approves (docs/LINUX.md, "Repositories").
#
# Layout (a standard pool/dists repo, one "stable" suite, both architectures):
#   apt/pool/main/f/folevi/folevi_<version>_<arch>.deb
#   apt/dists/stable/{Release,InRelease,Release.gpg}
#   apt/dists/stable/main/binary-{amd64,arm64}/Packages{,.gz}
#   apt/folevi-archive-keyring.gpg      the public key people install
#
# Usage: FOLEVI_REPO_KEY=<gpg key id> packaging/linux/repo/build-apt-repo.sh <dir with .debs> <out dir>
#   Needs apt-utils (apt-ftparchive) and gpg with the private key in the keyring (never in the repo).
#   Earlier versions already in <out dir>/apt/pool stay listed, so people can downgrade.
set -euo pipefail
DEBS="${1:?dir with .deb files}"; OUT="${2:?output dir}"
KEY="${FOLEVI_REPO_KEY:?set FOLEVI_REPO_KEY to the signing key id}"
REPO="$OUT/apt"
mkdir -p "$REPO/pool/main/f/folevi"
cp -n "$DEBS"/folevi_*.deb "$REPO/pool/main/f/folevi/"

cd "$REPO"
for arch in amd64 arm64; do
  mkdir -p "dists/stable/main/binary-$arch"
  apt-ftparchive --arch "$arch" packages pool > "dists/stable/main/binary-$arch/Packages"
  gzip -9fk "dists/stable/main/binary-$arch/Packages"
done

apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=Folevi \
  -o APT::FTPArchive::Release::Label=Folevi \
  -o APT::FTPArchive::Release::Suite=stable \
  -o APT::FTPArchive::Release::Codename=stable \
  -o APT::FTPArchive::Release::Architectures="amd64 arm64" \
  -o APT::FTPArchive::Release::Components=main \
  -o APT::FTPArchive::Release::Description="Folevi for Linux" \
  release dists/stable > dists/stable/Release

gpg --batch --yes --local-user "$KEY" --clearsign -o dists/stable/InRelease dists/stable/Release
gpg --batch --yes --local-user "$KEY" --armor --detach-sign -o dists/stable/Release.gpg dists/stable/Release
gpg --batch --yes --export "$KEY" > folevi-archive-keyring.gpg

echo "apt repository ready in $REPO (not uploaded)"
