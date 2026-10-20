# Synced blocks

One piece of content shown in several notes, like Notion's synced blocks: editing it in any of them changes it
in all of them. Built 2026-10-20.

## Model

- **Synced content** is a document of its own with `kind: "synced"`, in a Personal or a team workspace (its
  place), holding ordinary blocks. It's never a page: it has no title, parent or folder, isn't listed (lists
  filter by kind), its search text is empty, it isn't indexed for Foli AI on its own, and it isn't counted as
  a note. Opening `/d/<its id>` (a task's link, a mention, a search hit on a file in it) goes to the first note
  showing it that the person can open (`synced.home`, `components/editor/synced/SyncedRedirect.tsx`).
- **A synced block** (`type: "synced"`, `props.sourceId` = the content's public id, no text) sits in a note and
  shows that content. The backlink index records it as a link to the content (`convex/lib/syncEngine.ts`
  `syncLinks`), which is how the notes showing a piece of content are found (`convex/lib/syncedRefs.ts`). A
  page link that merely names the id never counts: each reference is checked against the block itself.
- Schema: `packages/editor-schema` spec (`synced` block, `DocumentKind` `synced`), `validateWireBlock` (a valid
  `sourceId`), `src/synced.ts` (`expandSyncedBlocks`, `syncedSourceIds`).

## Editing and sync

Everything goes through the sync engine's one queue, so it works offline and syncs in order when the
connection is back:

- **Turn into synced block** (block menu): `document.create` (kind `synced`, in the note's place), the lines as
  new blocks of it, then the note's flush replaces them with one synced block. One undo step in the note.
- **Synced block** (slash menu, Insert panel): new content with one empty line; the caret goes into it.
- **Copy synced block** (its menu, or the block menu): the synced block goes on the clipboard as a block
  (`blockClipboard.ts`); pasting it into another note adds a reference to the same content.
- **Unsync** (its menu, or the block menu): this note's synced block becomes ordinary lines with what it shows
  now (files in them get rows of the note, as pasted blocks do). The other notes stay synced.

In the editor, the synced block is an atom whose view (`components/editor/synced/SyncedView.tsx`) runs the
note editor (`Editor.tsx`) on the content's id, with its own menus, undo and block handles. Its blocks are
loaded and followed live like a note's (`blocks.list`, then `blocks.changes`) and kept on the device for
offline reloads. The note's editor leaves the nested editor's events alone (`synced/nested.ts`,
`inBlockField`, the block handle and the context menu). A synced block never goes inside synced content (the
server refuses it).

The frame shows "Synced, in N notes" with a menu: the other notes (those the person can open by name, the rest
counted), Copy synced block, Unsync, Remove from this note.

## Who sees and edits it

Decided on the server in `convex/lib/auth.ts` `documentAccessInfo`:

- The place's owner and admins (and a Personal's owner) manage it; its creator, while still a member, too.
- Anyone else gets the access they have to a note **in the same place** that shows it (read, comment or edit;
  never more than edit). So a guest who can view a note sees its synced content read-only, a guest who can edit
  it can edit it, and a restricted note's synced content stays with the people who can open that note.
- Workspace members don't get it just for being members (it counts as restricted, also in `PageReader`).
- A note in **another place** shows it only to people who can open it as above. Everyone else sees
  "You don't have access to this synced block".
- Writing a synced block into a note needs read access to its content (`SyncEngine.checkSyncedBlock`): an id
  alone opens nothing, and nobody can show content they can't read to a note's readers.

## Share pages, search, exports, Foli AI and MCP

- **Public share pages** show synced content only when it's in the note's own place (exactly the people who can
  read that note can read it), with its files. Content from another place is left out, never shown to the
  public: a public note in your Personal showing a workspace's synced block doesn't publish the workspace's text.
- **Search text, card previews and the semantic index** of a note include synced content from its own place
  (`withSyncedShared`), for the same reason; editing the content refreshes the notes showing it.
- **Exports** (a note's Markdown, HTML and PDF, and the workspace ZIP), **Foli AI** (the note it reads, its read
  tools) and **MCP** (`get_note`, note resources) read the content in place, as far as that person can see it
  (`withSyncedForReader`). Its blocks have ids of their own there (`<synced block id>_<block id>`): Foli AI can
  read them, not edit them through the note.
- Version history keeps the synced block itself; a version shows it as "Synced block" (it shows its current
  content in the note). The content has its own versions like any document.

## Deleting

When no note outside Trash shows it any more (its last synced block deleted or unsynced, or its notes moved to
Trash), the content goes to Trash with nothing removed. It isn't listed there (it isn't a page). A reference
coming back (Undo, a version restored, a note restored from Trash, a duplicate) brings it back. Trash retention
(30 days) or emptying Trash deletes it for good, like a page; a synced block left pointing at it then says
"This synced block was deleted".

## Known limits

- Images and files inside synced content aren't copied into the workspace ZIP export's assets (the
  note's Markdown export does include them).
- Pasting a synced block into another app gives no text (inside Folevi it pastes as the block).
- To-dos inside synced content are tasks of the content; their links open the first note showing it.
- The status popover lists unsynced edits to synced content as "Untitled".
