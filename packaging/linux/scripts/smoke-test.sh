#!/usr/bin/env bash
# A headless smoke test of a Folevi for Linux build: starts it on a virtual X display (Xvfb) with its own D-Bus
# session and an unlocked test keyring, waits for the window, sends it a folevi:// link the way the desktop
# would, and saves a screenshot. It never touches anyone's real Folevi data: HOME points at a throwaway folder.
#
# Usage: packaging/linux/scripts/smoke-test.sh <folevi binary or .AppImage> <out dir> [--dark]
#   --dark   sets the desktop's color scheme to dark through the portal (checks "System" appearance).
# Needs: install-build-deps.sh --test-tools.
set -euo pipefail
BIN="$(readlink -f "${1:?binary}")"; OUT="$(mkdir -p "${2:?out dir}" && cd "$2" && pwd)"; DARK="${3:-}"
SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
export HOME="$SANDBOX/home" XDG_CONFIG_HOME="$SANDBOX/home/.config" XDG_DATA_HOME="$SANDBOX/home/.local/share"
export XDG_RUNTIME_DIR="$SANDBOX/run" APPIMAGE_EXTRACT_AND_RUN=1 NO_AT_BRIDGE=1
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"

run() {
  # A test keyring, unlocked with an empty password, for the Secret Service.
  echo -n "" | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1 || true
  if [[ "$DARK" == "--dark" ]]; then
    gsettings set org.gnome.desktop.interface color-scheme prefer-dark 2>/dev/null || true
  fi
  "$BIN" > "$OUT/app.log" 2>&1 &
  local pid=$!
  for _ in $(seq 1 60); do
    if xdotool search --onlyvisible --name "Folevi" >/dev/null 2>&1; then break; fi
    sleep 1
  done
  sleep 4
  import -window root "$OUT/window.png"
  # A second launch with a link, as the desktop does when someone clicks folevi://new: it must reach the
  # running app (single instance) instead of opening a second window.
  "$BIN" "folevi://new" >> "$OUT/second.log" 2>&1 || true
  sleep 2
  xdotool search --name "Folevi" > "$OUT/windows.txt" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}
export -f run; export BIN OUT DARK
dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" bash -c run
echo "Smoke test done: $OUT (window.png, app.log, windows.txt)"
