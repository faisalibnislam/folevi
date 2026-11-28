# Menu bar note is Home's quick note (one plain box, Save)

- Date: 2026-11-28 06:15 UTC
- Area: mac,web
- Branch: claude/menu-bar-quick-note

The owner asked (2026-11-28, after PR 195 merged) for the menu bar note to be as simple as Home's quick note: "no title or body, it's just body". Their choices:
- Save as on Home: Save (or ⌘Return) makes the note and the box empties.
- A plain text box.
- The first line is the title.
- Kept: screenshots, Add as a task, pin and window mode, the destination picker.

What changed:
- **The panel** (`apps/native-kit/Sources/FoleviMenuBarNote/Panel/TopBar.swift`) is Home's `CaptureField`, drawn natively with the web's colours (WebStyles):
  - a plain box in the serif face at 20 pt, "What's on your mind?";
  - the screenshots as thumbnails with Remove;
  - "Saves to" with the place's mark (your avatar or the workspace's logo) and folder;
  - Add as a task (⇧⌘Return), Screenshot (⇧⌘5) and Save (⌘Return, the accent button);
  - Pin, Window and "…" at the top right.
  After a save, the toast offers Open and Undo; Undo puts the words back and sends the note to the Trash. A failed save keeps the words. What's written and not saved is kept per place, across closing the panel and quitting.
- **The note itself** is no longer shown in the panel. The Mac keeps a quiet page of the place (`/float/menu?panel=1`, never on screen, `apps/mac/Folevi/Chrome/MenuBarNoteHost.swift`). That page answers `menu-note-save`, `menu-note-task`, `menu-note-unsave` and `menu-note-destinations` (`apps/web/src/components/app/MenuBarNote.tsx`).
  - Save works as Home's does: `imports.importText`, with `noteFromText` for the title.
  - With screenshots, the text is escaped Markdown and the images are uploaded into the note.
- **Removed:**
  - web: the stand-in page, the empty-note cleanup, the paste-image route, `DocumentView`'s `?new=typed|body`, and the float page's menu-bar CSS;
  - native: New and Send to Folevi, which a quick box doesn't need.
- **Fixed:** PR 195's code never sent the avatar fields to the panel (an edit was blocked). The mark is in now.

Checked:
- **Native:** `swift test --filter FoleviMenuBarNoteTests` passed (14 tests, including the panel pictures light and dark). To run it, I had to move `FoleviDesignTests/CardShadowTests.swift` and `FoleviMacTests/NativeShadowTests.swift` aside: they don't compile on main after PR 196's shadow change. They're back untouched; reported to the PR manager.
- **Web:** `test/desktop-menu-bar-note.test.ts` (6 tests), plus `tsc` and eslint on the changed files.
- **Mac:** the Debug app builds and was relaunched for the owner.

Not checked:
- A real save against the dev deployment from the new panel.
- A screenshot saved into a note.
- VoiceOver.
