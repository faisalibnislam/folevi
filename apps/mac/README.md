# Folevi for Mac

Folevi's Mac app: fully native, built for macOS 26 Tahoe (SwiftUI, with AppKit where it matters). It began as
"Folevi Core", a separate app beside the AppKit Folevi for Mac. On 23 November 2026 it replaced that app as an
update in place (the owner's choice). It now carries that app's bundle id (`com.folevi.mac`), name, data folder
(`Application Support/Folevi`), Keychain names (`com.folevi.*`), URL scheme (`folevi://`) and Sparkle feed and key,
so installed copies update to it and keep their libraries, sign-ins and keys. The AppKit app's code is kept at the
git tag `archive/mac-appkit` (its last release, 1.5.64).

The Xcode project and module are still named `FoleviCore`; the product is "Folevi" ("Folevi Dev" in Debug).

Parity with the AppKit app is tracked item by item in [PARITY.md](PARITY.md).

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

## What it shares (reused, never copied)

| Layer | Where it comes from |
| --- | --- |
| Sync engine, offline queue, local library, end-to-end encryption, editor | The bundled web export (`apps/web`, `build-shell.mjs`) in native chrome mode |
| Typed bridge to the engine (views, lists, commands, editor commands, events) | `FoleviEngine` (`apps/native-kit`, generated from `protocol.ts`) |
| Native side of the data layer (library files, sign-in, keys, places, on-device Foli AI) | `apps/ios/ios/App/Native/Shell/*`, compiled by path |
| Mac host plumbing (app:// scheme, message routers, places and background runners, links, offline switch, Sparkle wrapper, printing, OCR, call recorder, clipboard, downloads, login item) | `FoleviCore/Host/Shared` (moved from the AppKit app when it was retired) |
| Fonts, tokens, folder glyph, note and folder cards, web icons, Foli AI mark | `FoleviDesign` |
| Demo engine (sample notes, no account) for tests and screenshots | `FoleviEngineDemo` |

The app's own host code is in `FoleviCore/Host` (its `Paths`, page views and navigation policy, the window registry
the shared Places uses, the desktop router and capabilities, the app lock, Spotlight, the Debug channel).

## Build, run, test

```bash
node apps/web/scripts/build-shell.mjs                         # the development web export into apps/mac/web (once, and after web changes)
node apps/mac/scripts/build.mjs                               # Debug build ("Folevi Dev")
node apps/mac/scripts/core.mjs launch --fresh                 # run on a scratch data folder (never real data)
node apps/mac/scripts/core.mjs launch --demo --fresh          # run on the demo engine (no export, no account)
node apps/mac/scripts/core.mjs cmd state                      # Debug commands: state, go, gate, notes, palette...
node apps/mac/scripts/core.mjs shot apps/mac/screens/home.png
xcodebuild -project apps/mac/FoleviCore.xcodeproj -scheme FoleviCore -derivedDataPath apps/mac/build/dd test
```

The Debug app is "Folevi Dev" (`com.folevi.mac.dev`). It keeps its data in `Application Support/Folevi Dev` (or
`FOLEVI_USER_DATA`, which core.mjs always sets), with Keychain names under `com.folevi.dev.`, and has no iCloud
entitlement, as the AppKit Dev build had none. A library "on this Mac" in Debug lives in that folder too.

## Release (direct download)

```bash
node apps/mac/scripts/release.mjs --launch-check   # builders: Developer ID build + DMG, checked, not notarized
node apps/mac/scripts/publish.mjs --plan           # what publishing would do
node apps/mac/scripts/publish.mjs                  # the owner (or with the owner's OK): notarize, staple, appcast, upload
```

- **Signing:** Release signs with Developer ID and the committed profile (`signing/Folevi.provisionprofile`, "Folevi
  for Mac Developer ID iCloud", valid to 2044; iCloud and the Keychain group).
- **Keychain:** release.mjs checks the designated requirement the Keychain items ask for. A build without it would
  lose every sign-in and key on update.
- **Downloads and feed:** the R2 bucket `folevi-updates` under `mac/`, served at
  `https://folevi.com/download/mac/Folevi.dmg` and `.../mac/appcast.xml`, signed with Folevi's Sparkle EdDSA key
  (login Keychain, account `folevi`).
- **Builds:** universal by default (Intel Macs run macOS 26 too).
- **Release notes:** they come from CHANGELOG.json.
- **Deltas:** they're made from `apps/mac/release-archive/` (git-ignored; the main checkout keeps the AppKit app's
  ZIPs there).
- **Mac App Store:** no build yet.
