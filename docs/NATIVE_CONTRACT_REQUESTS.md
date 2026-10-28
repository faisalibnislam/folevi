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

### R5.2 The onboarding gate has no actions **added** (revision 10: see R14.2)

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

### R10.2 Repeating tasks: set and change the repeat **added** (revision 9: `task.update { repeat, noteId }`; `noteId` is required with `repeat` because the repeat is the to-do block's own props, saved through the note by the sync engine, so it works offline and in encrypted notes. `repeat` takes a kind or words: "every 2 weeks on mon,thu", "3 days"; null removes it)

The web's task sheet shows the repeat read-only and Quick Add reads it from the words; native matches that. To edit it
natively (the plan's "due/repeat editing with native pickers"):

```ts
export interface TaskUpdateArgs {
  // ...
  /** "daily", "weekly", "weekdays", "monthly", "yearly", or a rule ("every 2 weeks on mon,thu"); null: no repeat. */
  repeat?: string | null;
}
```

### R10.3 Calendar feed link (tasks in another calendar app) **added** (revision 9: `calendar.feed` has `active`, `createdAt`, `lastFetchedAt`, `includeWorkspaces`; `url` is always null there because the server keeps only the link's hash, so the link shows once, in `calendar.feedCreate { includeWorkspaces? }`'s reply; also `calendar.feedRevoke` and `calendar.feedWorkspaces { includeWorkspaces }`)

`CalendarFeedDialog.tsx` ("Show your tasks in your calendar", `convex/calendarFeeds.ts`) has no command. Native leaves it
out of the Calendars sheet until:

```ts
export interface CalendarFeedValue { url: string | null; createdAt: number | null }
"calendar.feed": { args: EmptyArgs; value: CalendarFeedValue };            // view
"calendar.feedCreate": { args: EmptyArgs; result: { url: string } };       // shown once; ends the old link
"calendar.feedRevoke": { args: EmptyArgs; result: OkResult };
```

### R10.4 Tasks without a date, for the Calendar's "Unscheduled" list (iPad, Mac) **added** (revision 9, `tasks.unscheduled`)

`CalendarView.tsx` lists open tasks without a date beside the month to drag onto a day. `tasks.range` only returns dated
tasks. Please add `"tasks.unscheduled": { args: SpaceArgs; value: TasksRangeValue }` (open, no due date, newest first,
at most 200). Native drops onto days already work for any task row it has.

### R11.1 Search: "Created by" filter **added** (revision 9, `SearchArgs.creatorId`)

The web palette filters by creator in workspaces (`creatorId`). Add to `SearchArgs`: `creatorId?: string;` (ignored with
`scope: "everywhere"`). Native shows the Folder, Tag, Updated and Archived filters; Created by comes with this.

### R11.2 Declining an invitation **added** (revision 11, `invite.decline`, with `workspaces.declineInvite` and `sharing.declinePageInvite` on the server; revision 12 adds `kind: "folder"` (`folderSharing.declineInvite`). The `notification.remove` fallback can go)

The bell can only accept. Native offers Decline next to Accept:

```ts
export interface InviteDeclineArgs { inviteId: string; kind: "workspace" | "page" }
"invite.decline": { args: InviteDeclineArgs; result: OkResult };   // workspaces.declineInvite / sharing.declinePageInvite; removes the notification
```

Until then native catches `unknown_command` and removes the notification instead (`notification.remove`).

### R11.3 Plans per workspace in the account and place switcher **added** (revision 9: `AccountSpace.planName` (Personal's from its plan, workspaces' from workspaces.mine) and `PlaceWorkspaceInfo.planName` (the open account's workspaces; null for other accounts', which this device doesn't know))

The redesigned account menu shows each place with its plan ("Pro", "Team"). `AccountDetails.plan` covers Personal;
`AccountSpace` and `PlaceWorkspaceInfo` have none, so native shows the role ("Admin") for workspaces. Add:

```ts
export interface AccountSpace { /* ... */ planName: string | null }      // "Team", "Business"; null when unknown
export interface PlaceWorkspaceInfo { /* ... */ planName: string | null } // other accounts' workspaces
```

### R11.4 A notification's file download **added** (revision 9: `files.urls { ids }` gives `{ urls: { [id]: { url, filename, mimeType, size, sealed } } }`; links last about two hours; an end-to-end encrypted file's bytes are ciphertext (`sealed`))

Rows with `fileId` (an export ready to download) need a signed link. Native sends the frame
`ScreenIntent.downloadFile(id:)`; the frame needs `"files.urls": { args: { ids: string[] }; value: { urls: Record<string, { url: string | null }> } }`
(the `files.urls` the plan's 3.10 already names) to fetch it.

### R11.5 Recent notes across spaces before typing in Search **added** (revision 9: `recent { scope?, limit? }` gives `{ rows: { row: NoteRow, space, spaceName }[] }`, newest first; a locked encrypted space is left out)

Before typing, native shows Home's recents (`home.recents`, this space only). With scope Everywhere the web shows the
same. If the engine has recents across every space of the place, `"recent": { args: { scope?: "place" | "everywhere"; limit?: number }; value: { rows: NoteRow[] } }`
(the plan's 5.7 `recent` view) would let native show them for Everywhere.

## N13 Settings and N14 sign-in, gates, sharing, Quick Add (2026-10-24)

Built in `apps/native-kit/Sources/FoleviScreens/{Onboarding,Auth,Settings,Sharing,QuickAdd,AppLock}`. No stand-ins:
what's missing is left out of the native screens (or opens the web page) until it's added.

### R13.1 Appearance: the editor text size **added** (revision 10: `AppearanceSettings.editorZoom` and `editorZooms` (the steps, 0.85 to 1.35); `settings.update { editorZoom }` snaps to the nearest step and keeps it on this device, as the web does)

The web's Appearance has "Editor text size" (85 % to 135 %, `AppearanceSection.tsx` `ZOOMS`), kept per device.
Request: `AppearanceSettings.editorZoom: number` and `settings.update { editorZoom?: number }` (or an editor command
if it stays per device). Native shows Theme only until then.

### R13.2 Security: two-step verification, passkeys, password, sign-in methods **added** (revision 10: `SecuritySettings.twoFactor` (null when unknown), `passkeys: PasskeyRow[]` (`lastUsedAt` from passkeyUsage) and `methods` ("password", "google", "apple"); the changes stay web: `web.show { page: "settings.security" }`)

`settings.security` has the sessions only. The web's Security also shows two-step status and its actions, passkeys
and the sign-in methods (`SecuritySection.tsx`, `SignInMethods.tsx`). Request:

```ts
export interface SecuritySettings { sessions: SessionRow[]; twoFactor: boolean; passkeys: { id: string; name: string; createdAt: number; lastUsedAt: number | null }[]; methods: ("password" | "google" | "apple")[] }
// Commands that need the current password or a code go through the gate pattern (fields + gate.act) or native
// ShellAuth calls (R14.1); passkey create/remove need WebAuthn, so they can stay web: `web.show { page: "settings.security" }`.
```

Until then native Security shows "Where you're signed in" with Sign out per device.

### R13.3 This device: storage and "Keep all notes on this device" (plan 11.8) **added** (revision 10, per place because each Page View serves one place: view `device.storage` gives `{ place, keepAll, available, spaces: SpaceCopyInfo[], notesKept, attachmentsKept, attachmentsBytes, usedBytes, freeBytes, attachmentLimitBytes, waiting }`; commands `device.keepAll { on }`, `device.download`, `device.removeCopy { force? }` (replies `{ removed: false, waiting }` first when changes wait; they are never removed), `device.removeFiles`. Not added: `device.attachments`, since attachments follow the fixed rule (2 GB or 10 % of free space, Wi-Fi only) with no setting on the web either)

Needs a view `device.storage { places: { place, name, keepAll, notesBytes, attachmentsBytes, otherBytes, downloading?: GateProgress }[]; freeBytes; attachments: "wifi" | "cellular" | "opened"; limitBytes: number | null }` and commands `device.keepAll { place, on }`, `device.download { place }`, `device.removeCopy { place }` (asks first when changes wait: reply `{ waiting: number }`), `device.attachments { policy?, limitBytes? }`, `device.removeFiles`. The section is hidden until then.

### R13.4 Privacy and encryption, workspace sections, delete account **added** (revision 10: `WebPage` adds `settings.security`, `settings.privacy`, `settings.workspace` and `settings.deleteAccount` (Settings > Account, where the delete button is))

Native Privacy has the Face ID / Touch ID lock (the hosts' AppLock, through `AppLockSettings`) and the policy link;
its footer says encryption is set up on the web. Request web pages for what stays web this release, through
`WebPage`: `settings.privacy` (E2EE levels, recovery key, encrypted devices), `settings.workspace` (members, guests,
workspace billing and privacy) and `settings.deleteAccount`. With those, Settings lists them as web rows like
Connected apps.

### R13.5 Help: the support form **open: needs a backend change** (`/api/support` takes the website's session cookie and checks the origin, so the apps can't call it, and there's no Convex path for it. Reported to the coordinator; keep the mailto until then)

Native Help sends email to support@folevi.com (mailto). Request `support.send { subject, body, includeDiagnostics }`
(the web's `SupportForm.tsx`), so the app can send without a mail client.

### R14.1 ShellAuth: native email and password, two-step, sign-up, reset (Swift services, not protocol.ts) **open**

The sign-in screens call `AuthService` (FoleviScreens/Auth/AuthService.swift). The hosts need an adapter over
`ShellAuth`: `signIn(provider:)` is `ShellAuth.signInAccount(window:provider:)` (Apple on iOS: AppleSignIn.swift);
`signInOnWeb()` is the same without a provider. Missing in ShellAuth: `signIn(email:password:)` (POST
`/api/auth/sign-in/email` with no bearer, keep `set-auth-token`; `twoFactorRedirect` → `.twoFactor`;
`EMAIL_NOT_VERIFIED` → `.emailUnverified`), `verifyTwoFactor` (`/api/auth/two-factor/verify-totp` and
`verify-backup-code`, which need Better Auth's two-factor cookie from the first call: keep it in memory for that
one request), `signUp`, `requestPasswordReset` and `sendVerificationEmail`, each returning the web's
`authErrorMessage` text. Until then an adapter answers `.useWebSignIn` for email and the screen opens the website's
sign-in page in the sheet, as today.

### R14.2 Onboarding actions (see R5.2) **added** (revision 10: `OnboardingGateInfo` has `step, index, total, useCases, useCaseOptions, noteStyle, noteStyleOptions, appearance, aiEnabled`; actions `continue` (values `useCases` comma list, `noteStyle`, `appearance`, `aiEnabled` "true"/"false", for the step shown), `back`, `skip`, `skipAll`, and `finish` on the last step)

The onboarding gate draws the web's six steps (progress, headings, text, the intro facts) but has no actions to press.
With R5.2's actions (or `onboarding.complete`), native adds the use-case, theme, appearance and Foli AI choices.

### R14.3 Library setup: picking the folder natively **added** (revision 10, without a new field: the `librarySetup` gate has an action per place, `place:icloud`, `place:dropbox`, `place:gdrive`, `place:folder`, `place:device`, plus `back`. Pressing `place:folder` runs `library.setup({ kind: "folder" })`, where the host already shows NSOpenPanel / UIDocumentPicker and keeps the bookmark. A new library then shows `open` (optional `passphrase` field, 8 characters or more) and `elsewhere`)

`librarySetup` needs a folder from `UIDocumentPickerViewController` / `NSOpenPanel` with a security-scoped bookmark,
which only the host can make. Request: the gate's action `chooseFolder` marked as native (`GateAction.native?: "pickFolder"`),
so the screen asks the host (LibraryService) and then sends `gate.act { action: "useFolder", values: { bookmark } }`.

### R14.4 Sharing folders, and changing a person's role **added** (revision 10: `sharing.setRole { noteId, profileId, role }`; revision 12: folder sharing, with the server's `convex/folderSharing.ts`, docs/SHARING.md. Views `folderSharing.get { id }`, `shared.folders`, `sharedFolder.open { id }`, `notes.moveCheck { ids, folderId }` (ask before a move when `title` isn't null); commands `folderSharing.invite`, `folderSharing.setRole`, `folderSharing.revoke` (their own id: leave), `folderSharing.cancelInvite`, `folderInvite.accept`; `invite.preview`, `invite.acceptLink` (result `folderId`) and `invite.decline` take `kind: "folder"`; `NotificationRow.folderId` (its `route` is `/shared/<id>`) and `folderInviteId`. New names instead of `sharing.get { folderId }`, so `sharing.get` keeps its shape. No native screens yet: native work is paused)

`sharing.get` takes a note id. Request `sharing.get { folderId }` (the folder's people and access) and
`sharing.setRole { noteId | folderId, profileId, role }`; today a role changes only by removing and inviting again.

### R14.5 The Mac Quick Add panel's page lifecycle (Mac host) **done** (f4579341: `Navigation.swift` routes the `.quickAdd` view's reloads and ended processes to `QuickAddPanel.shared.pageEvent`)

The native Quick Add field talks to its panel's hidden Page View through `MacEngineTransport`, but
`Navigation.swift` reports reloads and ended content processes only for main windows' frames
(`NativeFrame.pageEvent` finds controllers by main window). Route the `.quickAdd` view's events to
`QuickAddPanel.shared` too (it keeps the transport), so its client resubscribes after a reload.

---

## N12 Foli AI chat (2026-10-24)

Built on revision 8: chat, Research (`mode: "research"`, `ai.research`, cancel, save), proposed changes
(`ai.actions`), the agent's changes (`agentRun`, `ai.agentApprove`, `ai.agentDiscard`, `ai.agentUndo`), memory
offers, rename, pin, delete, save as note, edit, regenerate, stop. No stand-ins: each gap below is left out of the
native chat (or shown read-only) until it's added.

### R12.1 What an existing chat is about, and changing it **open**

`ChatConversationInfo.context` is only the kind, so an existing chat's chip says "This folder" or "A note" with no
name, and it can't be changed (the web's chips call `aiChat.setContext`). Request:

```ts
export interface ChatContextItem { kind: "note" | "folder"; id: string; name: string }
// ChatConversationInfo
  contextItems: ChatContextItem[];
export interface ChatSetContextArgs { conversationId: string; context: ChatContextArgs }
"ai.setContext": { args: ChatSetContextArgs; result: OkResult };   // aiChat.setContext
```

### R12.2 What Apply made **open**

After `ai.actions { apply: true }` the message's `actionsOutcome` is just `"applied"`; the web's card then links the
folders and notes it made (`setActionsOutcome { kind: "applied", folders, notes, moved }`). Request on `ChatMessage`:

```ts
  /** Once applied: what was made, to open. */
  actionsResult: { folders: { id: string; name: string }[]; notes: { id: string; title: string }[]; moved: number } | null;
```

### R12.3 Older chats in the history **open**

`ai.conversations` says `more: true` but takes no cursor, so the history shows the newest 50. Request
`ChatConversationsArgs.limit?: number` (the engine pages up to it), or a windowed list view like `notes.list`.

### R12.4 Attachments from native **open**

`ai.send { attachments }` takes uploaded file ids, but native has no way to upload one (the web's
`useChatAttachments` uploads through Convex storage). Request `ai.attach { bodyId | data, mimeType, name }`
(bytes posted like `settings.setAvatar`) answering `ChatAttachment`, plus `ChatCapabilities.audio` and the size
limit, so the composer can offer photos, files and the document scanner.

### R12.5 Google Search suggestions on web answers **open**

Answers that used Google Search grounding must show Google's search suggestions (web `SearchSuggestions.tsx`,
`message.searchEntryPoints`). They aren't in `ChatMessage`, so native can't show them. Native offers the Web chip and Research as asked; this
needs adding before release. Request:

```ts
  /** Google Search suggestions to show under a grounded answer (query and link). */
  searchSuggestions: { query: string; url: string }[];
```

### R12.6 Sharing a chat with the workspace, and the encrypted-content consent **open**

`ChatConversationInfo.canShare` exists but there's no command (web `ConversationActions` shares with the workspace):
`ai.share { conversationId, shared }`. Plan 5.9 also lists `ai.consent` (asking before Foli AI reads encrypted
notes); it isn't in the contract, so the native chat can't ask and relies on the engine to refuse with a message.

### R12.7 Credits left (usage only) **done**

The web composer shows a credits note (`AiCreditsNote`: "12 AI credits left this month"). Done in
`ai.capabilities`: `credits: ChatCredits | null` (`included`, `available`, `low` by the web's rule, `resetsAt`,
`trialing`, `seat`, `canBuy`, false on iOS and in local mode), null in local mode. Also there: `unavailable`
("off", "plan", "workspacePlan", "setup") so native says why Foli AI can't be used, as AiUnavailable.tsx does,
and a refused answer's `error.data` keeps `action` ("buy", "upgrade") and `reason` ("ai_not_included") for the
web's notice. Fixtures: `view.ai.capabilities`, `view.ai.capabilities.local`.

### R8.10 `note.show { blockId }` (open, small)

FoleviScreens' `ScreenIntent.openNote(id:, blockId:)` (a task's to-do, a search match in a file) and
`/d/<id>#block-<blockId>` links open the note, but nothing scrolls it to the block. Request `blockId?: string` on
`note.show` (and `note.prepare`): the page scrolls the block into view and flashes it, as the web's `#block-` links do.

### R8.11 a notification's file link (open, small)

`ScreenIntent.downloadFile(id:)` (an export a notification delivers, `NotificationRow.fileId`) needs the file's
signed link: `files.url { id }` answering `{ url, name, size }` (the web's `files.urls`). Until then the Mac says
to download it on the web.

### R5.6 After "Sign in to Folevi" with no account, the gate stays "loading" **open**

On the first-launch choice, `gate.act { action: "account" }` with no account on the device restarts the page into
account mode with no place; the page then draws the mode choice again (DOM: "Where should your notes live?") while
`hello.gate` and `gate.changed` say `loading` with no actions, so native shows nothing it can act on. Expected:
`gate: "signedOut"` (native shows its sign-in flow, R14.1's adapter is in). Seen with the export at revision 9.

### R5.7 A note prepared right after launch sometimes ends on "This page couldn't load" **open**

Pressing a recent card within a second or two of a cold launch (`note.prepare` while the engine is still opening
the store) twice left the Page View on the route error page ("This page couldn't load. Reload / Back") and no
`note.ready`. The same card a few seconds later opens fine. Native now shows the page after 1.5 s without
`note.ready`, so the error page shows instead of a blank. Please let `note.prepare`/`note.show` wait for the store
(or retry the route) instead of failing the route.
