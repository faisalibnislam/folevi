# Folevi for Windows (`apps/desktop`, Tauri)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- 1.7.78 installers are on folevi.com (x64 and ARM64), unsigned, built by the Desktop workflow in CI and uploaded with wrangler. The updater feeds exist from 1.7.78 on; 1.6.78 and older have no updater.
- Reaching home servers over plain http is in (PR 117).
- Not installed or run on a real Windows PC by any session.

## Next steps

- Windows code signing, the Microsoft Store, and the first automatic update from 1.7.78 (needs a real PC).
- Parity with the web and Mac: `docs/DESKTOP_PARITY.md`.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
