# Linux state corrected after the parity work and the lost-writes fix

- Date: 2026-11-26 05:23 UTC
- Area: linux
- Branch: claude/linux-state-fix

What changed: `handoff/state/linux.md`, seeded from the old handoff, now says what is true on main.
- The Linux side of the Mac parity work (PRs 115, 128, 113) is on main but not released: AppImage-only automatic updates, Your own server with mDNS, the passphrase lock, background sync, Dropbox and Google Drive, D-Bus notification buttons, and launcher actions.
- The flaky `two_folder_fs_on_one_folder_never_lose_increments` next step is gone: PR 133 fixed the race. It passed 220 local runs, and Linux x86_64 and aarch64 CI passed on that PR.
- The "first automatic update from 1.7.78" step was wrong: tag v1.7.78 has no `updates.rs`, so automatic updates start from the release after the next one.
- Added the owner's open items: Dropbox and Google client ids, and copying the repo signing key and updater key to the password manager.

Checked: `git cat-file -e v1.7.78:apps/desktop/src-tauri/src/updates.rs` fails; PR 133's checks are green on GitHub; `linux::self_update_allowed` returns true only for the AppImage.

Left: a Linux release, when the owner says so, and a run on a real Linux desktop.
