# iPhone and iPad (`apps/ios` native, `apps/mobile` Capacitor)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- The owner's decision of 2026-11-25: iPhone and iPad go native SwiftUI for everything but the note's writing area, matching today's look, iOS 26 or later (`docs/claude-context/memory/native-apps-today-ui-2026-11-25.md`). That is `apps/ios` (PR 129, merged 2026-11-26), on TestFlight as 1.7.78 (107).
- The Capacitor app (`apps/mobile`, one project for iPhone, iPad and Android) is on TestFlight as 1.7.78 (103).
- The page must stay on `capacitor://localhost` or existing installs lose their data (`pnpm upgrade-test` guards it).
- Settings > Writing (spell check, prediction, US/UK English, the personal dictionary) is a native iPhone screen (`apps/native-kit/Sources/FoleviPhone/PhoneWritingSettings.swift`), saved through Settings' Convex allowlist; not in a TestFlight build yet.
- Not checked by any session: real devices, iPad landscape and Split View, QR scanning, signed-in Foli AI and the sync sheet.

## Next steps

- The owner tries the native build from TestFlight.
- The next upload needs a build above 107 (`setBuild` in `scripts/version.mjs`; `version.mjs build` alone counts up from `version.json`).

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
