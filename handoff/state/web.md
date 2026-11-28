# Web app and website (`apps/web`)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- Home is a customizable dashboard (2026-11-28): design version 19: the greeting, the Foli AI summary (only while Foli AI is on) and the capture field, then sections (Recent notes, Bookmarks, Today and My tasks beside Foli DNA, Recent folders; Shared with me, Pinned note and Templates to add) that Customize moves, removes and adds, saved per person in `convex/homePrefs.ts` (`apps/web/src/lib/app/homeLayout.ts`, `HomeBlocks.tsx`, `HomeSummary.tsx`, `HomeLists.tsx`).

- Live at folevi.com and app.folevi.com from `main`; the sign-in page offers "Sign in to your own server", and `/downloads` lists every download.
- Closing a dialog or the command palette: the dialog closes first and its picture fades as an inert popover (`components/ui/closing.ts`), so the page takes the keyboard back at once.
- iPhone and Android swipe rows (`components/iphone/Swipe.tsx`) run on Pointer Events and close on a touch outside their list.
- Float this note shipped in 1.7.78 (`components/app/FloatNote.tsx`); the note's colour edge to edge (PR 135) merged after that release and is live on the web, not yet in a released app.
- One control scale (PR 141, docs/DESIGN_SYSTEM.md "Controls"): every row control is 36 px (44 on touch), compact 28; one corner, edge, weight and icon. `Button` sizes `md`/`compact`/`icon`/`icon-compact` (no `sm`). Enforced by ESLint `folevi/control-scale` and `e2e/control-scale.spec.ts`.
- Spell check, suggestions and next-word prediction (PR 143, `docs/SPELLING_PLAN.md`): Hunspell WebAssembly in a worker, 10 languages per line. A line too short to tell its language is checked in the person's English and the note's language, wrong only when both say so (the owner saw English checked as Portuguese, 2026-11-26).
- CI's e2e suite is 8 shards on 2-CPU runners; `e2e/tab-switch.spec.ts` timed out once on 2026-11-25 and passed on a re-run.

- Spell check, suggestions and next-word prediction on Tab (PR 143, released in 1.8.78): Folevi's own checker in a worker, nine spelling languages plus Chinese prediction, the personal dictionary synced, Foli AI completions only when Foli AI is on and never for encrypted notes. The ghost word is CSS (`data-ghost`), never part of the text.
- Columns layout (PR for branch `claude/apple-notes-layout`, 2026-11-28, `docs/NOTE_COLUMNS.md`): an optional Apple Notes-style layout. Once chosen it holds everywhere: every note opens in a list's column (its folder's, Drafts, Trash, Archive or Shared with Me; nested pages in their top note's), there is no tab bar or tabs (New note is beside Search), and the Folders page lists every note in a folder. The sidebar, a column of the list's notes (serif title, time and first line, folder; Pinned for the list's bookmarks, then Today, Yesterday, Previous 7 days, Previous 30 days, months) and the real note page. Switched with Layout in the Sidebar menu or Settings > Appearance > Note lists (one `localStorage` preference per device). A note in a list is `/d/<id>?list=<list path>`; a plain `/d/<id>` gets its list from the note's details. Saved tabs are left alone while it's on. The note list is always shown (resizable, never hidden); off in the phone layout and in the native apps' chrome.
- Sidebar More and Customize sidebar (2026-11-27, `lib/app/sidebarLayout.ts`, `convex/sidebarLayout.ts`): the app's own items follow a per-account layout; Shared with Me, Changes and Templates start under More; Home and Drafts always on the sidebar. Web, Windows and Linux only: the native Mac, iPhone/iPad and Android sidebars don't have it yet.
- One shadow hierarchy (2026-11-28, `docs/SHADOWS.md`): an edge plus a level (`raised`, `resting`, `lifted`, `floating`, `overlay`) from the tokens, on the web and native. `test/shadow-scale.test.ts` fails on raw drop shadows.

## Next steps
- Columns layout: try it in the Windows and Linux app. ⌘-click in the column selects, as in every list (owner, 2026-11-28); middle-click and Open in New Tab open a tab.
- Columns layout on the Mac and iPad (not built; mirror the web, docs/NOTE_COLUMNS.md):
  - Mac (`apps/mac`, AppKit + `apps/native-kit`): an `NSSplitViewController` item between the sidebar and the note's WKWebView, holding a native note list (an `NSTableView` or SwiftUI `List`) with the same row (serif title, Footnote time and first line, folder badge) and the same groups (port `groupNotes` and `dateGroup` from `lib/app/noteColumns.ts`, with their tests). The note stays the web editor, swapped in place. Read `folevi:note-columns` from the Mac's own settings, put Layout (Cards and rows, Columns) in the sidebar's menu, hide the tab strip while Columns is on (New note beside Search), keep the list always shown and remember its width in `UserDefaults`, and keep the last note per list with the same key (`<scope>|<list path>`). The web page's columns are off in native chrome (`nativeChrome()` in `useNoteColumnsActive`), so nothing doubles up.
  - iPad (`apps/ios`, wide layout): `NavigationSplitView` with three columns (sidebar, content list, detail note), the same rows and groups, the content column always shown; on iPhone and narrow iPad windows it stays today's stack. Same preference key, synced as the other appearance settings are.
  - Both: Pinned is the list's bookmarked notes; the context menu, multi-select, drag to a folder and New note in the list work as on the web; Trash shows the deleted time.

- Shadows: PR 190's Home shadows go onto the levels when it merges `main` (`docs/SHADOWS.md`, Not done yet).
- Spell check and prediction: not yet tried in the native builds (Mac, iPhone, Windows) or on devices.

- Spell check: a native Settings row for Writing on the Mac and iPhone/iPad; try it in each app's build.
- Control scale: add Vault and Settings to `e2e/control-scale.spec.ts`; re-export the web's computed styles for the native Swift screens; drop `rounded-chip` from CollectionEmbed's page picker field after PR 137.
- Known gaps and failing specs listed before 2026-11-26 are in the archive's next steps; check each against `main` before trusting it.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
