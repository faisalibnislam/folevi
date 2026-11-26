# 1.8.78 released for Windows and Linux

- Date: 2026-11-26 10:04 UTC
- Area: release, windows, linux
- Branch: claude/release-1.8.78-desktop

What changed: Folevi 1.8.78 (build 108), released for Windows and Linux from the release commit `73d949ec` (PR 150's merge). The owner approved it in the Linux session ("Yes, publish all").
- Windows: `windows/Folevi_1.8.78_x64-setup.exe` (SHA-256 5b3c8488f953f31d...) and `_arm64-setup.exe` (19821c4f3409e59e...) from Desktop workflow run 45788907176 (workflow_dispatch on `main` at `73d949ec`), plus `Folevi-x64-setup.exe` and `Folevi-arm64-setup.exe` (no-cache). Unsigned, as before.
- Linux: six packages and `SHA256SUMS` through `upload-release.sh`; apt and rpm repositories rebuilt in the VM and uploaded with `upload-repos.sh`; Snap revision 9 (arm64, built in the VM) and 10 (amd64, built on Launchpad) on stable, with `upload-metadata` pushing the Beta listing.
- Update feeds: `publish-update-feed.sh` with `--dry-run` first, then for real. All four `desktop/*/latest.json` say 1.8.78 and carry a signature.
- `build-in-lima.sh` now runs `apps/desktop/scripts/version.mjs` before building. Without it, the first build came out as 1.6.78, the stale version in `apps/desktop/package.json`; that was caught and rebuilt before any upload. This is likely how the 1.6.78 packages ended up in the apt and rpm pools earlier.

Checked:
- Every hosted installer and package matches its local build (curl and SHA-256; the versioned and stable names give the same hash).
- Both AppImages pass `smoke-test.sh` in the VM and show the welcome screen (x86_64 in `/srv/jammy-amd64` via `unsquashfs`).
- Live `Packages` lists 1.8.78, and live `InRelease` passes `gpgv` against the Folevi Linux key.
- `snapcraft status folevi` shows 1.8.78 at stable for amd64 (rev 10) and arm64 (rev 9).
- The four feeds are read back from folevi.com.

Left: nothing was installed on a real Windows PC or Linux desktop, and nobody has seen the first automatic update (1.7.78 to 1.8.78). Dropbox and Google Drive still have no client ids.
