#!/usr/bin/env bash
# Folevi on Flathub (docs/LINUX.md, "Flathub").
#
#   flathub-submission.sh --set-version <v>   points the manifest's two .deb sources at the published
#                                              Folevi_<v>_amd64.deb and Folevi_<v>_arm64.deb, with the sha256 from
#                                              folevi.com/download/linux/SHA256SUMS-<v>.txt (publish them first).
#   flathub-submission.sh <out dir>           writes the files exactly as they go in Flathub's repository
#                                              (flathub/com.folevi.Folevi, or the new-app pull request to
#                                              flathub/flathub): the manifest with same-folder paths, flathub.json,
#                                              patches/, the metainfo file and the desktop template.
#
# Neither step uploads or submits anything; the pull request to Flathub needs the owner's OK.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$HERE/flatpak/com.folevi.Folevi.yml"

if [[ "${1:-}" == "--set-version" ]]; then
  V="${2:?version}"
  SUMS="$(curl -sfL "https://folevi.com/download/linux/SHA256SUMS-$V.txt")" || { echo "SHA256SUMS-$V.txt isn't published"; exit 1; }
  python3 - "$MANIFEST" "$V" "$SUMS" <<'EOF'
import re, sys
path, v, sums = sys.argv[1], sys.argv[2], sys.argv[3]
sha = {name: digest for digest, name in (line.split() for line in sums.splitlines() if line.strip())}
text = open(path).read()
for arch, deb in (("x86_64", f"Folevi_{v}_amd64.deb"), ("aarch64", f"Folevi_{v}_arm64.deb")):
    if deb not in sha:
        sys.exit(f"{deb} isn't in SHA256SUMS-{v}.txt")
    text, n = re.subn(
        rf"(only-arches: \[{arch}\]\n        url: )[^\n]+\n(        sha256: )[0-9a-f]+",
        lambda m: f"{m.group(1)}https://folevi.com/download/linux/{deb}\n{m.group(2)}{sha[deb]}", text)
    assert n == 1, f"no {arch} source in the manifest"
open(path, "w").write(text)
print(f"manifest now points at {v}")
EOF
  exit 0
fi

OUT="${1:?out dir, or --set-version <v>}"
mkdir -p "$OUT"
sed -e 's|path: \.\./|path: |' "$MANIFEST" > "$OUT/com.folevi.Folevi.yml"
cp "$HERE/flatpak/flathub.json" "$HERE/com.folevi.Folevi.metainfo.xml" "$HERE/folevi.desktop.hbs" "$OUT/"
rm -rf "$OUT/patches"; cp -R "$HERE/flatpak/patches" "$OUT/patches"
echo "Flathub files in $OUT:"; (cd "$OUT" && find . -type f | sort)
