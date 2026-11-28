# Paused desktop and Android builds taken down

- Date: 2026-11-28 06:46 UTC
- Area: release
- Branch: claude/take-down-paused-builds

The owner paused Android, Windows and Linux (2026-11-28) and approved taking the published builds down ("Take them down"; confirmed again in this session).

What changed:
- R2 bucket `folevi-updates` (served at `folevi.com/download/*`): deleted all 158 objects outside `mac/` (7.2 GB). That's `windows/*` (12 installers), `linux/*` (135: AppImages, .deb, .rpm, SHA256SUMS, screenshots, the apt repo `linux/apt/` and the rpm repos `linux/rpm/`), `android/*` (3 APKs) and the four update feeds `desktop/{windows,linux}-{x86_64,aarch64}/latest.json`. The 324 `mac/` objects weren't touched. The bucket held no Folevi Server files (those were never published).
- Snap Store: closed `stable`, `candidate`, `beta` and `edge` for `folevi` (amd64 and arm64). The name stays registered; `snap info folevi` now says no snap found.
- Play internal testing: not changed (needs the owner's Play Console sign-in).

Archive (outside the repo): `/Volumes/Corsair/Folevi-archive/paused-2026-11-28/`
- `folevi-updates/<bucket path>`: every deleted object, same paths as in the bucket.
- `removed-objects.txt`: key and size of each one.
- `object-metadata.json`: each object's content type and cache control as R2 had them.

Checks:
- Every archived file's size matched R2.
- The Linux files passed `shasum -a 256 -c` against all five SHA256SUMS files.
- A bucket listing after the delete has exactly the 324 `mac/` objects, unchanged.
- folevi.com: `mac/Folevi.dmg` full GET 200 (119 MB) and `mac/appcast.xml` answers. The removed Windows, Linux, apt, rpm, Android and feed URLs return 404. `folevi.com/server` returns 200.

Effect on installed copies: Windows and Linux apps already installed keep working. Their update checks now get a 404 for the feed, so no update is offered. apt and dnf users get a 404 from the repo on refresh. Snap installs stay but get no refreshes.

To restore: for each line of `removed-objects.txt`, run `npx wrangler r2 object put folevi-updates/<key> --file <archive>/folevi-updates/<key> --content-type <contentType> --cache-control <cacheControl> --remote` (values from `object-metadata.json`). Then `snapcraft release folevi 12 stable` (amd64) and `snapcraft release folevi 11 stable` (arm64). Each needs the owner's OK.
