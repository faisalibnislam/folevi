#!/usr/bin/env bash
# Build every package from a FAKE bundle (tiny placeholders with the real layout) for x86_64 and aarch64, then
# check each package's structure. No real server is built or run. Exit 0 means every check passed.
#   packaging/test/build-all-fake.sh [--keep <dir>]
# Needs: bash, tar, gzip, xz, python3, jq, xmllint, nfpm (go install github.com/goreleaser/nfpm/v2/cmd/nfpm@v2.43.0),
# patchelf (QNAP), a C compiler for the native fake (QNAP private glibc). dpkg-deb is used when present.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../lib/common.sh"
LOG_PREFIX=fake-test
keep=""
[ "${1:-}" = "--keep" ] && keep="$2"
work="${keep:-$(mktemp -d)}"; mkdir -p "$work"
[ -n "$keep" ] || trap 'rm -rf "$work"' EXIT
VERSION=1.5.73
pass=0 fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$*"; }
bad() { fail=$((fail + 1)); printf '  FAIL %s\n' "$*"; }
check() { local d="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$d"; else bad "$d"; fi; }
has() { grep -qx -- "$2" <<< "$1"; }
# Cross-arch fake: compiling an aarch64 ELF needs a cross compiler; use shell placeholders when there is none.
native_for() {
  case "$1" in
    "$(uname -m)") echo --native ;;
    aarch64) command -v aarch64-linux-gnu-gcc >/dev/null && echo --native-cross || true ;;
    *) true ;;
  esac
}

for arch in x86_64 aarch64; do
  echo "== $arch"
  nat="$(native_for "$arch")"
  if [ "$nat" = --native-cross ]; then
    b="$(CC=aarch64-linux-gnu-gcc CXX=aarch64-linux-gnu-g++ "$HERE/make-fake-bundle.sh" "$work/bundles" $VERSION $arch --native)"
  else
    b="$("$HERE/make-fake-bundle.sh" "$work/bundles" $VERSION $arch $nat)"
  fi
  out="$work/out/$arch"
  qnap_opts=()
  if [ -z "$nat" ]; then
    # No runnable ELF for this arch here: QNAP's private glibc step needs real ELF files, so build without it.
    only="synology,asustor,terramaster,ugreen,unraid,linux,docker"
    "$PACKAGING_DIR/build-all.sh" --bundle "$b" --version $VERSION --arch $arch --out "$out" --only "$only" >"$work/log-$arch.txt" 2>&1 \
      && ok "build-all ($only)" || { bad "build-all"; tail -n 30 "$work/log-$arch.txt"; }
    "$PACKAGING_DIR/qnap/build.sh" --bundle "$b" --version $VERSION --arch $arch --out "$out/qnap" --no-private-glibc >>"$work/log-$arch.txt" 2>&1 \
      && ok "qnap build (no private glibc: no $arch ELF here)" || bad "qnap build"
  else
    "$PACKAGING_DIR/build-all.sh" --bundle "$b" --version $VERSION --arch $arch --out "$out" >"$work/log-$arch.txt" 2>&1 \
      && ok "build-all (every format)" || { bad "build-all"; tail -n 30 "$work/log-$arch.txt"; }
  fi

  # Synology
  spk="$(ls "$out"/synology/*.spk 2>/dev/null | head -n 1)"
  if [ -n "$spk" ]; then
    l="$(tar -tf "$spk")"
    for f in INFO package.tgz scripts/start-stop-status scripts/preupgrade scripts/postinst conf/privilege conf/resource \
             WIZARD_UIFILES/install_uifile PACKAGE_ICON.PNG PACKAGE_ICON_256.PNG; do
      has "$l" "$f" && ok "spk has $f" || bad "spk missing $f"
    done
    info="$(tar -xOf "$spk" INFO)"
    for k in package version os_min_ver arch displayname maintainer dsmuidir dsmappname checksum; do
      grep -q "^$k=\"..*\"" <<< "$info" && ok "INFO $k" || bad "INFO $k"
    done
    want=$([ $arch = x86_64 ] && echo x86_64 || echo armv8)
    grep -q "^arch=\".*\b$want\b" <<< "$info" && ok "INFO arch includes $want" || bad "INFO arch $want"
    if [ $arch = aarch64 ]; then grep -q '^arch=".*\brtd1619b\b' <<< "$info" && ok "INFO arch includes rtd1619b (DS223)" || bad "INFO arch rtd1619b"; fi
    grep -q '^os_min_ver="7.2' <<< "$info" && ok "INFO os_min_ver 7.2" || bad "INFO os_min_ver"
    sum="$(tar -xOf "$spk" package.tgz | md5sum | cut -d' ' -f1)"
    grep -q "checksum=\"$sum\"" <<< "$info" && ok "INFO checksum matches package.tgz" || bad "INFO checksum"
    pl="$(tar -xOf "$spk" package.tgz | tar -tz)"
    for f in ./bundle/bin/folevid ./bundle/web/server.js ./ui/config ./ui/images/icon_72.png ./app/folevi.sc; do
      has "$pl" "$f" && ok "package.tgz has $f" || bad "package.tgz missing $f"
    done
    tar -xOf "$spk" conf/resource | jq -e '."data-share".shares[0].name == "{{wizard_shared_folder_name}}"' >/dev/null && ok "resource data-share uses the wizard folder" || bad "resource data-share"
    tar -xOf "$spk" conf/privilege | jq -e '.defaults."run-as" == "package"' >/dev/null && ok "privilege run-as package" || bad "privilege"
    tar -xOf "$spk" WIZARD_UIFILES/install_uifile | jq -e . >/dev/null && ok "install_uifile is JSON" || bad "install_uifile JSON"
    tar -xOf "$spk" package.tgz | tar -xzO ./ui/config | jq -e '.".url"' >/dev/null && ok "ui/config is JSON" || bad "ui/config"
    mkdir -p "$work/src-$arch" && python3 "$PACKAGING_DIR/synology/package-source/generate-index.py" --spks "$out/synology" \
      --base-url https://pkg.folevi.com/synology --out "$work/src-$arch" >/dev/null && jq -e '.packages[0].link' "$work/src-$arch/index.json" >/dev/null \
      && ok "package source index" || bad "package source index"
  else bad "no .spk"; fi

  # QNAP
  q="$(ls "$out"/qnap/*.qpkg 2>/dev/null | head -n 1)"
  if [ -n "$q" ]; then
    tail -c 10 "$q" | grep -q '^QNAPQPKG  $' && ok "qpkg tail flag" || bad "qpkg tail flag"
    sl="$(sed -n 's/^script_len=//p' "$q" | head -n 1)"
    cl="$(dd if="$q" bs="$sl" skip=1 2>/dev/null | tar -xO | tar -tz)"
    for f in ./qinstall.sh ./package_routines ./qpkg.cfg; do has "$cl" "$f" && ok "qpkg control has $f" || bad "qpkg control $f"; done
    cfg="$(dd if="$q" bs="$sl" skip=1 2>/dev/null | tar -xO | tar -xzO ./qpkg.cfg)"
    grep -q "^QPKG_VER=\"$VERSION\"" <<< "$cfg" && ok "qpkg.cfg version" || bad "qpkg.cfg version"
    ctrl_len="$(dd if="$q" bs="$sl" skip=1 2>/dev/null | tar -t >/dev/null; sed -n 's/^offset=\$(\/usr\/bin\/expr \$script_len + \([0-9]*\))$/\1/p' "$q")"
    dl="$(dd if="$q" bs=1 skip=$((sl + ctrl_len)) 2>/dev/null | tar -tz 2>/dev/null || true)"
    has "$dl" "./bundle/bin/folevid" && ok "qpkg data has bundle/bin/folevid" || bad "qpkg data"
    has "$dl" "./folevi.sh" && ok "qpkg data has the service script" || bad "qpkg service script"
    if [ -n "$nat" ]; then
      has "$dl" "./bundle/runtime/lib/libc.so.6" && ok "qpkg has the private glibc" || bad "qpkg private glibc"
    fi
  else bad "no .qpkg"; fi

  # ASUSTOR
  a="$(ls "$out"/asustor/*.apk 2>/dev/null | head -n 1)"
  if [ -n "$a" ]; then
    zl="$(python3 -c "import zipfile,sys; print('\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))" "$a")"
    for f in apkg-version control.tar.gz data.tar.gz; do has "$zl" "$f" && ok "apk has $f" || bad "apk $f"; done
    mkdir -p "$work/apk-$arch"; (cd "$work/apk-$arch" && python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall('.')" "$a")
    cj="$(tar -xzOf "$work/apk-$arch/control.tar.gz" ./config.json)"
    want=$([ $arch = x86_64 ] && echo x86-64 || echo arm64)
    jq -e --arg a "$want" --arg v "$VERSION" '.general.architecture == $a and .general.version == $v' <<< "$cj" >/dev/null && ok "apk config.json arch/version" || bad "apk config.json"
    tar -tzf "$work/apk-$arch/control.tar.gz" | grep -qx './start-stop.sh' && ok "apk start-stop.sh" || bad "apk start-stop.sh"
  else bad "no .apk"; fi

  # TerraMaster and UGREEN (unverified formats: structure only)
  for ext in tpk upk; do
    p="$(ls "$out"/*/*.$ext 2>/dev/null | head -n 1)"
    if [ -n "$p" ]; then
      l="$(tar -tzf "$p")"
      for f in ./manifest.json ./app/folevi.service ./app/bundle/bin/folevid ./scripts/postinst; do has "$l" "$f" && ok "$ext has $f" || bad "$ext $f"; done
      tar -xzOf "$p" ./manifest.json | jq -e . >/dev/null && ok "$ext manifest JSON" || bad "$ext manifest"
    else bad "no .$ext"; fi
  done

  # Unraid (x86_64 only)
  if [ $arch = x86_64 ]; then
    check "folevi.plg is well-formed XML" xmllint --noout "$out/unraid/folevi.plg"
    grep -q "<MD5>$(md5sum "$out"/unraid/folevi-server-*.tar.xz | cut -d' ' -f1)</MD5>" "$out/unraid/folevi.plg" && ok "plg bundle MD5 matches" || bad "plg bundle MD5"
    tar -tJf "$out"/unraid/folevi-plugin-*.txz | grep -q 'usr/local/emhttp/plugins/folevi/Folevi.page' && ok "plugin txz has the settings page" || bad "plugin txz"
    check "CA template is well-formed XML" xmllint --noout "$PACKAGING_DIR/unraid/ca/folevi.xml"
  fi

  # Linux
  deb="$(ls "$out"/linux/*.deb 2>/dev/null | head -n 1)"
  rpm="$(ls "$out"/linux/*.rpm 2>/dev/null | head -n 1)"
  if [ -n "$deb" ]; then
    if command -v dpkg-deb >/dev/null; then
      di="$(dpkg-deb -I "$deb")"
      want=$([ $arch = x86_64 ] && echo amd64 || echo arm64)
      grep -q "Architecture: $want" <<< "$di" && ok "deb Architecture $want" || bad "deb Architecture"
      grep -q "Version: $VERSION-1" <<< "$di" && ok "deb Version" || bad "deb Version"
      for s in postinst preinst prerm postrm; do grep -q " $s " <<< "$di" && ok "deb has $s" || bad "deb $s"; done
      dc="$(dpkg-deb -c "$deb" 2>/dev/null || true)"
      grep -q './opt/folevi/bin/folevid' <<< "$dc" && ok "deb installs /opt/folevi" || bad "deb /opt/folevi"
      grep -q './usr/lib/systemd/system/folevi-server.service' <<< "$dc" && ok "deb installs the systemd unit" || bad "deb unit"
    else ok "deb built (dpkg-deb not installed: contents not checked)"; fi
  else bad "no .deb"; fi
  [ -n "$rpm" ] && [ "$(head -c 4 "$rpm" | od -An -tx1 | tr -d ' \n')" = "edabeedb" ] && ok "rpm lead magic" || bad "rpm"

  # Docker context
  check "docker context has the bundle" test -x "$out/docker/docker-context/bundles/$(deb_arch $arch)/bin/folevid"
  check "docker context has the entrypoint" test -f "$out/docker/docker-context/docker-entrypoint.sh"
done

echo "== repositories"
mkdir -p "$work/debs" "$work/rpms"; cp "$work"/out/*/linux/*.deb "$work/debs/"; cp "$work"/out/*/linux/*.rpm "$work/rpms/"
# A throwaway key made only for this test, in a temp GNUPGHOME that is deleted at once. Never a real key.
export GNUPGHOME="$work/gnupg-test"; mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"
gpg --batch --quiet --passphrase '' --quick-gen-key "Folevi test key (throwaway) <test@invalid>" ed25519 sign 1d 2>/dev/null
testkey="$(gpg --batch --armor --export-secret-keys)"
unset GNUPGHOME
FOLEVI_REPO_GPG_PRIVATE_KEY="$testkey" "$PACKAGING_DIR/linux/repo/build-apt-repo.sh" --debs "$work/debs" --out "$work/apt" >/dev/null 2>&1 \
  && ok "apt repository built" || bad "apt repository"
unset testkey
for a in amd64 arm64; do grep -q '^Package: folevi-server' "$work/apt/dists/stable/main/binary-$a/Packages" && ok "apt Packages $a" || bad "apt Packages $a"; done
if [ -f "$work/apt/dists/stable/InRelease" ] && [ -f "$work/apt/folevi-archive-keyring.gpg" ]; then
  gpgv --keyring "$work/apt/folevi-archive-keyring.gpg" "$work/apt/dists/stable/InRelease" >/dev/null 2>&1 && ok "InRelease signature verifies" || bad "InRelease signature"
else bad "InRelease missing"; fi
rm -rf "$work/gnupg-test"
if command -v createrepo_c >/dev/null; then
  "$PACKAGING_DIR/linux/repo/build-rpm-repo.sh" --rpms "$work/rpms" --out "$work/rpm" >/dev/null 2>&1 && ok "rpm repository" || bad "rpm repository"
else ok "rpm repository skipped (createrepo_c not installed; CI installs it)"; fi

echo "== scripts and templates"
for f in $(grep -rlE '^#!/(usr/)?bin/(env )?(ba)?sh' "$PACKAGING_DIR" --include='*' | grep -v '/icons/'); do
  case "$(head -n 1 "$f")" in *bash*) bash -n "$f" ;; *) sh -n "$f" ;; esac 2>/dev/null && ok "syntax $(basename "$f")" || bad "syntax $f"
done
for f in $(find "$PACKAGING_DIR" \( -name '*.yaml' -o -name '*.yml' \) ! -path '*/truenas/*/templates/docker-compose.yaml'); do
  python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" "$f" && ok "yaml $(basename "$(dirname "$f")")/$(basename "$f")" || bad "yaml $f"
done
python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" "$PACKAGING_DIR/../.github/workflows/server-packages.yml" && ok "workflow yaml" || bad "workflow yaml"
grep -qE '^\s*(push|pull_request|schedule|pull_request_target):' "$PACKAGING_DIR/../.github/workflows/server-packages.yml" && bad "workflow has a non-manual trigger" || ok "workflow is workflow_dispatch only"
if grep -rn $'—' "$PACKAGING_DIR" "$PACKAGING_DIR/../.github/workflows/server-packages.yml" >/dev/null 2>&1; then bad "em dash found"; else ok "no em dashes"; fi

echo "== private glibc (QNAP)"
if [ "$(uname -m)" = x86_64 ] || [ "$(uname -m)" = aarch64 ]; then
  "$HERE/test-private-glibc.sh" --bundle "$work/bundles/folevi-server-$VERSION-linux-$(uname -m)" --arch "$(uname -m)" >"$work/glibc.txt" 2>&1 \
    && ok "private glibc test ($(grep -oE 'container checks passed|chroot checks passed|checks skipped[^)]*' "$work/glibc.txt" | head -n 1))" \
    || { bad "private glibc test"; tail -n 20 "$work/glibc.txt"; }
fi

echo
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ]
