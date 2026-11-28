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

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
