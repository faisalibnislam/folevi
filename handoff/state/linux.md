# Folevi for Linux (`apps/desktop`, Tauri; `packaging/linux`)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- Released: 1.7.78. AppImage, .deb and .rpm for x86_64 and aarch64 on folevi.com, apt and rpm repositories (`folevi.com/download/linux/apt` and `/rpm`, signed with the Folevi Linux key), Snap Store revisions 7 and 8.
- In 1.7.78 (PRs 115, 128, 113 were merged before it was cut from `b11f3256`): the Mac's features for Linux (`docs/DESKTOP_PARITY.md`). Automatic updates (AppImage only: `linux::self_update_allowed`; the .deb, .rpm, Snap and Flatpak update through their package manager), Your own server with mDNS discovery, a passphrase app lock, background sync, Dropbox and Google Drive, notification buttons over D-Bus (no typed replies: D-Bus has none), and the launcher's New Note, Quick Add Task and Today's Tasks actions.
- Built in the Lima VM `folevi-linux` (`packaging/linux/scripts/build-in-lima.sh`); the snap build needs `sg lxd -c ...` because a plain `limactl shell` lacks the lxd group; the amd64 snap builds on Launchpad (`snapcraft remote-build`, about an hour).
- `packaging/linux/repo/build-apt-repo.sh` and `build-rpm-repo.sh` are the desktop app's; Folevi Server's are `build-server-apt-repo.sh` and `build-server-rpm-repo.sh`.
- The update feed is `folevi.com/download/desktop/linux-<arch>/latest.json`, made by `packaging/desktop/publish-update-feed.sh` (signed with the key in `~/.folevi-desktop-signing/`, never printed or committed). The feeds for 1.7.78 are published. Publishing it needs the owner's OK each time.
- Flathub needs a person: its rules bar AI-written manifests and AI-opened submissions (`docs/LINUX.md`).
- On main, not yet released: the lost-writes fix in the library folder (PR 133, merged 2026-11-26): `two_folder_fs_on_one_folder_never_lose_increments` passed 220 local runs in a row and on Linux x86_64 and aarch64 in CI.

## Next steps

- Linux and Windows go out as part of 1.8.79 if the owner confirms (the PR, merge and CI manager session coordinates): build in Lima, smoke tests, `upload-release.sh`, the apt and rpm repositories, the snaps, then `publish-update-feed.sh` (`--dry-run` first).
- Dropbox and Google Drive need the owner's app key and Desktop client id (repository variables `FOLEVI_DROPBOX_APP_KEY`, `FOLEVI_GOOGLE_DESKTOP_CLIENT_ID`) and the loopback redirects registered.
- None of the new features has run on a real Linux desktop yet; check them there, and the first automatic AppImage update (1.7.78 to the next release).
- The owner: copy `~/.folevi-linux-signing/folevi-repo-secret.asc` and the updater key to the password manager.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
