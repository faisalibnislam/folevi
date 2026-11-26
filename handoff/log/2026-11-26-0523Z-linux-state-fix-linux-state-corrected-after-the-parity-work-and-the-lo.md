# Linux state corrected after the parity work and the lost-writes fix

- Date: 2026-11-26 05:23 UTC
- Area: linux
- Branch: claude/linux-state-fix

What changed: `handoff/state/linux.md`, seeded from the old handoff, now says what is true on main.
- The Linux side of the Mac parity work (PRs 115, 128, 113) shipped in 1.7.78: each PR's merge commit is an ancestor of `v1.7.78`. That covers AppImage-only automatic updates, Your own server with mDNS, the passphrase lock, background sync, Dropbox and Google Drive, D-Bus notification buttons, and launcher actions. 1.7.78's update feeds are published (`folevi.com/download/desktop/linux-x86_64/latest.json` answers 200).
- The flaky `two_folder_fs_on_one_folder_never_lose_increments` next step is gone: PR 133 fixed the race after 1.7.78. It passed 220 local runs, and Linux x86_64 and aarch64 CI passed on that PR. It ships in the next release.
- Next release: Linux and Windows go out as part of 1.8.79 if the owner confirms, coordinated by the PR, merge and CI manager session.
- Added the owner's open items: Dropbox and Google client ids, and copying the repo signing key and updater key to the password manager.

Checked: `git ls-tree v1.7.78 apps/desktop/src-tauri/src/updates.rs` lists the file; `git merge-base --is-ancestor` puts PRs 115, 128 and 113 in 1.7.78 and PR 133 after it; `linux::self_update_allowed` is true only for the AppImage.

Left: the 1.8.79 desktop build when the owner confirms, a run on a real Linux desktop, and the first automatic AppImage update from 1.7.78.
