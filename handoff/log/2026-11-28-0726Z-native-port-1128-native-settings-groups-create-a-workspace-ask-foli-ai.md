# Native Settings: groups, Create a workspace, Ask Foli AI search

- Date: 2026-11-28 07:26 UTC
- Area: mac
- Branch: claude/native-port-1128

Today's web Settings changes on the Mac, iPad and iPhone.

- Groups: "You" is now Account, Security, App and Data (`MacSettingsModel.groups`, `PhoneSettingsList.groups`). The Mac window keeps General alone at the top with no heading; Desktop app is not repeated under Data there. This device (App lock) moved from Security to Data, as on the web.
- Create a workspace: in Personal with workspaces available, a Workspace group with one plain row (Mac window and in-page nav: `FrameDialogs.newWorkspace`; iPhone: `host.newWorkspace()`).
- Search: the web's matching (most words, filler words left out) in `FoleviScreens/Settings/SettingsMatch.swift`, used by `SettingsSearch.results` and the iPhone. On the Mac a category whose whole name matches now comes first, and categories are ordered by their best match.
- Ask Foli AI: new engine command `ai.settingsSearch` (protocol revision 36, `commandsAi.ts`, fixture, Swift and Kotlin regenerated) calls `api.ai.settingsSearch` with the person's own key. Account mode with Foli AI on only; hidden in local mode. The row comes after the matches (first when none, so Return asks on the Mac); the answer shows Foli AI's mark, the sentence (errors muted) and the picks. The iPhone offers sections as options, the Mac its card entries.

Checked: `swift test --filter Settings` (14 passed), FoleviPhoneTests on the iPhone Simulator through a temporary scheme (34 passed), FoleviMac and FoleviPhone built for iOS Simulator, web `vitest run test/engine` (169 passed), engine codegen `--check` clean. Not checked by hand in the apps (no GUI driving); Return on the iPhone search field doesn't ask (touch the row).
