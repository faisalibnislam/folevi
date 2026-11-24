# Folevi for Mac

Folevi's Mac app: the web app in a Mac window (AppKit and WKWebView, macOS 26). Since 24 November 2026 the Mac shows
the same interface as the browser, Windows and Linux: the web app's own sidebar, tabs and top bar, with the Mac's
window buttons placed in the page's top bar. Around it the Mac keeps what a Mac app should have: the full menu bar
with every shortcut, Quick Add from any app (⌥Space) and the menu bar icon, Spotlight and Shortcuts, Share and
Services, Touch ID lock, notifications, printing, drag and drop, text recognition, call recording and Sparkle updates.

History: this is the AppKit app that shipped up to 1.5.64 (tag `archive/mac-appkit`), brought back without its native
frame (the native sidebar and tab strip, N8). The SwiftUI app that replaced it from 1.5.66 to 1.5.71 is kept at tag
`archive/mac-swiftui`. All of them share one identity, so an update keeps notes, sign-ins, keys and settings:

| Build   | Bundle id          | Support folder                 | Keychain services | URL scheme |
| ------- | ------------------ | ------------------------------ | ----------------- | ---------- |
| Debug   | com.folevi.mac.dev | Application Support/Folevi Dev | com.folevi.dev.*  | folevi-dev |
| Release | com.folevi.mac     | Application Support/Folevi     | com.folevi.*      | folevi     |

`FOLEVI_USER_DATA` gives a run a data folder of its own (and its own Keychain names, settings and web storage), so
tests and scratch runs never touch the installed app's data.

## Layout

- `Folevi/App`: the app delegate, windows, the `app://` scheme serving the built-in interface, places, navigation.
- `Folevi/Bridge`: the page's bridges (`mac-bridge.js` is `window.foleviDesktop`, the shell bridge is the iPhone app's).
- `Folevi/Chrome`: the menu bar, title bar, Quick Add panel, menu bar icon, Dock menu, window restore.
- `Folevi/Services`: Spotlight, Shortcuts (App Intents), Share, Services, printing, Touch ID lock, call recording.
- `Folevi/Migration`: moving over from the Electron app.
- Shared with the iPhone app by path: `apps/ios/ios/App/Native/Shell` (library, sign-in, keys, places, on-device AI).
- From `apps/native-kit`: fonts and icons (FoleviDesign) and the lock cover (FoleviMac).

## Build, run, test

```bash
node apps/web/scripts/build-shell.mjs                      # the development web export into apps/mac/web
node apps/mac/scripts/build.mjs                            # Debug build ("Folevi Dev"), regenerates the project
node apps/mac/scripts/mac.mjs launch --user-data /tmp/x    # run on a scratch data folder; eval, shot, cmd ...
cd apps/mac && xcodebuild test -project Folevi.xcodeproj -scheme Folevi -derivedDataPath build/dd-test -destination 'platform=macOS'
```

Without a development `.env.local`, point a Debug run at a production export with `FOLEVI_SHELL_DIR` (for example a
release build's `Folevi.app/Contents/Resources/web`). `FOLEVI_TEST_FOLDER` answers "Choose a folder" with a scratch
folder.

## Release (direct download)

```bash
node apps/mac/scripts/release.mjs --out /tmp/rel   # dry run: Developer ID build + checks, nothing installed
node apps/mac/scripts/publish.mjs --plan           # what publishing would do
node apps/mac/scripts/publish.mjs                  # with the owner's OK: notarize, staple, DMG + ZIP, appcast, upload
```

Release notes come from CHANGELOG.json (`node scripts/version.mjs release patch ...` first). The feed is
`https://folevi.com/download/mac/appcast.xml` (R2 bucket `folevi-updates`), signed with Folevi's Sparkle key.
Details: `docs/MAC_RELEASE.md`. Before a release, test a signed-in account on the Release build with scratch data:
1.5.66 once left signed-in Macs on the loading screen.
