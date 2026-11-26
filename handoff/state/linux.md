# Folevi for Linux (`apps/desktop`, Tauri; `packaging/linux`)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- 1.7.78: AppImage, .deb and .rpm for x86_64 and aarch64 on folevi.com, apt and rpm repositories (`folevi.com/download/linux/apt` and `/rpm`, signed with the Folevi Linux key), Snap Store revisions 7 and 8.
- Built in the Lima VM `folevi-linux` (`packaging/linux/scripts/build-in-lima.sh`); the snap build needs `sg lxd -c ...` because a plain `limactl shell` lacks the lxd group; the amd64 snap builds on Launchpad (`snapcraft remote-build`, about an hour).
- `packaging/linux/repo/build-apt-repo.sh` and `build-rpm-repo.sh` are the desktop app's; Folevi Server's are `build-server-apt-repo.sh` and `build-server-rpm-repo.sh`.
- Flathub needs a person: its rules bar AI-written manifests and AI-opened submissions (`docs/LINUX.md`).

## Next steps

- A Rust test, `two_folder_fs_on_one_folder_never_lose_increments`, failed once on Linux aarch64 during the 1.7.78 release. PR 133 (conditional writes can't both win on one etag) changed that code afterwards; nobody has confirmed the test is steady since.
- The first automatic update from 1.7.78 on a real Linux desktop.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
