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

### R8.5 `note.create` with body text **added** (revision 8: `note.create { text, open? }`, the web's `noteFromText`, through `imports.importText`)

The Mac's Services menu, Shortcuts/App Intents and "New note with text" (`new-note-with-text`, the page's
DesktopBridge handled it) need a note made from text: `note.create { ..., text?: string }`, where the first line
becomes the title and the rest the body (the web's `newNoteFromText`). Until then a framed window can't answer
those app commands (they reach no page: DesktopBridge isn't rendered in native chrome mode).

### R8.6 notification actions from macOS banners **added** (revision 8: `notification.act { id, action, text?, thread? }` with the action ids Notifications.swift sends: `reply`, `read`, `done` (or `complete`), `snooze-hour`, `snooze-evening`, `snooze-tomorrow`; `open` stays native. A reply goes through the outbox; done and snooze change the reminder's task)

A banner's actions (`notification` app command: reply to a comment, mark done, snooze a reminder) went to the
page's DesktopBridge. Request: `notification.act { id, action, text? }` with the action names Notifications.swift
sends (`reply`, `done`, `snooze`, `open`). "Open" works natively now (the frame opens `path`).

### R8.7 moving or copying notes between places **added** (revision 8: `places.move.preview { to?, folders?, notes? }` lists the destinations with their `value`s, the counts, and `fits` (null: not known before the move); `places.move { to, folders?, notes?, copy, versions? }` runs it here with its progress as the `placeMove` gate, or replies `switched` when the library's page goes to the account to run it there)

The account menu's "Move or copy notes…" opened the web's MovePlaces dialog. Request: a view
`places.move.preview { to, folders?, notes? }` (counts, fits) and a command `places.move { to, folders, notes,
copy }` with progress through `gate.changed` `placeMove` (it already reports it). Until then the item opens
Settings > Data (takeout).

### R8.8 `note.meta` for the tab strip without showing the note **added** (revision 8: the value view `notes.meta { ids }`, up to 200, live)

Restored tabs show their saved titles; a note renamed elsewhere keeps its old title until it's shown. A list view
`notes.meta { ids }` (title, icon, inTrash per id), or `note.meta` answered from the device copy for notes not
open, would keep restored tabs current. (`query note.meta` works today for one id; the frame could poll, but a
batch is cheaper.)

### R8.9 web menu state in native chrome mode **added** (revision 8: editor commands `block.move { dir }`, `block.duplicate`, `focus.toggle`, `note.lock` (opens the note's Always fully encrypted dialog over the note); `editor.state` has `focus`, `locked` and `canLock`. As Cards / As List and Appearance are native's own: the list layout is native, appearance is `settings.update { appearance }`)

Menu items the page owned (View > Focus Mode, As Cards / As List, Appearance, Format > Move Block Up/Down,
Duplicate Block, Note > Lock) have no editor command and no state. Request editor commands `block.move { dir }`,
`block.duplicate`, `focus.toggle`, `note.lock`, and `editor.state` fields `focus` and `locked`.

---

## N7 follow-up and N9 folders (2026-10-24)

Stand-ins live in `apps/native-kit/Sources/FoleviScreens/Core/PendingContract.swift` with these names and shapes.

### R9.1 Folders "Always fully encrypted" **open**

The folder menu's lock item (web `useLockMenuItem` + `LockDialog`, docs/E2EE_DESIGN.md §10.8). The web shows it
only when the account has encryption keys (`LOCK_MENU_FOR_EVERYONE` is false) and the person may (Personal: its
owner; a workspace: owner and admins); the item is checked when the folder is locked.

```ts
// SpaceInfo
  /** "Always fully encrypted" is offered in this space's folder and note menus. */
  canLock: boolean;
  /** "standard" or "encrypted" (the space's level; the stop wording differs). */
  level: string;
// FolderNode and FolderCard
  /** Always fully encrypted. */
  locked: boolean;

export interface FolderLockArgs { id: string; locked: boolean }
// CommandMap: sets it, making the space's key first when the space has none (the web's e2ee_not_set_up retry)
"folder.lock": { args: FolderLockArgs; result: OkResult };
```

Stand-in: a value view `folders.locks { space? }` → `{ canLock: boolean; level: string; locked: string[] }` (the
locked folder ids), so native needn't wait for new fields on generated types; either shape works for native.

### R9.2 Changes: a note's block-by-block changes **open**

The Changes card's body (web `ChangesView` ChangeCard: `diffVersions` of the last-seen and current versions, drawn
with `ReadOnlyBlocks`). Native draws the blocks from text:

```ts
export interface ChangeDiffArgs { id: string }
export interface ChangeDiffBlock {
  id: string;
  /** "added", "removed", "changed" or "same" (unchanged blocks around changes, for context; at most 2 each side). */
  change: string;
  /** Block type as in PreviewLine.t ("paragraph", "heading", "todo", ...); `l` heading level, `c` checked. */
  t: string;
  x: string;
  l?: number;
  c?: boolean;
  /** "changed": the text before. */
  before?: string;
  /** Who made it (a person's name, an app, "Foli AI"), when known. */
  who?: string | null;
}
export interface ChangeDiffValue { id: string; title: string; blocks: ChangeDiffBlock[]; truncated: boolean }
// ViewMap
"changes.diff": { args: ChangeDiffArgs; value: ChangeDiffValue };
```

### R9.3 Every folder as a card **open**

All folders (web `OrganizeIndex` / iphone `Organize.tsx`) shows every folder, nested ones too, as cards with "in
Work / Clients". `folders.cards` gives one level. Add to `FolderCardsArgs`:

```ts
  /** Every folder of the space, in tree order (parentId is then ignored). */
  all?: boolean;
// FolderCard
  /** Where a nested folder is: its ancestors' names, "Work / Clients"; null at the top level. */
  path?: string | null;
  /** For All folders' "Newest" sort. */
  createdAt?: number;
```

Stand-in: native builds All folders from `folders.tree` (no previews) until then.

### R9.4 Generate a template (or a note) with Foli AI **open**

Templates' "Generate with Foli AI" (web `AiGenerateDialog`: `useAi().write("template" | "page", { instruction,
streamId })`, then `saveDraft(kind, title, text)`).

```ts
export interface AiGenerateArgs {
  kind: "template" | "note";
  instruction: string;
  space?: SpaceRef;
}
export interface AiGenerateResult { title: string; text: string /** Markdown */ }
export interface AiSaveDraftArgs { kind: "template" | "note"; title: string; text: string; space?: SpaceRef; folderId?: string | null }
// CommandMap ("no_credits" and the other AI problems as error codes, like catchUp.run)
"ai.generate": { args: AiGenerateArgs; result: AiGenerateResult };
"ai.saveDraft": { args: AiSaveDraftArgs; result: NoteCreateResult };
```

Streaming the draft as it's written (the web shows it) can reuse `ai.stream` later; native shows progress meanwhile.

---

## N5 iPhone frame and N6 editor commands (2026-10-24)

Found while wiring the native iPhone frame (`apps/ios/ios/App/Native/Phone/`) to the Page View on the iOS 27
Simulator. Each says what native does meanwhile.

### R5.1 `insert { kind: "slash" }`: the slash menu at the caret **open**

The keyboard toolbar's first key is "/" (the web keyboard bar and Craft both start with it). `insert` has no kind
that opens the slash menu where the caret is. Add `"slash"` to the kinds `insert` takes: types "/" at the
selection, which opens the editor's own slash menu (`SlashMenu`), as typing it does.

Meanwhile "/" opens the Insert panel (`panel.open { panel: "insert" }`).

### R5.2 The onboarding gate has no actions **open**

`AccountGate.tsx` reports `<NativeGate gate="onboarding" onboarding={{ step }} />` with no `actions`, so a native
screen can't move a new account past onboarding (N14 draws the steps; this frame only shows the gate). Either
actions on the gate (at least `skip`, the web's "Skip setup", which runs `users.completeOnboardingStep({ step:
"ai" })` and then the summary) or commands:

```ts
export interface OnboardingStepArgs { step: "uses" | "style" | "appearance" | "ai" | "welcome"; useCases?: string[]; noteStyle?: string; appearance?: "system" | "light" | "dark"; aiEnabled?: boolean }
// CommandMap
"onboarding.complete": { args: OnboardingStepArgs; result: OkResult };   // users.completeOnboardingStep
"onboarding.skip": { args: EmptyArgs; result: OkResult };                 // Onboarding.tsx skipAll
```

Meanwhile the gate screen shows "Welcome to Folevi" with no way on; the UI tests finish onboarding on the server.

### R5.3 The note page's iPhone layout in native chrome mode **open**

With `platform: "ios"` in the marker, a note draws as on the iPad and Mac: a centred page card on the grey
backdrop, its top starting well below the bar. The owner's iPhone rule (docs/IOS_PERFORMANCE.md, "The owner's
chrome requests") is that a note fills the width under the neutral bar, its theme colour starting right below the
bar, with no backdrop around it. Please give native chrome mode on `ios` (not `ipados`) the iPhone page layout
that `components/iphone` gives the page today (`editor-phone.css`), minus the web bars.

Native gives the page no safe area of its own (the Page View's holder cancels the status bar, the bar and the home
indicator, so `env(safe-area-inset-*)` reads 0) and sends the bars' room in `insets` (top: the status bar plus the
navigation bar, 116 pt on an iPhone 18 Pro; bottom: the floating buttons, or the keyboard plus its toolbar while
writing). The page should pad by `--native-inset-top` / `--native-inset-bottom` only.

### R5.4 A new note opens with the caret in its title **open**

`note.show { id, focus: true }` on a note `note.create` just made puts the caret in the body; the first line typed
lands under "Untitled". The web's new note (`?new=1`) starts in the title. Please make `focus` on an untitled,
empty note focus the title (and `editor.state.focused` true while the title has it, so the keyboard toolbar and
Done show).

### R5.5 `editor.state` after the keyboard comes up without a tap in the body **open**

Opening the note's "..." menu (a native UIMenu) on a note that had the keyboard up left the keyboard showing
while `editor.state.focused` was false, so native hid its toolbar and Done. Please send `editor.state` on
`focusin`/`focusout` of the title and the editor (not only on the editor's selection updates), so `focused` follows
whatever holds the keyboard on the note page.

---

## N10 Tasks and Calendar, N11 Search, Notifications and Places (2026-10-24)

Stand-ins live in `apps/native-kit/Sources/FoleviScreens/Intents/PendingContractN10.swift` with the same names and
shapes. Native screens work without the open ones (they hide or fall back as each entry says).

### R10.1 Codegen: `?: T | null` fields must be able to send `null` (bug) **added** (the generator emits `Patch<T>` (`.keep`, `.clear`, `.set(value)`) for every `?: T | null` field, encoded as left out / `null` / the value and read back the same way. The memberwise initializers and spec factories still take `T?` (nil: left out), so every call site compiles as before; to clear, set the property: `var a = TaskUpdateArgs(id: id); a.dueDate = .clear; client.command(Commands.TaskUpdate(a))`. Swift test: `FoleviEngineTests/PatchTests.swift`)

`TaskUpdateArgs.dueDate`, `dueTime`, `assigneeId` and `reminderAt` are `?: T | null` ("left out: unchanged; null:
clear"). The generated Swift struct has plain optionals with synthesized `Codable`, so nil is left out and "no date",
"all day", "nobody" and "no reminder" can't be sent. Fix in `scripts/engine-codegen.mjs`: for an optional field whose
type includes `null`, generate a three-state field (keep, clear, set), for example a generic
`enum Patch<T> { case keep, clear, set(T) }` encoded as absent / `null` / the value. Other affected args: check every
`?: ... | null` (`NoteCreateArgs.folderId`, `TaskCreateArgs.dueDate`/`dueTime`). Until then native sends `task.update`
through `PendingN10Commands.TaskPatch` (`TaskPatchArgs` with `PatchField`).

### R10.2 Repeating tasks: set and change the repeat **open**

The web's task sheet shows the repeat read-only and Quick Add reads it from the words; native matches that. To edit it
natively (the plan's "due/repeat editing with native pickers"):

```ts
export interface TaskUpdateArgs {
  // ...
  /** "daily", "weekly", "weekdays", "monthly", "yearly", or a rule ("every 2 weeks on mon,thu"); null: no repeat. */
  repeat?: string | null;
}
```

### R10.3 Calendar feed link (tasks in another calendar app) **open**

`CalendarFeedDialog.tsx` ("Show your tasks in your calendar", `convex/calendarFeeds.ts`) has no command. Native leaves it
out of the Calendars sheet until:

```ts
export interface CalendarFeedValue { url: string | null; createdAt: number | null }
"calendar.feed": { args: EmptyArgs; value: CalendarFeedValue };            // view
"calendar.feedCreate": { args: EmptyArgs; result: { url: string } };       // shown once; ends the old link
"calendar.feedRevoke": { args: EmptyArgs; result: OkResult };
```

### R10.4 Tasks without a date, for the Calendar's "Unscheduled" list (iPad, Mac) **open**

`CalendarView.tsx` lists open tasks without a date beside the month to drag onto a day. `tasks.range` only returns dated
tasks. Please add `"tasks.unscheduled": { args: SpaceArgs; value: TasksRangeValue }` (open, no due date, newest first,
at most 200). Native drops onto days already work for any task row it has.

### R11.1 Search: "Created by" filter **open**

The web palette filters by creator in workspaces (`creatorId`). Add to `SearchArgs`: `creatorId?: string;` (ignored with
`scope: "everywhere"`). Native shows the Folder, Tag, Updated and Archived filters; Created by comes with this.

### R11.2 Declining an invitation **open**

The bell can only accept. Native offers Decline next to Accept:

```ts
export interface InviteDeclineArgs { inviteId: string; kind: "workspace" | "page" }
"invite.decline": { args: InviteDeclineArgs; result: OkResult };   // workspaces.declineInvite / sharing.declinePageInvite; removes the notification
```

Until then native catches `unknown_command` and removes the notification instead (`notification.remove`).

### R11.3 Plans per workspace in the account and place switcher **open**

The redesigned account menu shows each place with its plan ("Pro", "Team"). `AccountDetails.plan` covers Personal;
`AccountSpace` and `PlaceWorkspaceInfo` have none, so native shows the role ("Admin") for workspaces. Add:

```ts
export interface AccountSpace { /* ... */ planName: string | null }      // "Team", "Business"; null when unknown
export interface PlaceWorkspaceInfo { /* ... */ planName: string | null } // other accounts' workspaces
```

### R11.4 A notification's file download **open**

Rows with `fileId` (an export ready to download) need a signed link. Native sends the frame
`ScreenIntent.downloadFile(id:)`; the frame needs `"files.urls": { args: { ids: string[] }; value: { urls: Record<string, { url: string | null }> } }`
(the `files.urls` the plan's 3.10 already names) to fetch it.

### R11.5 Recent notes across spaces before typing in Search **open (small)**

Before typing, native shows Home's recents (`home.recents`, this space only). With scope Everywhere the web shows the
same. If the engine has recents across every space of the place, `"recent": { args: { scope?: "place" | "everywhere"; limit?: number }; value: { rows: NoteRow[] } }`
(the plan's 5.7 `recent` view) would let native show them for Everywhere.
