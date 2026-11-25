#!/bin/sh
# Folevi Server installer for Linux servers.
#   curl -fsSL https://get.folevi.com/server | sh
# Adds Folevi's signed apt or rpm repository, installs the folevi-server package (a systemd service, no Docker)
# and prints the setup address. Supported: Debian 12+, Ubuntu 22.04+, Fedora 39+, RHEL/Rocky/Alma 9+ on
# x86_64 or aarch64. Safe to run again: it only adds what is missing and then upgrades the package.
#
# Options (environment): FOLEVI_CHANNEL=stable|beta (default stable), FOLEVI_PKG_URL (default
# https://pkg.folevi.com), FOLEVI_DRY_RUN=1 prints the commands instead of running them.
# Everything is inside main(), called on the last line, so a cut-off download runs nothing.
set -eu

main() {
  PKG_URL="${FOLEVI_PKG_URL:-https://pkg.folevi.com}"
  CHANNEL="${FOLEVI_CHANNEL:-stable}"
  case "$CHANNEL" in stable|beta) ;; *) fail "FOLEVI_CHANNEL must be stable or beta" ;; esac

  say "Folevi Server installer"
  [ "$(uname -s)" = "Linux" ] || fail "this installer is for Linux. On a NAS, use the NAS's app store instead."
  case "$(uname -m)" in
    x86_64|amd64) ARCH=x86_64 ;;
    aarch64|arm64) ARCH=aarch64 ;;
    *) fail "Folevi Server needs a 64-bit x86 or ARM machine (found $(uname -m))." ;;
  esac
  [ -d /run/systemd/system ] || fail "Folevi Server needs systemd, which is not running here."
  [ -r /etc/os-release ] || fail "cannot tell which Linux this is (/etc/os-release is missing)."
  # shellcheck disable=SC1091
  . /etc/os-release

  SUDO=""
  if [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null 2>&1 || fail "run this as root, or install sudo."
    SUDO="sudo"
  fi
  command -v curl >/dev/null 2>&1 || fail "curl is needed."

  mem_kb="$(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  if [ "${mem_kb:-0}" -lt 1800000 ]; then
    warn "this machine has less than 2 GB of memory. Folevi Server needs about 1 GB free; add swap on a 1 GB server."
  fi

  id_like=" ${ID:-} ${ID_LIKE:-} "
  case "$id_like" in
    *" debian "*|*" ubuntu "*) install_apt ;;
    *" fedora "*|*" rhel "*|*" centos "*) install_rpm ;;
    *) fail "${PRETTY_NAME:-this Linux} is not supported yet. Use Debian 12+, Ubuntu 22.04+, Fedora or RHEL 9+." ;;
  esac

  run $SUDO systemctl enable --now folevi-server.service
  say ""
  say "Folevi Server is installed and running."
  url=""
  i=0
  while [ $i -lt 30 ] && [ -z "$url" ]; do
    url="$($SUDO runuser -u folevi -- /opt/folevi/bin/folevid setup-url --data /var/lib/folevi --bundle /opt/folevi 2>/dev/null || true)"
    [ -n "$url" ] || sleep 2
    i=$((i + 1))
  done
  if [ -n "$url" ]; then
    say "Open this address in your browser to finish setting it up:"
    say "  $url"
  else
    say "Get the setup address with:"
    say "  sudo runuser -u folevi -- /opt/folevi/bin/folevid setup-url --data /var/lib/folevi --bundle /opt/folevi"
  fi
  say "If this server has a firewall, allow TCP port 8460 (or 80 and 443 for a public server)."
}

install_apt() {
  case "${ID:-}" in
    debian) [ "${VERSION_ID%%.*}" -ge 12 ] 2>/dev/null || fail "Debian 12 or newer is needed." ;;
    ubuntu) [ "${VERSION_ID%%.*}" -ge 22 ] 2>/dev/null || fail "Ubuntu 22.04 or newer is needed." ;;
  esac
  keyring=/usr/share/keyrings/folevi-archive-keyring.gpg
  tmp="$(mktemp)"
  run curl -fsSL "$PKG_URL/apt/folevi-archive-keyring.gpg" -o "$tmp"
  run $SUDO install -m 0644 "$tmp" "$keyring"
  rm -f "$tmp"
  line="deb [signed-by=$keyring] $PKG_URL/apt $CHANNEL main"
  if [ "${FOLEVI_DRY_RUN:-}" = "1" ]; then
    say "+ write /etc/apt/sources.list.d/folevi.list: $line"
  else
    echo "$line" | $SUDO tee /etc/apt/sources.list.d/folevi.list >/dev/null
  fi
  run $SUDO apt-get update -o Dir::Etc::sourcelist=sources.list.d/folevi.list -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0
  run $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y folevi-server
}

install_rpm() {
  ver="${VERSION_ID%%.*}"
  case "${ID:-}" in
    fedora) ;;
    *) [ "$ver" -ge 9 ] 2>/dev/null || fail "RHEL 9 (or Rocky, Alma 9) or newer is needed." ;;
  esac
  repo="[folevi]
name=Folevi Server
baseurl=$PKG_URL/rpm/$CHANNEL/\$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=$PKG_URL/rpm/$CHANNEL/RPM-GPG-KEY-folevi"
  if [ "${FOLEVI_DRY_RUN:-}" = "1" ]; then
    say "+ write /etc/yum.repos.d/folevi.repo"
  else
    printf '%s\n' "$repo" | $SUDO tee /etc/yum.repos.d/folevi.repo >/dev/null
  fi
  if command -v dnf >/dev/null 2>&1; then run $SUDO dnf install -y folevi-server
  else run $SUDO yum install -y folevi-server; fi
}

run() {
  if [ "${FOLEVI_DRY_RUN:-}" = "1" ]; then say "+ $*"; else "$@"; fi
}
say() { printf '%s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
fail() { printf 'Folevi Server installer: %s\n' "$*" >&2; exit 1; }

main "$@"
