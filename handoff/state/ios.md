# iPhone and iPad (`apps/ios` native, `apps/mobile` Capacitor)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- The owner's decision of 2026-11-25: iPhone and iPad go native SwiftUI for everything but the note's writing area, matching today's look, iOS 26 or later (`docs/claude-context/memory/native-apps-today-ui-2026-11-25.md`). That is `apps/ios` (PR 129, merged 2026-11-26), on TestFlight as 1.7.78 (107).
- The Capacitor app (`apps/mobile`, one project for iPhone, iPad and Android) went to TestFlight as 1.7.78 (103); the native 107 has the same bundle ID and replaces it for testers. From 1.8.79 only the native app goes to TestFlight for iPhone and iPad (the release session builds it with `apps/ios/scripts/release.mjs`).
- TestFlight has **1.9.82 (113)**, uploaded 2026-11-28 by the PR manager session (detail in `handoff/state/release.md`): the first build with the native Home, Settings search and split "You", the sidebar, list and task changes (PR 205), and folder cards with real note cards. Lines below that say "not on TestFlight yet" for work merged before 2026-11-28 are in this build. Nobody has run it on a device.
- Home (2026-11-27, not on TestFlight yet): Tags show two lines of chips, See all opens the rest; Foli DNA is a tile in Shared with Me's place and Shared with Me is a row in the card at the end.
- The page must stay on `capacitor://localhost` or existing installs lose their data (`pnpm upgrade-test` guards it).
- Settings > Writing (spell check, prediction, US/UK English, the personal dictionary) is a native iPhone screen (`apps/native-kit/Sources/FoleviPhone/PhoneWritingSettings.swift`), saved through Settings' Convex allowlist; not in a TestFlight build yet.
- Not checked by any session: real devices, iPad landscape and Split View, QR scanning, signed-in Foli AI and the sync sheet.

## Next steps

- The owner tries the native build from TestFlight.
- The next upload needs a build above 107 (`setBuild` in `scripts/version.mjs`; `version.mjs build` alone counts up from `version.json`); the 1.8.79 release expects 108.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
