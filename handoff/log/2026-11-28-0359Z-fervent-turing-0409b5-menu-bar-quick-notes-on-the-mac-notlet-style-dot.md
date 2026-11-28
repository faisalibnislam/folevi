# Menu bar quick notes on the Mac (Notlet-style dots, Save to note)

- Date: 2026-11-28 03:59 UTC
- Area: mac
- Branch: claude/fervent-turing-0409b5

The Mac menu bar icon and the global shortcut (⌥Space, Settings > General) now open quick notes, built from the owner's app Notlet (owner decisions, 2026-11-28): a Liquid Glass panel under the icon with a row of coloured dots, each a quick note kept on this Mac.

What's in it:
- New package target `apps/native-kit/Sources/FoleviQuickNotes` (Notlet's editor, Markdown codec, smart bullets, screenshot route, panel and dot bar, made Folevi's: Instrument Sans and the web's line icons at 1.5 pt, Folevi copy, no Notlet branding). Store: SwiftData in the build's own support folder (`Quick Notes/QuickNotes.store`), never iCloud.
- Dots: new (⌘N), rename (⌘R, double-click), colour, delete with Undo, drag or ⌥⌘[ ⌥⌘] to reorder, ⌘1 to ⌘9 and ⌘[ ⌘] to switch, at most 20.
- Rich text with smart bullets and checklists, or Markdown (⇧⌘T). Italic in Instrument Sans is an oblique of the face (the font has no italic file; the web slants it too).
- Screenshots into the current dot (camera button, ⇧⌘5, right-click): Notlet's permission-free picker route. Large images are kept as JPEG instead of Notlet's HEIC so every browser shows them.
- Pin on top (⇧⌘P), open as a window (⌥⌘D), four sizes, resizable from any edge.
- Save to note (⌘S, the button): a new Folevi note, first line the title, the rest Markdown, images uploaded with it, in the chosen destination; then the dot empties. The toast has Open and Undo (Undo puts the text back and sends the note to the Trash). A failed save keeps the text.
- Destination always shown in the bottom bar: Personal or a team workspace, Drafts or a folder (sub-folders indented), picked from a menu, remembered per place. Read-only workspaces can't be picked; a folder that's gone falls back to Personal › Drafts.
- The "…" menu has the panel's actions, then today's menu bar items (Quick Add Task, New Note, Search, Recent Notes, Places, Open Folevi, Settings, Quit). Right-click or Control-click on the menu bar icon still shows the old menu. File > Quick Notes shows the shortcut.
- The Mac app talks to the open place's page with three new capability commands (`quick-note-destinations`, `quick-note-save`, `quick-note-unsave`, answered in `apps/web/src/components/app/DesktopCapabilities.tsx` with `lib/desktop/quickNotes.ts`: `imports.importText` as Markdown with an `imageMap`, `uploadFileNow` for images, `documents.bulkUpdate` trash for Undo).
- Settings > General (native and web): on the Mac the shortcut card is "Quick notes"; Windows and Linux keep Quick Add. `docs/DESKTOP_PARITY.md`: menu bar quick notes, Mac only.
- Keys in the panel: only its own shortcuts and the editing ones (Cut, Copy, Paste, Undo, Redo, Select All, Find, ⌘W hides) reach the text; Folevi's page commands (⌘T, ⌘W Close Tab) don't act on a window behind it.

Checked (headless, nothing driven in the owner's session):
- `swift test --filter FoleviQuickNotesTests`: 43 tests (Notlet's 22 Markdown, RTF and smart bullet tests, ported; Save to note and Undo, a failed save, images in the payload, the destination per place and its fallbacks, the destination menu, the panel menu, the keys, dots, the 20 cap, rich and Markdown switching, pin) pass. Panel pictures light and dark in `Tests/FoleviQuickNotesTests/__Snapshots__` (drawn offscreen in Reduce Transparency's solid look: a bitmap of the view can't show the window server's glass).
- `apps/web`: `test/desktop-quick-notes.test.ts` (7 tests: folder tree, spaces, checks, the save with uploads, Drafts and Untitled, and that the editor's Markdown becomes paragraph, bullet, task, divider and image blocks); `tsc --noEmit` and eslint on the changed files clean.
- `node apps/mac/scripts/build.mjs`: the Debug app builds.

Not done or not checked:
- Nobody has opened the panel in the running app: no click on the menu bar icon, no ⌥Space, no real save against the dev Convex deployment, no screenshot, VoiceOver or Reduce Motion pass in the app. The save path is covered by the unit tests on both sides, not end to end.
- Sync between the owner's Macs (Notlet's iCloud): not on. It needs an iCloud container on the Mac's provisioning profile (manual signing with a committed profile); the models keep CloudKit's rules so it can be turned on.
- Encrypted workspaces: `imports.importText` refuses them; the save says to open Folevi instead.
- Differs from Notlet (by decision or left out): no widget, Shortcuts actions, Services, Apple Notes, backups, sync, onboarding, What's New, custom colours or the panel prewarm; the menu bar icon stays Folevi's "F" (no active-dot colour); the destination bar never auto-hides; the "…" menu is an AppKit menu.
- The marketing site still says "Quick Add from any app" for the Mac (`(marketing)/mac`, `apps`, docs shortcuts page): for the Landing Page session.
