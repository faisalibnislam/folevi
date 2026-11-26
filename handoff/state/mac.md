# Folevi for Mac (`apps/mac`)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- 1.7.78 is published; installed Macs update through Sparkle. The app is AppKit with the bundled web interface (`apps/mac/project.yml` is main's layout: sources under `Folevi/`, bridge scripts in `Folevi/Bridge/`).
- "Your own server" sign-in is in (PR 105); the owner has not yet tried the sign-in sheet in the app itself.
- The Mac unit tests (XCTest) and `apps/native-kit` `swift test` were not run for the 1.6.78 release; the Debug build and the universal Release build with its signing checks were.

## Next steps

- The owner tries Float this note on the Mac (several panels, pin off and on, over a full-screen app).
- The Mac App Store build does not exist (Developer ID only).

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
