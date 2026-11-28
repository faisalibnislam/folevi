# Columns layout for note lists on the web

- Date: 2026-11-28 02:31 UTC
- Area: web
- Branch: claude/apple-notes-layout

What changed: an optional columns layout for every note list on the web (All notes, Drafts, Bookmarks, folders,
tags, Archive, Trash; not Templates), asked for by the owner on 2026-11-28. Design and decisions:
`docs/NOTE_COLUMNS.md`. The top bar's new button (next to New note) and Settings > Appearance > Note lists switch it;
both write `folevi:note-columns`. The column (`components/views/NoteColumns.tsx`) draws DocumentBrowser's own list
data, so selection, menus, drag to folders, filter, sort, Empty Trash and the folder's Share and "..." are the same
code as the cards. The note on the right is RouteView's real note page. Addresses are `/d/<id>?list=<list path>`;
`lib/app/tabs.tsx` treats them as the list's page, so the list keeps one tab. Pure logic (groups, address, memory,
arrow keys) is in `lib/app/noteColumns.ts`.

⌘-click on a row selects, as in every list today (the owner chose this over opening a tab, 2026-11-28);
middle-click and the row menu's Open in New Tab open one. A folder's subfolders don't show in the column (the
sidebar has them). Below 900 px wide the cards come back.

Checked: in the browser pane at 1440x900 on dev Convex (app.localhost:3042): toggle on and off both ways, All notes,
Drafts, a folder, an empty folder, Archive, Bookmarks (empty), Trash (Restore moved the column to the next note),
click and arrow keys, Back, reload, Pinned after bookmarking, filter, ⌘-click multi-select and its bar, the context
menu, New note in a folder (made there, opened in the column, same tab), Move to Trash of the last note (empty
state), ⌘⌥L, Settings card, light and dark, 860 px fallback. `test/note-columns.test.ts` (14 tests), the full web
suite (285 files passed), `tsc --noEmit`, eslint on the changed files (no errors).

Left: drag and drop from the column to a sidebar folder was not tried by hand (same handlers as the cards); a tag
list wasn't tried (no tags in the dev account); Windows and Linux apps not run; Mac and iPad plan in
`handoff/state/web.md`.
