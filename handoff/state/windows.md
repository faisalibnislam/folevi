# Folevi for Windows (`apps/desktop`, Tauri)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- 1.9.80 (build 111) installers are on folevi.com (x64 and ARM64), unsigned, built by the Desktop workflow (run 46090145089, started by hand on `main` at the release commit `7b16a128`) and uploaded with wrangler. The update feeds say 1.9.80, so 1.7.78 and 1.8.78 installs are offered it; 1.6.78 and older have no updater.
- Own AI keys (1.9.80) are kept in Credential Manager (`docs/DESKTOP_PARITY.md`).
- Reaching home servers over plain http is in (PR 117).
- Not installed or run on a real Windows PC by any session.

## Next steps

- Windows code signing, the Microsoft Store, and the first automatic update on a real PC (the Linux AppImage's has been tested in a VM).
- Parity with the web and Mac: `docs/DESKTOP_PARITY.md`.

## Taken down (2026-11-28, owner)
- Removed from `folevi.com/download` (R2 `folevi-updates`): all 12 `windows/*` installers and the feeds `desktop/windows-{x86_64,aarch64}/latest.json`. Installed copies keep working, but their update checks get a 404.
- Archive: `/Volumes/Corsair/Folevi-archive/paused-2026-11-28/` (bucket paths kept, plus `removed-objects.txt` and `object-metadata.json`).
- Restore: re-upload with `wrangler r2 object put` using the saved content type and cache control. Owner's OK first. Details: the 2026-11-28 0646Z log entry.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
