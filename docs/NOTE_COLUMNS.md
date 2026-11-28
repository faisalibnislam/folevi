# Columns layout (sidebar, note list, note)

An optional layout for every note list, beside today's cards and rows: the sidebar, a column of the list's notes
(Apple Notes-style rows), and the open note. Asked for by the owner on 28 November 2026. The web app has it first
(Windows and Linux get it with the web app); the Mac and iPad mirror it later (plan in `handoff/state/web.md`).

## The decisions it follows (owner, 2026-11-28)

- A top-bar toggle flips it at once; Settings > Appearance has the same choice. Both write one preference.
- Every note list: All notes, Drafts, Bookmarks, a folder, a tag, Archive, Trash. Home stays the dashboard.
  Templates keep today's layout (their built-in gallery and Use buttons don't fit a note column).
- Rows: serif title, then the date and the note's first line, then its folder. Grouped under Pinned, Today,
  Yesterday, Previous 7 days, Previous 30 days, then by month (a month name this year, "October 2025" before).
  Pinned is the list's bookmarked notes; no new pin feature. Bookmarks itself has no Pinned group (all are).
  Sorted by title or by hand, there are no date groups (Pinned still leads).
- Picking a note swaps the note in place in the same tab. Middle-click and the menu's Open in New Tab open a tab.
  ⌘-click selects, as it does in every list today (the owner chose this on 2026-11-28, over ⌘-click opening a tab).
  A list opens on its last note, or its most recently edited one.
- The middle column is resizable (width remembered) and collapsible (its own button and ⌘⌥L).
- Narrow windows (under 900 px wide) and the phone layout keep today's layout.

## Where state lives

| What | Where |
| --- | --- |
| The layout preference | `localStorage` `folevi:note-columns` (`true`/`false`), per device, like Grid/Compact/List |
| The last note of each list | `localStorage` `folevi:note-columns:last`, `{ "<scope>|<list path>": noteId }`, newest 200 |
| Column width, collapsed | `localStorage` `folevi:note-columns:width` (px), `folevi:note-columns:collapsed` |

## The address

A note open in a list is `/d/<note id>?list=<list path>`, for example `/d/01JX…?list=%2Ffolders%2Fabc`. The route
stays the note's, so everything that keys off the open note (the note page, Foli AI's context, the inspector,
comments, sharing, the Mac and desktop bridges, ⌘K) works unchanged. `list` is the list's own path (`/notes`,
`/drafts`, `/starred`, `/archive`, `/trash`, `/folders/<id>`, `/tags/<id>`); anything else is ignored.

- A list's own address (`/folders/abc`) with the layout on shows the column and replaces itself with its last note's
  address once the list has loaded; an empty list stays on the list's address with an empty note pane.
- A click pushes a history entry (Back goes to the note before); arrow keys and the automatic choice replace it.
- The tab: a columns address belongs to the list's tab (the folder tab, or the view's tab), named after the list.
  `lib/app/tabs.tsx` reads the address as the list's path, so the tab's link is the list's path and going back to
  the tab opens the list on the note it remembers.
- A plain `/d/<id>` (a link, ⌘K, the sidebar) is the note page as today, in its own tab.
- Turning the layout off on a columns address goes to the list's own page; turning it on on a list page opens the
  column there. With the layout off (or a narrow window) a columns address shows the note page.
