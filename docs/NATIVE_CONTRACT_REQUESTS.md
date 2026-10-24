# Native contract requests

Additions native builders need in `apps/web/src/lib/engine/protocol.ts` (owned by the web bridge builder, N2/N16).
Append entries; don't edit protocol.ts from a native package. Each entry names who needs it, the exact TypeScript to
add, and the Swift stand-in used until `pnpm engine:gen` produces the generated spec (delete the stand-in then).

Status values: **open**, **added** (in protocol.ts, regenerate), **declined** (with why).

---

## N7 Home and lists (2026-10-24)

Stand-ins live in `apps/native-kit/Sources/FoleviScreens/Core/PendingContract.swift` with the same names and shapes.
Each command replies once the change is applied on this device (queued if offline), like the existing ones.

### R7.0 Codegen: always encode `T | null` fields (bug) **added** (revision 4: the codegen writes `encode(to:)` with `encode` for required `T | null` fields, `encodeIfPresent` only for `?` fields)

`NoteMoveArgs.folderId` is `string | null` (required). The generated Swift struct uses synthesized `Codable`, which
encodes a nil optional with `encodeIfPresent`, so `note.move` to Drafts sends no `folderId` and the engine refuses it
(`folderId must be a folder id or null.`). Fix in `scripts/engine-codegen.mjs`: for a required `T | null` field emit an
`encode(to:)` that calls `encode(_:forKey:)` (writes `null`); keep `encodeIfPresent` only for `?` fields. Until then N7
sends `note.move` through `PendingCommands.NoteMove` (`NoteMoveExplicitArgs`). Other affected args today:
`ToastUndo`-style records are fine; check `NoteCreateArgs` (`folderId?: string | null`, optional so fine).

### R7.1 NoteRow: `deletedAt` **added** (revision 4)

Trash shows "Deleted 2 days ago" (web `DocumentBrowser` uses `deletedAt`). Add to `NoteRow`:

```ts
  /** When it went to Trash (milliseconds since 1970), or null when it isn't in Trash. */
  deletedAt: number | null;
```

Stand-in: native uses `updatedAt` for the Trash time until then.

### R7.2 Commands for notes **added** (revision 4; `NoteReorderArgs` also takes `space?`, `NoteCopyToArgs` also takes `folderId?`, `TemplateCreateArgs` also takes `open?`, `TrashEmptyResult` also has `continuing`, since `documents.emptyTrash` empties a very full Trash in the background)

```ts
export interface NoteReorderArgs {
  id: string;
  /** The note it goes right after in manual order; null: first. */
  afterId: string | null;
  view: NotesListView;
  folderId?: string;
}
export interface NoteCopyToArgs { ids: string[]; space: SpaceRef }
export interface TemplateCreateArgs { space?: SpaceRef; title?: string }

// CommandMap
"note.deleteForever": { args: NoteIdsArgs; result: BulkResult };      // documents.bulkUpdate { kind: "delete" }
"note.duplicate": { args: NoteIdArgs; result: NoteCreateResult };     // documents.duplicate
"note.copyTo": { args: NoteCopyToArgs; result: BulkResult };          // CopyToDialog's path
"note.reorder": { args: NoteReorderArgs; result: OkResult };          // documents.reorder (manual sort, Move up/down)
"note.showInRecent": { args: NoteIdsArgs; result: HiddenResult };     // documents.showInRecent (Undo of hideFromRecent)
"template.create": { args: TemplateCreateArgs; result: NoteCreateResult }; // createDocument({ kind: "template" })
"trash.empty": { args: SpaceArgs; result: TrashEmptyResult };         // documents.emptyTrash
export interface TrashEmptyResult { deleted: number; skipped: number }
```

### R7.3 Commands for folders (through the outbox, like `folder.create`) **added** (revision 4; `folder.move` refuses with `folder_self`, `folder_descendant`, `folder_depth`, and takes `space?` for the check)

```ts
export interface FolderRenameArgs { id: string; name: string }
export interface FolderSetColorArgs { id: string; /** folder colour key, null = default */ color: string | null }
export interface FolderMoveArgs {
  id: string;
  /** New parent; null: the top level. */
  parentId: string | null;
  /** The sibling it goes right after; null: first among its new siblings (organization.moveFolder afterFolderId). */
  afterId: string | null;
}
export interface FolderIdArgs { id: string }

"folder.rename": { args: FolderRenameArgs; result: OkResult };
"folder.setColor": { args: FolderSetColorArgs; result: OkResult };
"folder.move": { args: FolderMoveArgs; result: OkResult };   // nesting, un-nesting and reordering (folderDrop.ts)
"folder.delete": { args: FolderIdArgs; result: OkResult };   // notes move to Drafts, subfolders up a level
```

The engine should refuse what `folderMoveProblem` refuses with codes `folder_self`, `folder_descendant`,
`folder_depth` (native checks the same rules first, `FolderRules.swift`).

### R7.4 Views **added** (revision 4)

```ts
export interface TrashSummaryValue { total: number; deletable: number }
export interface BuiltInTemplate { key: string; name: string; description: string; icon: string }
export interface BuiltInTemplatesValue { templates: BuiltInTemplate[] }
export interface FolderCardsArgs { space?: SpaceRef; parentId?: string | null }
export interface FolderCardsValue { folders: FolderCard[] }

// ViewMap
"trash.summary": { args: SpaceArgs; value: TrashSummaryValue };          // documents.trashSummary (Empty Trash text)
"templates.builtIn": { args: EmptyArgs; value: BuiltInTemplatesValue };  // settings.builtInTemplates
"folders.cards": { args: FolderCardsArgs; value: FolderCardsValue };     // a folder's subfolders as cards (with previews)
```

`folders.cards` lets a folder's screen draw its subfolders with the same peeking previews and update times Home's
cards have (Home's `folders` are top level only). Without it native draws them from `folders.tree` (no previews).

### R7.5 Shared with Me and Changes **added** (revision 4) with two differences: `shared.list` is a value view `{ rows: SharedRow[] }` (only note lists are windowed; `ListDiff.upsert` carries `NoteRow`), and `SharedRow` also has `sharedAt` and `encrypted`; `ProposalRow.noteId` is `string | null` (null when the note can't be opened any more) and `ChangedNoteRow` also has `icon`

```ts
export interface SharedRow {
  id: string; title: string; excerpt: string; icon: string | null;
  sharedBy: string;
  /** The workspace it lives in, or null for someone's Personal. */
  workspaceName: string | null;
  ownerName: string | null;
  /** "editor", "commenter" or "viewer" (open). */
  role: string;
  updatedAt: number;
  h: string;
}
// ListViewMap
"shared.list": { args: EmptyArgs; row: SharedRow };   // sharing.sharedWithMe

export interface ProposalRow {
  id: string; noteId: string; title: string; sourceName: string;
  /** The added lines as plain text for the row's preview. */
  summary: string;
  createdAt: number;
  /** Why it can't be accepted any more (only Reject is offered), or null. */
  problem: string | null;
}
export interface ChangedNoteRow {
  id: string; title: string;
  /** whoChanged(): "Maya and Foli AI". */
  who: string;
  /** changeCounts(): "3 added, 1 removed". */
  counts: string;
  changedAt: number;
}
export interface ChangesValue { proposals: ProposalRow[]; notes: ChangedNoteRow[] }
// ViewMap
changes: { args: EmptyArgs; value: ChangesValue };   // changes.list + proposals.list
// CommandMap
"changes.markSeen": { args: NoteIdsArgs; result: OkResult };
"proposal.accept": { args: { id: string }; result: OkResult };
"proposal.reject": { args: { id: string }; result: OkResult };
```

### R7.6 Home: Graph availability **added** (revision 4, `Capabilities.graph`)

Home's "…" menu offers Graph when `aiGraph.graph` can be called (`useCanCall`). Add to `Capabilities`:

```ts
  /** The Graph view is available (Foli AI's graph). */
  graph: boolean;
```

Until then native leaves Graph out of Home's menu.

### R7.7 notes.list: server-side filter (optional) **added** (revision 4: the engine loads up to 5,000 notes of the list and filters them, so matches outside the window are found)

The filter field narrows the loaded window only, as the web does. For big libraries a server-side filter would find
rows outside the window:

```ts
export interface NotesListArgs { /* ... */ /** Case-insensitive title and excerpt filter. */ filter?: string }
```

---

## N8 Mac frame (from `apps/native-kit/Sources/FoleviMac/Model/PendingContract.swift`, 2026-10-24)

Filed by the web bridge builder from the Mac frame's stand-ins, so they're on record here.

### R8.1 `note.move` with `folderId` always sent **added** (revision 4, the codegen fix R7.0)

### R8.2 `folder.move { id, parentId, afterId }` **added** (revision 4, R7.3)

### R8.3 `notifications.list` and `notification.markRead { ids, read }` **added** (revision 4)

`NotificationRow` has the stand-in's fields (`body` is `""` when there's none) plus `actorName`, `actorAvatarUrl`,
`noteId`, `noteTitle`, `count`, `inviteId`, `pageInviteId` and `fileId`. Also added: `notification.markAllRead`,
`notification.remove`, `invite.accept`, `pageInvite.accept`.

### R8.4 `search { text, scope }` **added** (revision 4)

`scope` is `"place" | "everywhere"` as in the stand-in. `SearchArgs` also takes `space`, `folderId`, `tagId`,
`updatedAfter`, `includeArchived`, `meaning` and `limit`; `SearchHit` also has `archived`, `kind`, `space`,
`spaceName`, `matchIn` ("text", "file", "meaning"), `blockId` and `page`; `SearchValue` also has `text` and
`meaningAvailable`. It works as a one-off `query` (debounced) or as a live view.
