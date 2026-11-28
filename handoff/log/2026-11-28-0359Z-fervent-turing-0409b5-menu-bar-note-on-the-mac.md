# Menu bar note on the Mac (a real note under the menu bar icon, Drafts by default)

- Date: 2026-11-28 03:59 UTC
- Area: mac, web
- Branch: claude/fervent-turing-0409b5

The Mac menu bar icon and the global shortcut (⌥Space, Settings > General) now open a panel with one real Folevi note, in Folevi's own editor, after the owner's app Notlet. The owner first asked for Notlet-style local quick notes saved into Folevi later. The same day they changed it: "there will be no such thing as quick note, it will go to the draft by default, just like the main web app, and icloud sync should work". Then they chose one note in Folevi's editor, with no dots. This entry describes the second design. The first one (local SwiftData dots and a "Save to note" step) is only in the branch history.

What's in it:
- `apps/native-kit/Sources/FoleviMenuBarNote` (new package target, Mac only): the panel's chrome, taken from Notlet. It is a non-activating Liquid Glass panel under the icon, resizable from any edge, with four sizes. Pin on top is ⇧⌘P, open as a window is ⌥⌘D. Screenshots go into the note through Notlet's permission-free picker route (⇧⌘5 or the camera button); large ones are kept as JPEG, not HEIC. The bar shows where new notes go, then New (⌘N), Screenshot, Pin, Window and "…". Type sizes and icons follow Folevi's rules (Instrument Sans, the web's line icons at 1.5 pt). Reduce Transparency, Increase Contrast and Reduce Motion fall back as in Notlet.
- The note is the "Float this note" page without its bar: `/float/<id>?panel=1`, in a web view of the open place, made the first time the panel opens (`apps/mac/Folevi/Chrome/MenuBarNoteHost.swift`, role `.float`). It's a real note, so it syncs like any other (account, or an iCloud or "On this Mac" library) and is end-to-end encrypted where its space is.
- The empty page, `/float/new?panel=1&space=&folder=` (`apps/web/src/components/app/MenuBarNote.tsx`), makes the note through the engine on the first keystroke, the same way New note does. What was typed becomes its title, and the page moves to the note with the caret after it (`DocumentView`'s `?new=typed`: focus without selecting). New starts another empty page. The note shown is remembered per place.
- Where new notes go is always in the bar: Personal or a team workspace, then Drafts (the default) or a folder, with sub-folders indented. It's picked from a menu and remembered per place. Read-only workspaces can't be picked, and a folder that's gone falls back to Personal › Drafts. The panel's page answers `menu-note-destinations` with the spaces and folders.
- A screenshot goes into the note as a paste would (`menu-note-image`, `pasteImage` in `lib/desktop/menuBarNote.ts`), so the editor uploads it with the note.
- The "…" menu holds the panel's actions, then today's menu bar items: Quick Add Task, New Note, Search, Recent Notes, Places, Open Folevi, Settings, Quit. Right-click or Control-click on the icon still shows the old menu. File > Menu Bar Note shows the shortcut.
- The panel's keys: its own shortcuts and the editing ones (Cut, Copy, Paste, Undo, Redo, Select All, Find; ⌘W hides). Folevi's page commands (⌘T, Close Tab) don't act on a window behind it.
- Settings > General (native and web), on the Mac: the shortcut card is "Menu bar note". Windows and Linux keep Quick Add. `docs/DESKTOP_PARITY.md`: menu bar note, Mac only.

Checked (headless, nothing driven in the owner's session):
- `swift test --filter FoleviMenuBarNoteTests`: 16 tests pass.
  - Covered: the pages (empty page with its destination, note paths); the note made by typing kept per place and across launches; New; Open in Folevi; destination defaults, memory and fallbacks; both menus; the keys; pin.
  - Panel pictures, light and dark, in `Tests/FoleviMenuBarNoteTests/__Snapshots__`. They are drawn offscreen in Reduce Transparency's solid look with a stand-in for the web view.
  - `SettingsWindowTests` pass.
- `apps/web` `test/desktop-menu-bar-note.test.ts`: 6 tests pass (folder tree, spaces, the empty page's target, panel mode, the screenshot paste). `tsc --noEmit` and eslint are clean on the changed files.
- `node apps/mac/scripts/build.mjs`: the Debug app builds.

Not done or not checked:
- Nobody has opened the panel in the running app. Not tried: a click on the icon, ⌥Space, typing on the empty page against the dev deployment, a screenshot pasted in WebKit, VoiceOver or Reduce Motion in the app.
- Keys typed in the moment between the first keystroke and the note's editor taking the keyboard may be lost (the editor's code is fetched while the empty page waits, so this should be rare).
- If the note shown is deleted elsewhere, the panel shows the float page's "not found" until New is pressed.
- Differs from Notlet: one note, no dots. Folevi's editor (Markdown shortcuts as you type) replaces Notlet's, so there's no plain-Markdown mode (⇧⌘T). Also left out: the widget, Shortcuts, Services, Apple Notes and backups. The menu bar icon stays Folevi's "F".
- The marketing site still says "Quick Add from any app" for the Mac: for the Landing Page session.
