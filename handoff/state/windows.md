# Folevi for Windows (`apps/desktop`, Tauri)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- 1.8.78 installers are on folevi.com (x64 and ARM64), unsigned, built by the Desktop workflow (run 45788907176, started by hand on `main` at the release commit) and uploaded with wrangler. The update feeds say 1.8.78, so 1.7.78 installs are offered it; 1.6.78 and older have no updater.
- Reaching home servers over plain http is in (PR 117).
- Not installed or run on a real Windows PC by any session.

## Next steps

- Windows code signing, the Microsoft Store, and the first automatic update, 1.7.78 to 1.8.78 (needs a real PC).
- Parity with the web and Mac: `docs/DESKTOP_PARITY.md`.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
