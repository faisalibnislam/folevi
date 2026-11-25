# Desktop feature parity: Mac vs Windows and Linux

Owner rule (2026-11-25): features added to the web or Mac app also go to Windows and Linux when they make sense
there. See `docs/claude-context/memory/desktop-feature-parity.md`.

- All three desktop apps load the same web app (`apps/web`), so web features reach every one of them.
- The native shells differ: the Mac is Swift (`apps/mac/Folevi`); Windows and Linux share one Tauri 2 project
  (`apps/desktop/src-tauri`, Rust, with `bridge/host.js` building the page's `foleviShell` and `foleviDesktop`).
- Any bridge method Tauri doesn't handle fails with "X isn't in Folevi for this computer", so a feature that isn't
  built must be left out of the bridge, not offered.

When you change the Mac shell, port the change here or add a row below. When a gap closes, update its row.

Last full audit: 2026-11-25, on main at `e0183862` (read from code, not tested in the running apps).

## Status

Yes = built, Partial = built with less, No = missing.

| Feature | Mac | Windows | Linux | Notes |
|---|---|---|---|---|
| Menus and keyboard shortcuts | Yes | Partial | Partial | No menu bar; `host.js` `keyAction` has tabs, windows, print, settings, zoom, F11, Alt+arrows. No Note/Format/Export menus |
| Text menu (spelling, Learn Word, Look Up) | Yes | Partial | Partial | Web spelling fallback; Look Up is Mac-only |
| Quick Add shortcut and panel | Yes | Yes | Yes | Wayland uses the GlobalShortcuts portal (not tested on real Wayland) |
| Tray / menu bar icon | Yes | Yes | Yes | Tray lacks Search and a place switcher |
| Dock menu / Jump List / launcher actions | Yes | No | No | |
| Notifications | Yes | Partial | Partial | Click to open only; no Reply, Mark as Read, Complete, Snooze; no grouping |
| Local reminders | Yes | Yes | Yes | |
| Badge | Yes | Yes | Partial | Linux shows it only on docks that support it |
| Auto-update | Yes (Sparkle) | No | Partial | `tauri-plugin-updater` not registered, empty pubkey, no "Check for updates" in the tray even though `ShellUpdateGate.tsx` tells Windows users to use it. Linux .deb/.rpm update from the repos; the AppImage doesn't |
| Open at login | Yes | Yes | Yes | |
| App lock | Yes | No | No | `lockGet` returns null, `lockSet` "unavailable" |
| Background sync of other places | Yes | No | No | Unread counts for other accounts go stale |
| Local library folder | Yes | Yes | Yes | |
| Dropbox / Google Drive library | Yes | No | No | `library/mod.rs` refuses them |
| Encryption keys | Yes (Keychain, Touch ID) | Partial | Partial | Credential Manager / Secret Service; no Windows Hello |
| Foli AI | Yes | Partial | Partial | Own keys only; no on-device model |
| Places (several accounts) | Yes | Yes | Yes | |
| Your own server sign-in | Yes | No | No | Hidden on Windows/Linux since 2026-11-25 (`host.serverPlaces = false` in `host.js`) |
| Finding servers on the home network | Yes | No | No | Needs mDNS (`_folevi._tcp`) |
| `folevi://` links | Yes | Yes | Yes | |
| Share | Yes | No | No | |
| Printing | Yes | Yes | Yes | |
| Drag notes out as files | Yes | No | No | |
| Downloads / Save | Yes | Yes | Partial | Unsure how WebKitGTK handles plain download links |
| Quick Look | Yes | No | No | Could become "open in the default app" |
| Spotlight | Yes | No | No | Mac-only, skip |
| Shortcuts / Siri | Yes | No | No | Mac-only, skip |
| Services menu | Yes | No | No | Mac-only, skip |
| Text recognition in images | Yes (Vision) | No | No | Windows has Windows.Media.Ocr |
| Call recording | Yes | No | No | Web gates it on `platform === "mac"` (`callCapture.ts`) |
| Window restore | Yes (size, place, pages) | Partial | Partial | Size and place only |
| Several windows | Yes | Yes | Yes | |
| Title bar | Yes | Yes | Yes | Windows has its own caption buttons |
| Desktop settings | Yes | Yes | Yes | |
| Web calendars, link previews | Yes | Yes | Yes | |

Fixed on 2026-11-25: the web app now recognises `windows` and `linux` as native apps
(`lib/e2ee/keys/macBridge.ts`), so encryption screens say "this PC" or "this computer", devices register with
the right platform, and passkeys aren't offered inside the apps. Before, Linux counted as a Mac and Windows as a
browser.

## To do, in order

1. Auto-update for Windows and the AppImage: register the updater, a signing key held outside the repo, an
   update feed from the release scripts, "Check for updates" in the tray.
2. Your own server sign-in and home-network discovery (then remove `serverPlaces: false`).
3. App lock and encryption unlock with Windows Hello; a passphrase lock on Linux.
4. Background sync for other places.
5. Dropbox and Google Drive library (shared logic is in `packages/cloud-folders`).
6. Notification actions (Windows toast buttons, Linux D-Bus actions).
7. Call recording on Windows (WebView2 system audio); Linux later.
8. Jump List and Linux launcher actions (New Note, Quick Add).
9. Share, text recognition, open attachments in the default app, full window restore, more menu shortcuts.

## Mac-only, not planned

Spotlight, Shortcuts and Siri, the Services menu, Quick Look's panel, Look Up, spelling learning, Apple's
on-device model, iCloud Drive, the Dock menu as such, traffic-light placement, the clipboard workaround for
WebKit, Electron migration.
