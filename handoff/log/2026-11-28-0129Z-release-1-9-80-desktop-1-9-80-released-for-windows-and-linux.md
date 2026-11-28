# 1.9.80 released for Windows and Linux

- Date: 2026-11-28 01:29 UTC
- Area: linux
- Branch: claude/release-1.9.80-desktop

The owner's OK: "release all" in the PR manager session, and "Yes, publish all" in this session for the Windows and
Linux files, repositories, feeds and snap. Built from the version PR's merge commit `7b16a128` (1.9.80, build 111).
Uploads waited for PR 187 (no CDN caching of downloads) to be live.

Published:
- Windows: `windows/Folevi_1.9.80_x64-setup.exe` (SHA-256 `6b356211f1ba03d3...`) and `_arm64-setup.exe`
  (`5310e73f5bdc6340...`), plus the stable `Folevi-x64-setup.exe` and `Folevi-arm64-setup.exe`. Desktop workflow run
  46090145089, started by hand on `main` at `7b16a128`. Unsigned, as before.
- Linux: AppImage, .deb and .rpm for x86_64 and aarch64 (`build-in-lima.sh`), `SHA256SUMS.txt` and
  `SHA256SUMS-1.9.80.txt`, through `upload-release.sh`; apt and rpm repositories rebuilt in the VM (1.5.75 to 1.9.80
  in the pool) and uploaded with `upload-repos.sh`.
- Update feeds `desktop/{windows,linux}-{x86_64,aarch64}/latest.json` at 1.9.80, signed (`publish-update-feed.sh`).
- Snap Store: arm64 revision 11 (1.9.80) on stable, built in the VM.

Checked:
- All 16 hosted Windows and Linux files (versioned and stable names) downloaded over folevi.com and compared with
  the builds by SHA-256: all match.
- Smoke tests: the aarch64 AppImage in the VM and the x86_64 AppImage in the amd64 root both start as 1.9.80 and show
  the welcome screen.
- Repositories: live `InRelease` and both `repomd.xml.asc` pass gpgv; apt `Packages` (amd64, arm64) and rpm primary
  metadata (x86_64, aarch64) list 1.9.80; the pooled arm64 .deb matches the build.
- CDN: two ranged requests for `linux/Folevi_1.9.80_aarch64.AppImage` gave 206, `x-vercel-cache: MISS`, then a plain
  GET gave 200 with all 166087176 bytes.
- Feeds: all four read back at 1.9.80, pointing at the versioned files.
- Automatic update through the live feed, in the VM on its own Xvfb display with zenity installed: a 1.8.78 aarch64
  AppImage offered "Folevi 1.9.80 is available. You have 1.8.78.", replaced itself with the 1.9.80 file (SHA-256
  `2f2d721b...`, the build's) and restarted as 1.9.80. Earlier the same day 1.7.78 to 1.8.78 passed the same way,
  after the CDN fix.

Not done or not checked:
- amd64 snap: Launchpad answered every `snapcraft remote-build` with HTTP 503 while creating the build repository
  (2026-11-28, more than six tries, also from a fresh one-commit folder). Stable amd64 stays at revision 10 (1.8.78).
- No install on a real Windows PC or Linux desktop; the Windows update was not run.
- Message dialogs on Linux need zenity: on KDE and minimal installs the update offer (and every other message dialog)
  doesn't show. Fix planned after this release (`handoff/state/linux.md`).
