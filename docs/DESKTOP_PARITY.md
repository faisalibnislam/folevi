# Desktop feature parity: Mac vs Windows and Linux

Owner rule (2026-11-25): features added to the web or Mac app also go to Windows and Linux when they make sense
there. See `docs/claude-context/memory/desktop-feature-parity.md`.

- All three desktop apps load the same web app (`apps/web`), so web features reach every one of them.
- The native shells differ: the Mac is Swift (`apps/mac/Folevi`); Windows and Linux share one Tauri 2 project
  (`apps/desktop/src-tauri`, Rust, with `bridge/host.js` building the page's `foleviShell` and `foleviDesktop`).
- Any bridge method Tauri doesn't handle fails with "X isn't in Folevi for this computer", so a feature that isn't
  built must be left out of the bridge, not offered.

When you change the Mac shell, port the change here or add a row below. When a gap closes, update its row.

Last full audit: 2026-11-25, on main at `e0183862` (read from code, not tested in the running apps). Updated
2026-11-25 for PRs 115 and 128 (items 1 to 9 below); none of it has run on a real Windows PC or Linux desktop yet.

## Status

Yes = built, Partial = built with less, No = missing.

| Feature | Mac | Windows | Linux | Notes |
|---|---|---|---|---|
| Control scale (one control height, corner, edge, weight and icon: docs/DESIGN_SYSTEM.md, Controls; 2026-11-26) | Yes | Yes | Yes | The same web CSS in all three; the Mac look's 28 pt buttons are gone. Checked headlessly by `e2e/control-scale.spec.ts` in the Mac look and the Windows look (with `--win-caption-inset`), Chromium and WebKit, light and dark; Linux draws the web look. Not checked in the running apps |
| Menus and keyboard shortcuts | Yes | Partial | Partial | No menu bar; `host.js` `keyAction` has tabs, windows, print, settings, zoom, F11, Alt+arrows, and since PR 125 Ctrl+N, Ctrl+Shift+F, Ctrl+/, Ctrl+Shift+] and [, Ctrl+Alt+C, Ctrl+Alt+\\, Ctrl+Alt+Shift+N, Ctrl+Q (Linux). Export, Move, Trash, Copy Link and Find Next have no Ctrl key yet (the page doesn't handle them off the Mac) |
| Text menu (spelling, Learn Word, Look Up) | Yes | Partial | Partial | Spelling in the note is Folevi's own in all three since 2026-11-26 (docs/SPELLING_PLAN.md); Look Up is Mac-only |
| Spell check, suggestions, next-word prediction | Yes | Yes | Yes | Same web code everywhere (docs/SPELLING_PLAN.md). Settings > Writing is in the Windows and Linux app's web Settings; the Mac's native Settings has no row yet (the note's right-click menu has the switches) |
| Quick Add shortcut and panel | Yes | Yes | Yes | Wayland uses the GlobalShortcuts portal (not tested on real Wayland) |
| Tray / menu bar icon | Yes | Yes | Yes | Tray lacks Search and a place switcher |
| Dock menu / Jump List / launcher actions | Yes | Yes | Yes | Windows Jump List (`jumplist.rs`, PR 120); Linux .desktop actions. New Note, Quick Add, Today's Tasks |
| Notifications | Yes | Yes | Partial | `notify.rs` (PR 123): Reply, Mark as Read, Open, Complete, three Snoozes; Windows groups by note. Linux has no typed Reply (D-Bus has none) |
| Local reminders | Yes | Yes | Yes | |
| Badge | Yes | Yes | Partial | Linux shows it only on docks that support it |
| Auto-update | Yes (Sparkle) | Yes | Partial | `updates.rs` (PR 115): checks at launch and every 12 hours, Check for Updates in the tray, key outside the repo, `publish-update-feed.sh`. Takes effect from the first release with it. Linux: the AppImage updates itself; .deb/.rpm from the repos; Snap and Flatpak from their stores |
| Open at login | Yes | Yes | Yes | |
| App lock | Yes | Yes | Yes | `applock.rs` (PR 118): Windows Hello on Windows, a passphrase on Linux. Not when Windows locks the screen without sleeping |
| Background sync of other places | Yes | Yes | Yes | `backsync.rs` (PR 119): hidden runners and a native unread count. No low-memory relief yet |
| Local library folder | Yes | Yes | Yes | |
| Dropbox / Google Drive library | Yes | Partial | Partial | `cloud.rs` (PR 121), built and tested; not offered until the owner sets `FOLEVI_DROPBOX_APP_KEY` and `FOLEVI_GOOGLE_DESKTOP_CLIENT_ID` (docs/DESKTOP_APP.md) |
| Encryption keys | Yes (Keychain, Touch ID) | Yes | Partial | Credential Manager / Secret Service; Windows Hello before encrypted notes open (PR 118); Linux has nothing to ask with |
| Foli AI | Yes | Partial | Partial | Own keys only; no on-device model |
| Places (several accounts) | Yes | Yes | Yes | |
| Your own server sign-in | Yes | Yes | Yes | `server.rs` (PR 116). http servers on the home network other than localhost: Windows needs the relay in PR 117; Linux not checked yet |
| Finding servers on the home network | Yes | Yes | Yes | mdns-sd, `_folevi._tcp` |
| `folevi://` links | Yes | Yes | Yes | |
| Share | Yes | Yes | No | Windows Share sheet from the note's Share dialog (PR 127). Linux has no standard share sheet |
| Printing | Yes | Yes | Yes | |
| Drag notes out as files | Yes | No | No | |
| Downloads / Save | Yes | Yes | Partial | Unsure how WebKitGTK handles plain download links |
| Quick Look | Yes | Yes | Yes | Open in the default app (PR 125) |
| Spotlight | Yes | No | No | Mac-only, skip |
| Shortcuts / Siri | Yes | No | No | Mac-only, skip |
| Services menu | Yes | No | No | Mac-only, skip |
| Text recognition in images | Yes (Vision) | Yes | No | Windows.Media.Ocr (PR 127). Linux has none built in |
| Call recording | Yes | Yes | No | WebView2 "Share system audio" (PR 124). WebKitGTK has no system sound |
| Window restore | Yes (size, place, pages) | Yes | Yes | Every window at its page (`windows.json`, PR 126) |
| Several windows | Yes | Yes | Yes | |
| Title bar | Yes | Yes | Yes | Windows has its own caption buttons |
| Desktop settings | Yes | Yes | Yes | |
| Web calendars, link previews | Yes | Yes | Yes | |
| Import from Apple Notes | Yes | No | No | Mac only by nature: Windows and Linux have no Apple Notes to read. `AppleNotesReader.swift` (FoleviMac) reads Notes through Apple Events; Settings > Import & export and the web Import screen (`foleviDesktop.appleNotes`, only offered when present) import it through `lib/import/appleNotes.ts` (notes, folders, tags, images, every attachment, original dates). Not a gap to port. The original dates, tags and file blocks it adds to `imports.importText` work for every app |

Done (PR 113, 2026-11-25): the web app now recognises `windows` and `linux` as native apps
(`lib/e2ee/keys/macBridge.ts`), so encryption screens say "this PC" or "this computer", devices register with
the right platform, and passkeys aren't offered inside the apps. Before, Linux counted as a Mac and Windows as a
browser.

## To do

Items 1 to 9 of the first list landed on 2026-11-25 (PR 115, then PRs 116, 118 to 121 and 123 to 127 together as
PR 128). Left:
1. Try each on a real Windows PC and Linux desktop (the owner's testing checklist in docs/DESKTOP_APP.md).
2. Dropbox and Google Drive client ids (owner).
3. http servers on the home network: PR 117 (Windows relay); check WebKitGTK on Linux.
4. Drag notes out as files; Linux share and text recognition if a standard way appears; Ctrl keys for Export,
   Move, Trash, Copy Link and Find Next once the page handles them off the Mac.
5. Lock on Windows' own screen lock; background sync's low-memory relief.

## Mac-only, not planned

Spotlight, Shortcuts and Siri, the Services menu, Quick Look's panel, Look Up, spelling learning, Apple's
on-device model, iCloud Drive, the Dock menu as such, traffic-light placement, the clipboard workaround for
WebKit, Electron migration.
