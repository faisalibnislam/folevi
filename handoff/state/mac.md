# Folevi for Mac (`apps/mac`)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- 1.7.78 is published; installed Macs update through Sparkle. The app is AppKit with the bundled web interface (`apps/mac/project.yml` is main's layout: sources under `Folevi/`, bridge scripts in `Folevi/Bridge/`).
- "Your own server" sign-in is in (PR 105); the owner has not yet tried the sign-in sheet in the app itself.
- Import from Apple Notes (PR 139): notes, folders, tags, every attachment and original dates; not in a release yet, and not yet tried on a real Notes library.
- Settings > Writing (spell check, prediction, US/UK English, the personal dictionary) is a native section (`apps/native-kit/Sources/FoleviMac/Views/Settings/WritingSettings.swift`), saved through Settings' Convex allowlist; not in a release yet.
- The sidebar's More section and Customize sidebar are native (`apps/native-kit/Sources/FoleviMac/Model/SidebarLayout.swift`, `SidebarLayoutStore.swift`, `Views/SidebarCustomize.swift`, `WebSidebar+Mac.swift`), reading and saving the web's layout (`convex/sidebarLayout.ts`, through Settings' Convex allowlist); not in a release yet. Tested headless only.
- Menu bar note (2026-11-28, not in a release yet): the menu bar icon and ⌥Space open a panel with one real note in Folevi's editor (the float page without its bar), made in Drafts or the picked folder on the first keystroke and synced like any other note (`apps/native-kit/Sources/FoleviMenuBarNote`, `apps/mac/Folevi/Chrome/MenuBarNoteHost.swift`, `apps/web/src/components/app/MenuBarNote.tsx`). Right-click on the icon shows the old menu. Tested headless only.
- The Mac unit tests (XCTest) and `apps/native-kit` `swift test` were not run for the 1.6.78 release; the Debug build and the universal Release build with its signing checks were.

## Next steps

- The native Home (2026-11-28, branch `claude/native-port-1128`, not in a release): the web's design version 19 on Mac, iPad and iPhone (`FoleviScreens/Home/HomeDashboard*.swift`, engine revision 37). Left: the Shared with me and Templates blocks as lists, Pinned note beyond recent notes, Catch me up on `ai.homeSummary`, a look on a real iPad and iPhone.
- The owner tries the menu bar note in the app: click the icon and ⌥Space, type on the empty page (a note appears in Drafts on the web), pick a workspace folder, New, a screenshot, pin and window mode, VoiceOver.

- The owner tries Float this note on the Mac (several panels, pin off and on, over a full-screen app).
- Try Import from Apple Notes with a Notes account or macOS user made only for testing (with the owner's OK): big library, big attachments, "denied", attachments saving into Folevi's temporary folder, checklist ticks.
- The owner tries More and Customize sidebar in the app: a drag in Customize sidebar, right-click Move to More, VoiceOver on the More row and the checkboxes, and a change made on the web showing up here.
- The Mac App Store build does not exist (Developer ID only).

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
