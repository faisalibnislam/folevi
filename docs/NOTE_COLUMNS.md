# Columns layout (sidebar, note list, note)

An optional layout beside today's cards and rows: the sidebar, a column of a list's notes (Apple Notes-style
rows), and the open note. Asked for by the owner on 28 November 2026. The web app has it first (Windows and Linux
get it with the web app); the Mac and iPad mirror it later (plan in `handoff/state/web.md`).

## The decisions it follows (owner, 2026-11-28)

- Layout in the Sidebar menu (the panel button by the bell) has two choices, Cards and rows and Columns, on every
  page. Settings > Appearance > Note lists is the same choice; both write one preference.
- Once Columns is chosen the app stays in it everywhere: every note opens in a list's column, wherever it was
  opened from (Search and ⌘K, Home, a link in a note, a bookmark, New note). It goes in its folder's column, else
  Drafts (Trash or Archive while it's there); a note shared with you goes in Shared with Me. A nested page shows in
  its top note's folder column, with the top note's row marked. Templates are the one kind of note that opens on its
  own page (they're in no note list).
- No tab bar in Columns: no tabs at all, like Apple Notes. New note is the pencil button to the right of the Search
  box (⌘⌥N too); Back and Forward are ⌘[ ⌘] and the browser's own. With the sidebar hidden, its menu and New note
  sit at the top of the note column, or float at the top left of a page without one (Home, Tasks, Settings). The
  tabs saved before stay untouched and come back when Cards and rows is chosen again. "Open in new tab(s)" isn't
  offered in the column's menus or its selection bar.
- Every note list has a column: All notes, Drafts, Bookmarks, folders and subfolders, tags, Archive, Trash, the
  Folders page (every note that's in a folder, with its folder under it) and Shared with Me (with the shared folders
  and Vault items above and below its notes). A folder's column has its own notes only, as in Apple Notes; its
  subfolders open from the sidebar. Home, Tasks, Calendar, Settings, Foli AI and the rest keep their pages.
- Rows: serif title, then the date and the note's first line, then its folder. Grouped under Pinned, Today,
  Yesterday, Previous 7 days, Previous 30 days, then by month (a month name this year, "October 2025" before).
  Pinned is the list's bookmarked notes; no new pin feature. Bookmarks itself has no Pinned group (all are).
  Sorted by title or by hand, there are no date groups (Pinned still leads).
- Picking a note swaps the note in place. ⌘-click selects, as in every list (the owner's choice). A list opens on
  its last note, or its most recently edited one.
- The middle column is always there: it can be resized (width remembered), never hidden (the owner, 2026-11-28),
  at any window width; the phone layout keeps its own screens. Its head is the list's name, count, filter and Sort
  (and Empty Trash in Trash); a folder's options, Share among them, are its right-click menu in the sidebar.
- Notes joined side by side keep their panes, with the column beside them.

## Where state lives

| What | Where |
| --- | --- |
| The layout preference | `localStorage` `folevi:note-columns` (`true`/`false`), per device, like Grid/Compact/List |
| The last note of each list | `localStorage` `folevi:note-columns:last`, `{ "<scope>|<list path>": noteId }`, newest 200 |
| Column width | `localStorage` `folevi:note-columns:width` (px) |

## The address

A note open in a list is `/d/<note id>?list=<list path>`, for example `/d/01JX…?list=%2Ffolders%2Fabc`. The route
stays the note's, so everything that keys off the open note (the note page, Foli AI's context, the inspector,
comments, sharing, the Mac and desktop bridges, ⌘K) works unchanged. `list` is the list's own path (`/notes`,
`/drafts`, `/starred`, `/archive`, `/trash`, `/folders`, `/folders/<id>`, `/tags/<id>`, `/shared`); anything else is
ignored.

- A list's own address (`/folders/abc`) shows the column and replaces itself with its last note's address once the
  list has loaded; an empty list stays on the list's address with an empty note pane.
- A plain `/d/<id>` with Columns on: `useColumnsInfo` (`lib/app/useNoteColumns.ts`) works out its list from the
  note's details (`listForNote` in `lib/app/noteColumns.ts`) and the address gets `?list=` in place, its other
  fields kept. While the details are on their way (online) the note's placeholder shows; offline, or for a note the
  server doesn't have yet, the note shows on its own. New note goes straight to its column's address.
- A click pushes a history entry (Back goes to the note before); arrow keys and the automatic choice replace it.
- Turning Columns off on a note in a column goes to the list's own page (and the tab bar comes back).
