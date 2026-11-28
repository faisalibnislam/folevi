---
name: desktop-feature-parity
description: "Owner rule (2026-11-25): features added to the web or Mac app must also reach the Windows and Linux app when relevant; keep docs/DESKTOP_PARITY.md current"
metadata:
  type: project
  modified: 2026-11-25
---

**On hold since 2026-11-28:** the Windows and Linux app is paused ([platforms-paused-2026-11-28](platforms-paused-2026-11-28.md)). Don't port features to `apps/desktop` until the owner resumes it.

The owner, 2026-11-25: "I will mostly change things from the web app and Mac app, but relevant features should sync to Windows and Linux too. Keep notes and always sync features."

- Web app changes reach Windows and Linux automatically (all three load the same `apps/web`). Check only that the web code doesn't gate the feature on `platform === "mac"`, `inMacApp()` or a bridge method the Tauri host lacks.
- Native Mac shell changes (`apps/mac`, Swift) do not. For each one, port it to the shared Tauri shell (`apps/desktop/src-tauri`, Rust, plus `bridge/host.js`) in the same piece of work, or add it as a gap in `docs/DESKTOP_PARITY.md` with a reason.
- Mac-only system integrations with no real Windows/Linux counterpart (Spotlight, Shortcuts, Services menu, Quick Look, Look Up, Apple's on-device model, iCloud Drive) are skipped; the parity doc lists them.
- A Tauri method that isn't built yet must not be offered by the page: leave it out of the bridge (like `host.serverPlaces = false`) rather than letting it fail with "isn't in Folevi for this computer".

**Why:** the owner works mostly in the web and Mac apps and wants Windows and Linux users to get the same features without asking each time.
**How to apply:** at the end of any Mac shell or web change, check the parity doc and either port the feature or record the gap; update the doc's table when a gap closes.
