#!/usr/bin/env bash
# Builds the native Folevi macOS app with xcodebuild, stages apps/macos/build/Folevi.app and launches it.
#
#   script/build_and_run_macos.sh                       # Debug build, launch
#   script/build_and_run_macos.sh --release             # Release build, launch
#   script/build_and_run_macos.sh --no-launch           # build + stage only
#   script/build_and_run_macos.sh --dev-login EMAIL     # Debug: sign in with a local dev token (scripts/dev-token.mjs)
#   script/build_and_run_macos.sh -- -FoleviForceOffline YES   # extra launch arguments after --
#
# Works from a clean checkout: the committed Folevi.xcodeproj is used as-is (XcodeGen is only needed
# after editing apps/macos/project.yml). Swift packages are resolved by xcodebuild on first build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACOS="$ROOT/apps/macos"
PROJECT="$MACOS/Folevi.xcodeproj"
BUILD_DIR="$MACOS/build"
CONFIG="Debug"
LAUNCH=1
DEV_EMAIL=""
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release) CONFIG="Release"; shift ;;
    --debug) CONFIG="Debug"; shift ;;
    --no-launch) LAUNCH=0; shift ;;
    --dev-login) DEV_EMAIL="${2:?--dev-login needs an email}"; shift 2 ;;
    --) shift; EXTRA_ARGS=("$@"); break ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ -n "$DEV_EMAIL" && "$CONFIG" != "Debug" ]]; then
  echo "--dev-login is only available for Debug builds." >&2
  exit 2
fi

echo "==> Building Folevi ($CONFIG)"
set -o pipefail
xcodebuild \
  -project "$PROJECT" \
  -scheme Folevi \
  -configuration "$CONFIG" \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$BUILD_DIR/DerivedData" \
  build 2>&1 | grep -v "was built for newer 'macOS' version" | grep -E "error:|warning: .*Folevi/|BUILD (SUCCEEDED|FAILED)|\*\* " || true

PRODUCT="$BUILD_DIR/DerivedData/Build/Products/$CONFIG/Folevi.app"
if [[ ! -d "$PRODUCT" ]]; then
  echo "Build failed: $PRODUCT not found" >&2
  exit 1
fi

STAGED="$BUILD_DIR/Folevi.app"
rm -rf "$STAGED"
ditto "$PRODUCT" "$STAGED"
codesign --verify --deep --strict "$STAGED" >/dev/null 2>&1 || echo "warning: code signature did not verify (ad-hoc builds are expected to run locally only)"
echo "==> Staged $STAGED"

if [[ "$LAUNCH" -eq 0 ]]; then
  exit 0
fi

ARGS=()
if [[ -n "$DEV_EMAIL" ]]; then
  if ! command -v node >/dev/null; then echo "node is required for --dev-login" >&2; exit 2; fi
  TOKEN="$(cd "$ROOT" && node scripts/dev-token.mjs --email "$DEV_EMAIL" --name "${DEV_NAME:-${DEV_EMAIL%@*}}" --device mac-dev --ttl 43200)"
  ARGS+=(-FoleviDevToken "$TOKEN")
fi
if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then ARGS+=("${EXTRA_ARGS[@]}"); fi

# Quit a running copy so the new build is the one in front.
if pgrep -x Folevi >/dev/null; then
  osascript -e 'tell application id "com.folevi.mac" to quit' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -x Folevi >/dev/null || break; sleep 0.3; done
  pkill -x Folevi 2>/dev/null || true
fi

echo "==> Launching Folevi"
if [[ ${#ARGS[@]} -gt 0 ]]; then
  /usr/bin/open -n "$STAGED" --args "${ARGS[@]}"
else
  /usr/bin/open -n "$STAGED"
fi
