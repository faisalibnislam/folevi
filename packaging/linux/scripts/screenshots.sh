#!/usr/bin/env bash
# The software-center screenshots (AppStream, Flathub, Snap Store) from the real Linux app: runs a development build
# (FOLEVI_PROBE needs one) with screenshots-flow.js on a 1280x800 virtual display, with a throwaway HOME and data folder,
# and saves home.png, note.png and today.png. Nothing touches anyone's library or desktop.
#
# Usage: packaging/linux/scripts/screenshots.sh <dev build's folevi> <screenshots-flow.js> <out dir>   (DARK=1: dark)
# Then copy the ones to use to packaging/linux/screenshots/ and upload them (docs/LINUX.md, "Flathub").
set -euo pipefail
BIN="$1"; FLOW="$2"; OUT="$3"; mkdir -p "$OUT"
if [[ "${4:-}" == "--inner" ]]; then
  export XDG_CURRENT_DESKTOP=GNOME
  echo -n "k" | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1 || true
  [[ -n "${DARK:-}" ]] && gsettings set org.gnome.desktop.interface color-scheme prefer-dark 2>/dev/null || true
  FOLEVI_PROBE=1 FOLEVI_PROBE_SCRIPT="$FLOW" FOLEVI_USER_DATA="$HOME/data" "$BIN" > "$OUT/app.log" 2>&1 &
  pid=$!
  for _ in $(seq 1 60); do xdotool search --onlyvisible --name "Folevi" >/dev/null 2>&1 && break; sleep 1; done
  win=$(xdotool search --onlyvisible --name "Folevi" | head -1)
  xdotool windowsize "$win" 1280 800 windowmove "$win" 0 0 || true
  n=0; deadline=$((SECONDS+${SHOTS_TIMEOUT:-120}))
  while (( SECONDS < deadline )); do
    c=$(grep -c '"step":"shot"' "$OUT/app.log" || true)
    while (( n < c )); do
      n=$((n+1)); name=$(grep -o '"step":"shot","name":"[^"]*"' "$OUT/app.log" | sed -n "${n}p" | sed 's/.*"name":"//;s/"//')
      sleep 1.2; import -window "$win" "$OUT/$name.png"; echo "captured $name"
    done
    grep -q '"step":"done"\|"step":"error"' "$OUT/app.log" && break
    sleep 0.3
  done
  sleep 1; kill $pid 2>/dev/null || true; wait $pid 2>/dev/null || true
  exit 0
fi
SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
export HOME="$SANDBOX/home" XDG_CONFIG_HOME="$SANDBOX/home/.config" XDG_DATA_HOME="$SANDBOX/home/.local/share" XDG_RUNTIME_DIR="$SANDBOX/run" NO_AT_BRIDGE=1
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" bash "$(readlink -f "$0")" "$BIN" "$FLOW" "$OUT" --inner
