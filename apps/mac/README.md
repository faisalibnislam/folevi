# Folevi Core

A new, fully native Mac app for Folevi, built from the ground up for macOS 26 Tahoe (SwiftUI, with AppKit where
it matters). It installs beside today's Folevi for Mac (`apps/mac`), with its own name, bundle id
(`app.folevicore.FoleviCore`), data folder, Keychain names and URL scheme (`folevi-core://`), and signs in to the
same accounts. Today's app keeps shipping.

Parity with today's app is tracked item by item in [PARITY.md](PARITY.md).

## The shape of it

- **Everything around the note is native.** A two-column `NavigationSplitView` (a source-list sidebar on the
  system's Liquid Glass material, and the screen), the unified toolbar with Back and Forward, native window tabs
  (File > New Tab, Show All Tabs, merge and move tabs are macOS's own), an inspector, a SwiftUI Settings window,
  a command palette (⌘K), Quick Add (⌥Space from any app), a menu bar icon, and a menu bar with every command.
- **The note page is Folevi's web editor**, embedded. It runs in warm, pooled web views: one hidden engine page
  per open place (it is also the first window's editor), plus up to three editor pages lent to other windows that
  show notes at the same time and given back when a window hides. Native Find, menus, shortcuts, text services,
  drag and drop out of notes, Quick Look, printing and the share picker reach into it.
- **Type:** Folevi's own faces for what belongs to notes (Spectral titles, Instrument Sans on cards and in the
  page), SF Pro for everything around them.
- **Look:** Folevi's coloured app icon, the main app's own icon set in the sidebar and toolbars, the coloured Foli
  AI mark, and Folevi's ink (black buttons, white in dark mode) whatever the Mac's accent colour. Folder and note
  cards are Folevi's (frosted folder cards, the folder glyph).

## What Core shares (reused, never copied)

| Layer | Where it comes from |
| --- | --- |
| Sync engine, offline queue, local library, end-to-end encryption, editor | The bundled web export (`apps/web`, `build-shell.mjs`) in native chrome mode |
| Typed bridge to the engine (views, lists, commands, editor commands, events) | `FoleviEngine` (`apps/native-kit`, generated from `protocol.ts`) |
| Native side of the data layer (library files, sign-in, keys, places, on-device Foli AI) | `apps/ios/ios/App/Native/Shell/*`, compiled by path (as today's Mac app does) |
| Mac host plumbing (app:// scheme, message routers, places and background runners, links, offline switch, Sparkle wrapper, printing, OCR, call recorder, clipboard, downloads, login item) | `apps/mac/Folevi/...`, the UI-free files only, compiled by path |
| Fonts, tokens, folder glyph, note and folder cards, web icons, Foli AI mark | `FoleviDesign` |
| Demo engine (sample notes, no account) for tests and screenshots | `FoleviEngineDemo` |

Core's own host code is in `FoleviCore/Host` (its `Paths`, page views and navigation policy, the window registry
the shared Places uses, the desktop router and capabilities, the app lock, Spotlight, the Debug channel).

## Build, run, test

```bash
node apps/web/scripts/build-shell.mjs --dest apps/mac-core/web     # the development web export (once, and after web changes)
node apps/mac-core/scripts/build.mjs                                # Debug build ("Folevi Core Dev")
node apps/mac-core/scripts/core.mjs launch --fresh                  # run on a scratch data folder (never real data)
node apps/mac-core/scripts/core.mjs launch --demo --fresh           # run on the demo engine (no export, no account)
node apps/mac-core/scripts/core.mjs cmd state                       # Debug commands: state, go, gate, notes, palette...
node apps/mac-core/scripts/core.mjs shot apps/mac-core/screens/home.png
xcodebuild -project apps/mac-core/FoleviCore.xcodeproj -scheme FoleviCore -derivedDataPath apps/mac-core/build/dd test
```

The Debug app keeps everything in `Application Support/Folevi Core Dev` (or `FOLEVI_USER_DATA`), with Keychain
names under `app.folevicore.dev.`. A library "on this Mac" in Debug lives in that folder too.

## Release (direct download)

```bash
node apps/mac-core/scripts/release.mjs --launch-check   # builders: Developer ID build + DMG, checked, not notarized
node apps/mac-core/scripts/publish.mjs --plan           # the owner: what publishing would do
node apps/mac-core/scripts/publish.mjs                  # the owner: notarize, staple, appcast, upload to R2 core/
```

Downloads and the Sparkle feed live in the R2 bucket `folevi-updates` under `core/`, served at
`https://folevi.com/download/core/FoleviCore.dmg` and `.../core/appcast.xml` (the existing `/download/:path*`
rewrite). Core has its own Sparkle EdDSA key (login Keychain, account `folevi-core`; keep a backup with the
owner's other keys). No Mac App Store build yet.
