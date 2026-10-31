// The bridge contract between the native apps (iPhone, iPad, Mac) and the web engine that runs in their Page View
// (docs/NATIVE_APP_PLAN.md section 3). This file is the single source of truth: the Swift models in
// apps/native-kit/Sources/FoleviEngine/Generated/ are generated from it (scripts/engine-codegen.mjs), and the
// fixtures in ./fixtures/*.json are checked against it by the vitest suite (test/engine/fixtures.test.ts) and
// decoded by the Swift tests.
//
// Rules for changing it (section 3.2, "Versioning"):
// - `PROTOCOL_VERSION` is the envelope's major version. It changes only when the envelope itself changes.
// - Views, commands, editor commands and events are added, never changed in place. A changed shape gets a new
//   name (`notes.list2`). Every addition bumps `CONTRACT_REVISION` and adds a fixture.
// - Keep the types codegen friendly: interfaces and type aliases of plain JSON, string literal unions, `T | null`
//   for values that may be absent but are always sent, `?` for fields that may be left out. No `unknown` in view
//   models, no functions, no classes, no generics beyond the maps below. A union of object types always carries
//   a string discriminator named `kind`.
// - Open enums (values the server may extend, such as a note's font or cover kind) are typed `string` and
//   documented; Swift keeps them as `String`.
//
// Transport (section 3.1):
// - JavaScript to native: `window.webkit.messageHandlers.foleviEngine.postMessage(json)` where `json` is a JSON
//   string holding an array of `FromEngine` updates and events (`EngineBatch`), flushed at most once per
//   animation frame. A batch over `BIG_PAYLOAD_BYTES` is POSTed to `/_bridge/<id>` first and the message is then
//   the JSON object `{ "bodyId": "<id>" }` (`BigBatchPointer`): native reads the batch with one GET of that path.
// - Native to JavaScript: `callAsyncJavaScript("return __foleviEngine.handle(m)", arguments: ["m": json])` where
//   `json` is one `ToEngine` message as a JSON string. It resolves with the reply as a JSON string (`Reply`).
//   Replies never travel through postMessage.
// - The host marks a native chrome page before the first paint: `<html data-native-chrome>` and
//   `window.__foleviNativeChrome = { platform, protocol: 1, place }` (`NativeChromeMarker`). Without the marker
//   the website and today's apps behave exactly as before and `__foleviEngine` is never installed.

// ---------------------------------------------------------------------------------------------------------------
// Versions and transport names
// ---------------------------------------------------------------------------------------------------------------

/** The envelope's major version (`v` on every message to the engine). */
export const PROTOCOL_VERSION = 1 as const;

/** Bumps with every added view, command, editor command, event or field. */
export const CONTRACT_REVISION = 25;

/** The `WKScriptMessageHandler` name the engine posts to. */
export const MESSAGE_HANDLER = "foleviEngine";

/** The global the host calls (`__foleviEngine.handle(json)`). */
export const ENGINE_GLOBAL = "__foleviEngine";

/** The global the host sets before the first paint to turn native chrome mode on. */
export const MARKER_GLOBAL = "__foleviNativeChrome";

/** Bodies above this go through the `/_bridge/<id>` scheme route instead of the message (section 3.1). */
export const BIG_PAYLOAD_BYTES = 256 * 1024;

/** The most rows one list window may ask for (window plus overscan). Larger windows are clamped. */
export const MAX_WINDOW_ROWS = 1000;

/** Rows of overscan native is expected to ask for on each side of what is visible (section 3.2). */
export const RECOMMENDED_OVERSCAN = 100;

/** What the host sets as `window.__foleviNativeChrome` before the first paint. */
export interface NativeChromeMarker {
  platform: "ios" | "ipados" | "macos";
  /** The protocol the host speaks; must equal `PROTOCOL_VERSION`. */
  protocol: number;
  /** The place this Page View is bound to (`acct:<user id>` or `library`); messages naming another are refused. */
  place?: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------------------------------------------

/** The app as it introduces itself in `hello`. */
export interface AppInfo {
  platform: "ios" | "ipados" | "macos";
  /** The unified version, `1.1.00`. */
  version: string;
  build: string;
  /** The protocol the app was built against. */
  protocol: number;
  /** The `schemaHash` the generated Swift was made from (see `HelloValue.schemaHash`). */
  schemaHash?: string;
}

export interface HelloMessage {
  v: 1;
  id: string;
  kind: "hello";
  app: AppInfo;
}

/** Starts a live view. Reusing a `sub` that is already live restarts it (a fresh full value, `rev` from 1). */
export interface WatchMessage {
  v: 1;
  id: string;
  kind: "watch";
  /** Chosen by native, unique per Page View. Native registers it before sending (an update may beat the reply). */
  sub: string;
  place: string;
  name: ViewName | ListViewName;
  args: Record<string, unknown>;
  /** List views only: the rows wanted. Left out: the first `RECOMMENDED_OVERSCAN * 2` rows. */
  window?: ListWindow;
}

export interface UnwatchMessage {
  v: 1;
  id: string;
  kind: "unwatch";
  sub: string;
}

/** Moves a list subscription's window (the person scrolled). */
export interface WindowMessage {
  v: 1;
  id: string;
  kind: "window";
  sub: string;
  window: ListWindow;
}

/** Reads a view once (search, a sheet that opens and closes). List views answer their first window. */
export interface QueryMessage {
  v: 1;
  id: string;
  kind: "query";
  place: string;
  name: ViewName | ListViewName;
  args: Record<string, unknown>;
  window?: ListWindow;
}

/** A write. Replies when the change is applied on this device (queued if offline), not when the server answered. */
export interface CommandMessage {
  v: 1;
  id: string;
  kind: "command";
  place: string;
  name: CommandName;
  args: Record<string, unknown>;
}

/** Drives the note page and its editor (the keyboard toolbar, the note's bars and menus, opening notes). */
export interface EditorMessage {
  v: 1;
  id: string;
  kind: "editor";
  name: EditorCommandName;
  args?: Record<string, unknown>;
}

export type ToEngine = HelloMessage | WatchMessage | UnwatchMessage | WindowMessage | QueryMessage | CommandMessage | EditorMessage;

export interface ReplyOk {
  kind: "reply";
  id: string;
  ok: true;
  /** `HelloValue` for hello, `WatchValue` for watch, the view's value (or `ListDiff`) for query, the command's result. */
  value: unknown;
}

export interface ReplyError {
  kind: "reply";
  id: string;
  ok: false;
  error: EngineError;
}

export type Reply = ReplyOk | ReplyError;

/**
 * A live view's new value. Value views send the whole `value` every time it changes (they are small). List views
 * send `diff` (the first update of a subscription, and the first after `window` or a restart, has `diff.reset`).
 * `rev` goes up by one per update of a subscription; a gap means native missed one and should `watch` again.
 */
export interface UpdateMessage {
  kind: "update";
  sub: string;
  rev: number;
  value?: unknown;
  diff?: ListDiff;
  /** The value came from this device's copy while the server hasn't answered (offline, starting up). */
  stale?: boolean;
  /** The view failed (a folder that isn't there any more, no access). Later updates may recover. */
  error?: EngineError;
}

export interface EventMessage {
  kind: "event";
  name: EventName;
  data: unknown;
}

export type FromEngine = Reply | UpdateMessage | EventMessage;

/** A big batch's stand-in in the message: GET `/_bridge/<bodyId>` once for the `EngineBatch`. */
export interface BigBatchPointer {
  bodyId: string;
}

/** What one postMessage carries: updates and events in the order they happened. */
export type EngineBatch = (UpdateMessage | EventMessage)[];

export interface EngineError {
  /** A bridge code (`BridgeErrorCode`) or the server's own `ConvexError` code, passed through unchanged. */
  code: string;
  /** Text for people, from the web's own messages (so wording lives in one place). */
  message: string;
  data?: Record<string, unknown>;
}

export type BridgeErrorCode =
  | "engine_not_ready" // the Page View is still booting or signed out; retry after `engine.ready`
  | "place_mismatch" // the message names another place than this Page View's
  | "protocol_mismatch" // hello from an app built against another protocol
  | "unknown_view"
  | "unknown_command"
  | "unknown_editor_command"
  | "unknown_subscription"
  | "invalid_message" // not JSON, or not an envelope
  | "invalid_args"
  | "no_note" // an editor command while no note is open
  | "read_only" // the open note can't be edited by this person
  | "unavailable" // the action isn't offered for this note or here
  | "page_gone" // native only: the content process ended; wait for the reload
  | "failed"; // anything else (the message says what)

export const BRIDGE_ERROR_CODES: readonly BridgeErrorCode[] = [
  "engine_not_ready",
  "place_mismatch",
  "protocol_mismatch",
  "unknown_view",
  "unknown_command",
  "unknown_editor_command",
  "unknown_subscription",
  "invalid_message",
  "invalid_args",
  "no_note",
  "read_only",
  "unavailable",
  "page_gone",
  "failed",
];

/** The reply to hello. */
export interface HelloValue {
  protocol: number;
  revision: number;
  /** The web export's build id. */
  build: string;
  /** A hash of the contract's names and revision; equal on both sides when the Swift is current. */
  schemaHash: string;
  /** Whether the data layer is up (signed in, the place's store open). Otherwise wait for `engine.ready`. */
  ready: boolean;
  place: string | null;
  features: string[];
  views: string[];
  listViews: string[];
  commands: string[];
  editorCommands: string[];
  events: string[];
  /** Revision 3: the screen native should show now (the same as the last `gate.changed`). */
  gate: GateChangedEvent;
}

/** The reply to watch. */
export interface WatchValue {
  sub: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Lists: windows and diffs (section 3.2, "Big lists")
// ---------------------------------------------------------------------------------------------------------------

/** The rows a native list wants: what's visible plus overscan each way. */
export interface ListWindow {
  start: number;
  count: number;
}

/**
 * A change to a windowed list. Apply in this order: `reset` (forget every row), `remove`, `upsert`, then `order`.
 * The rows native holds afterwards are exactly the ids in its current `order`, in that order, at positions
 * `start ..< start + order.count` of a list of `total` rows.
 */
export interface ListDiff {
  /** Forget all rows and the order first (first update, a new window, a restarted subscription). */
  reset?: boolean;
  /** Rows the list has now (known so far, when `complete` is false). */
  total: number;
  /** False while more rows exist past `total` that haven't loaded; ask for a window past the end to load them. */
  complete: boolean;
  /** Where the window starts (echoes the window, clamped to the list). */
  start: number;
  /** The window's ids in order; sent when it changed. */
  order?: string[];
  /** Rows that are new to native or changed, by id; each carries `h`, its content hash. */
  upsert?: Record<string, NoteRow>;
  /** Ids native should drop (left the window or the list). */
  remove?: string[];
}

// ---------------------------------------------------------------------------------------------------------------
// Shared view model pieces
// ---------------------------------------------------------------------------------------------------------------

/** A Personal or a team workspace inside a place: "personal", or the workspace's id. */
export type SpaceRef = string;

/** View args that name a space; left out, the space the Page View is showing. */
export interface SpaceArgs {
  space?: SpaceRef;
}

/** No arguments (an empty object). */
export type EmptyArgs = Record<string, never>;

export interface NoteIdArgs {
  id: string;
}

export interface NotePictureArgs {
  id: string;
  /** The note's title as the tab shows it (the picture's heading). */
  title: string;
}

/** A note drawn small for a tab's picture (the web's TabPreview): a page of HTML with nothing that runs. */
export interface NotePictureResult {
  /** Null while the note's blocks aren't on this device and the server hasn't answered. */
  html: string | null;
}

/** Whether a row's changes have reached Folevi (section 3.9). */
export type SyncMark = "saved" | "waiting" | "failed" | "conflict";

/** A note's cover. `kind` is open: "none", "theme" (value: a theme key such as "art-12"), "image", "color", ... */
export interface CardCover {
  kind: string;
  value?: string;
}

/**
 * A note's look, for drawing its card with its page colours (packages/design-tokens palette.ts). All values are
 * open enums from packages/editor-schema (DocumentStyle).
 */
export interface CardStyle {
  font: string;
  width: string;
  background: string;
  accent: string;
  card: string;
  backdrop?: string;
  sheet?: string;
  text?: string;
  separator?: string;
  blur?: boolean;
}

/**
 * One line of a note's preview (documents.preview, components/views/DocumentCard.tsx PreviewLine): `t` the block
 * type ("paragraph", "heading", "bulleted", "numbered", "todo", "quote", "code", "table", "image", ...), `x` its
 * text, `l` a heading level, `c` checked, `d` list depth, `rows` a table's first cells.
 */
export interface PreviewLine {
  t: string;
  x: string;
  l?: number;
  c?: boolean;
  d?: number;
  rows?: string[][];
}

export interface FolderChip {
  id: string;
  name: string;
  /** A folder colour key ("accent", "moss", ...) or null for the default. */
  color: string | null;
}

export interface TagChip {
  id: string;
  name: string;
  color: string;
}

/** A note as cards and rows show it (Home's recents, Starred, every note list). */
export interface NoteRow {
  id: string;
  /** "" for an untitled note (native shows "Untitled"). Decrypted in memory for encrypted notes; never stored. */
  title: string;
  /** An emoji, or null. */
  icon: string | null;
  /** "document", "daily" or "template". */
  kind: string;
  excerpt: string;
  preview: PreviewLine[] | null;
  cover: CardCover;
  style: CardStyle;
  starred: boolean;
  /** Milliseconds since 1970. */
  createdAt: number;
  updatedAt: number;
  /** The folder it lives in (its own or its top-level note's); null for Drafts. */
  folder: FolderChip | null;
  tags: TagChip[];
  /** End-to-end encrypted. */
  encrypted: boolean;
  /** Archived (shown in Archive) or in Trash. */
  archived: boolean;
  inTrash: boolean;
  /** Revision 4: when it went to Trash (milliseconds since 1970), or null when it isn't in Trash. */
  deletedAt: number | null;
  sync: SyncMark;
  /** Content hash of the row (everything above); equal hashes mean equal rows. */
  h: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Value views
// ---------------------------------------------------------------------------------------------------------------

export interface ProfileInfo {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface SpaceInfo {
  id: SpaceRef;
  kind: "personal" | "workspace";
  name: string;
  /** "owner", "admin" or "member" (open). */
  role: string;
  canEdit: boolean;
  canManage: boolean;
  /** End-to-end encryption is on for this space. */
  encrypted: boolean;
  /** Encrypted and this device is locked: lists show nothing until it's unlocked. */
  locked: boolean;
  /**
   * Revision 11 (R9.1): "Always fully encrypted" is offered in this space's folder menus (`folder.lock`): the
   * account has encryption keys, and the person may (Personal: its owner; a workspace: owner and admins).
   * @default false
   */
  canLock: boolean;
  /**
   * Revision 11 (R9.1): "standard" or "encrypted", the space's level (the stop wording differs).
   * @default "standard"
   */
  level: string;
}

export interface Capabilities {
  /** Revision 4: the Graph view is available (Foli AI's graph). */
  graph: boolean;
  sharing: boolean;
  changes: boolean;
  workspaces: boolean;
  /** Foli AI is included in the plan and turned on. */
  ai: boolean;
  /** Plans and purchases may be shown (never on iOS, never in local mode). */
  purchases: boolean;
}

/** `session`: who and where, for the frame (avatar, place switcher, space menu). */
export interface SessionValue {
  place: string | null;
  mode: "account" | "local";
  profile: ProfileInfo;
  spaces: SpaceInfo[];
  /** The space the Page View shows now. */
  space: SpaceRef;
  online: boolean;
  /** YYYY-MM-DD in `timeZone`. */
  today: string;
  timeZone: string;
  appearance: "system" | "light" | "dark";
  capabilities: Capabilities;
}

export interface PlaceWorkspaceInfo {
  id: string;
  name: string;
  logoUrl: string | null;
  /** Revision 9 (R11.3): the workspace's plan, when this device knows it (the open account's); null otherwise. */
  planName: string | null;
}

export interface PlaceRow {
  id: string;
  kind: "account" | "library";
  /** The account's name, or "On this device" style text for the library. */
  name: string;
  email: string | null;
  avatarUrl: string | null;
  /** The library: where it syncs, for people to read. Accounts: null. */
  syncs: string | null;
  workspaces: PlaceWorkspaceInfo[];
  unread: number;
  reminders: number;
  waiting: number;
}

/** `places.list`: every place this device knows, for the account and place switcher. */
export interface PlacesValue {
  current: string | null;
  places: PlaceRow[];
}

/** Home's Catch me up / Your week card (`ai.brief`, generated on request, kept in memory for this session). */
export interface CatchUpCard {
  /** Foli AI is on here (otherwise native hides the card). */
  available: boolean;
  state: "idle" | "running" | "ready" | "error";
  brief: CatchUpBrief | null;
  error: EngineError | null;
}

export interface CatchUpBrief {
  /** Markdown. */
  text: string;
  sources: CatchUpSource[];
  /** When it was made, milliseconds since 1970. */
  at: number;
}

export interface CatchUpSource {
  id: string;
  title: string;
}

/** A row of Home's list (All notes, Drafts, Shared with me, Changes, Reviews). */
export interface HomeRow {
  id: "notes" | "drafts" | "shared" | "changes" | "reviews";
  title: string;
  /** The number shown at the row's end; null shows none. */
  count: number | null;
  /** The web route it stands for (`/drafts`), for native's own router. */
  route: string;
}

export interface FolderPreview {
  title: string;
  excerpt: string;
  cover: CardCover;
}

/** A folder as Home's and a folder screen's folder cards show it. */
export interface FolderCard {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  /** Notes inside (top level, not archived or trashed, that this person can open). */
  noteCount: number;
  /** Direct subfolders. */
  childCount: number;
  updatedAt: number;
  /** Up to three of its most recently edited notes, peeking out of the card. */
  previews: FolderPreview[];
  encrypted: boolean;
  sync: SyncMark;
  /**
   * Revision 11 (R9.1): always fully encrypted.
   * @default false
   */
  locked: boolean;
  /** Revision 11 (R9.3): where a nested folder is, its ancestors' names ("Work / Clients"); null at the top level. */
  path: string | null;
  /**
   * Revision 11 (R9.3): for All folders' "Newest" sort (0 when unknown).
   * @default 0
   */
  createdAt: number;
}

export interface TagRow {
  id: string;
  name: string;
  color: string;
}

export interface StarredSection {
  rows: NoteRow[];
  /** More starred notes than shown (Home shows six). */
  more: boolean;
}

/** `home`: everything Home shows (section 5.3). */
export interface HomeValue {
  space: SpaceRef;
  /** "Personal" or the workspace's name. */
  spaceName: string;
  /** Up to ten recently edited notes, as cards. */
  recents: NoteRow[];
  /** False until the first answer (native shows placeholders). */
  recentsLoaded: boolean;
  catchUp: CatchUpCard;
  rows: HomeRow[];
  starred: StarredSection;
  /** Top-level folders as cards, in the sidebar's order. */
  folders: FolderCard[];
  tags: TagRow[];
}

/** A folder in the tree: flat, depth first, in the sidebar's order. */
export interface FolderNode {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  /** 0 for a top-level folder. */
  depth: number;
  rank: string;
  childCount: number;
  /** Null until the folder index has answered. */
  noteCount: number | null;
  encrypted: boolean;
  sync: SyncMark;
  /**
   * Revision 11 (R9.1): always fully encrypted.
   * @default false
   */
  locked: boolean;
}

/** `folders.tree`: every folder (nested) and tag of a space, with what's waiting to sync laid over it. */
export interface FoldersTreeValue {
  space: SpaceRef;
  folders: FolderNode[];
  tags: TagRow[];
}

/** The global sync state (docs/SYNC_PROTOCOL.md, components/app/SyncStatus.tsx). */
export type SyncState = "saved" | "saving" | "syncing" | "offline" | "conflict" | "error";

export interface SpaceSyncInfo {
  space: SpaceRef;
  /** The device copy of the space: "opening", "downloading", "ready", or "locked" (encrypted, device locked). */
  state: "opening" | "downloading" | "ready" | "locked";
  have: number;
  total: number | null;
}

/** `sync.status` (also sent as the `sync.status` event whenever it changes). */
export interface SyncStatusValue {
  state: SyncState;
  /** "Saved", "Saving…", "Syncing…", "Offline", "Conflict", "Not saved". */
  label: string;
  /** Changes on this device waiting for Folevi (page edits and other changes together). */
  pending: number;
  conflicts: number;
  online: boolean;
  /** The session needs signing in again before anything more can be sent. */
  authRequired: boolean;
  spaces: SpaceSyncInfo[];
}

/** `note.meta`: what the note screen's native bars and tab strip show. Also sent as the `note.meta` event. */
export interface NoteMeta {
  id: string;
  /** False while the note isn't known yet (opening from a link, offline before it was ever opened). */
  found: boolean;
  title: string;
  icon: string | null;
  kind: string;
  /** The space it belongs to, when it's in one of this person's spaces; null for a page shared with them. */
  space: SpaceRef | null;
  folder: FolderChip | null;
  /** The parent pages, outermost first (the place chip shows the nearest). */
  breadcrumbs: NoteCrumb[];
  starred: boolean;
  /** "full", "edit", "comment" or "read" (open). */
  access: string;
  canEdit: boolean;
  encrypted: boolean;
  archived: boolean;
  inTrash: boolean;
  cover: CardCover;
  style: CardStyle;
  sync: SyncMark;
}

export interface NoteCrumb {
  id: string;
  title: string;
  icon: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// List views
// ---------------------------------------------------------------------------------------------------------------

export type NotesListView = "all" | "starred" | "archive" | "trash" | "templates" | "unsorted" | "folder" | "tag";
export type NotesSort = "updated" | "created" | "title" | "manual";

/** `notes.list`: All notes, Drafts (`unsorted`), Starred, Archive, Trash, Templates, a folder, a tag. */
export interface NotesListArgs {
  space?: SpaceRef;
  view: NotesListView;
  /** Required for `folder`. */
  folderId?: string;
  /** Required for `tag`. */
  tagId?: string;
  /** Default "updated". */
  sort?: NotesSort;
  /**
   * Revision 4: only notes whose title or excerpt contains this (case-insensitive). The engine loads the whole
   * list (up to 5,000 notes) to filter it, so rows outside the loaded window are found too.
   */
  filter?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------------------

export interface SpaceSwitchArgs {
  space: SpaceRef;
}

export interface SpaceSwitchResult {
  space: SpaceRef;
}

export interface NoteCreateArgs {
  space?: SpaceRef;
  /** A folder to file it in; null or left out for Drafts. */
  folderId?: string | null;
  /** Makes it a page inside another note. */
  parentId?: string | null;
  title?: string;
  /** A template: `builtin:<key>` or a template note's id. */
  templateId?: string | null;
  /** Open it in the note page straight away (default false: native opens it with the zoom). */
  open?: boolean;
  /**
   * Revision 8 (R8.5): a note made from text (Services, Shortcuts, "New note with text"): the first line becomes the
   * title (unless it's a long paragraph) and the rest the body, each line a paragraph. `title` and `templateId`
   * are ignored then.
   */
  text?: string;
}

export interface NoteCreateResult {
  id: string;
}

export interface NoteIdsArgs {
  ids: string[];
}

export interface NoteStarArgs {
  ids: string[];
  starred: boolean;
}

export interface NoteMoveArgs {
  ids: string[];
  /** null: Drafts. */
  folderId: string | null;
}

export interface NoteArchiveArgs {
  ids: string[];
  archived: boolean;
}

/** What a bulk note action did. */
export interface BulkResult {
  /** The notes changed. */
  done: string[];
  /** Notes skipped (no permission). */
  skipped: number;
  /** Offline: queued on this device and reported as done. */
  queued: boolean;
}

export interface HiddenResult {
  hidden: number;
}

export interface FolderCreateArgs {
  space?: SpaceRef;
  name: string;
  parentId?: string | null;
  color?: string | null;
}

export interface FolderCreateResult {
  id: string;
}

/** Presses a gate screen's button (`GateChangedEvent.actions`), with its fields' values by field id. */
export interface GateActArgs {
  action: string;
  values?: Record<string, string>;
}

/** Taps a toast's button (`ToastEvent.action`). */
export interface ToastActionArgs {
  id: string;
}

export interface OkResult {
  ok: true;
}

// ---------------------------------------------------------------------------------------------------------------
// Editor commands (section 8, "Editor command API")
// ---------------------------------------------------------------------------------------------------------------

/** Inline marks the keyboard toolbar and the Format menu toggle. */
export type EditorMark = "bold" | "italic" | "underline" | "strike" | "code" | "highlight";

/**
 * Block types `format { block }` turns the current blocks into ("paragraph", "heading1", "heading2", "heading3",
 * "bulleted", "numbered", "todo", "toggle", "quote", "callout", and since revision 21 "code"). Turning a block into
 * its own type turns it back into a paragraph, as the toolbar does.
 */
export type EditorBlock = "paragraph" | "heading1" | "heading2" | "heading3" | "bulleted" | "numbered" | "todo" | "toggle" | "quote" | "callout" | "code";

/** The note's tool panels (web panels drawn in the Page View). */
export type EditorPanel = "format" | "insert" | "style" | "comments" | "ai" | "info" | "related";

/**
 * What `insert { kind }` adds: a block ("divider", "table", "code", "mention" types `@`, "slash" types `/` and opens
 * the slash menu at the caret (revision 11, R5.1)), or a special insert the
 * editor's menus run ("image", "file", "scan", "page", "bookmark", "embed", "date", "columns2", "tabs", ...; the
 * editor's SpecialInsert list). Revision 21: any tile of the Insert panel by its id ("heading-1", "mind-map",
 * "divider-strong", ...: the ids the native Insert sheet is generated with), and "quick-table-<rows>x<cols>".
 */
export type EditorInsertKind = string;

/** Actions of the note's "..." menu that need the note page (its dialogs and panels). */
export type NoteMenuAction = "share" | "move" | "copyTo" | "duplicate" | "export" | "history" | "present" | "print" | "find" | "delete";

export interface NotePrepareArgs {
  id: string;
}

export interface NoteShowArgs {
  id: string;
  /** Focus the editor (a new note opens ready to type in): an untitled, empty note in its title (revision 11, R5.4). */
  focus?: boolean;
  /**
   * Revision 20: the notes joined side by side in the note's tab, left to right (`id` among them, the one with
   * focus); missing for a note on its own. The page draws them as the web does (NotePanes).
   */
  panes?: string[];
  /** Each pane's share of the width (adding up to 1); missing is equal. */
  sizes?: number[];
  /** The other notes open in tabs, for the Join picker (open tabs first, then search). */
  tabs?: PaneTab[];
}

/** A note open in a tab of its own (the Join picker lists them first). */
export interface PaneTab {
  id: string;
  title: string;
}

export interface FormatArgs {
  mark?: EditorMark;
  block?: EditorBlock;
}

/** Revision 21: a line's text style, as the Format panel names them (Title, Subtitle and Heading are headings). */
export type TextStyleName = "title" | "subtitle" | "heading" | "strong" | "body" | "caption";

/** Revision 21: a block's alignment. */
export type BlockAlign = "left" | "center" | "right" | "justify";

/** Revision 21: a callout's tone. */
export type CalloutTone = "note" | "info" | "success" | "warning" | "danger";

/**
 * Revision 21: the rest of the Format panel, for the native Format sheet (each field given is applied; a null
 * colour, highlight or decoration clears it). Colours are the editor's names: text "muted", "accent", "moss",
 * "marigold", "plum", "coral"; highlights "yellow", "green", "blue", "pink".
 */
export interface FormatSetArgs {
  textStyle?: TextStyleName;
  textColor?: string | null;
  highlight?: string | null;
  align?: BlockAlign;
  /** "card" groups the lines on a card; "page" back on the page. */
  group?: "page" | "card";
  /** "focus" (a line beside it) or "block" (a background), or null. */
  decoration?: string | null;
  calloutTone?: CalloutTone;
  /** A code block's language ("plaintext", "swift", ...). */
  codeLanguage?: string;
  /** Clears the selection's marks, colours and highlight. */
  clear?: boolean;
}

/** Revision 21: the line's formatting at the caret, for the native Format sheet. */
export interface EditorFormatState {
  /** Null for a line that isn't text (a code block, an image). */
  textStyle: TextStyleName | null;
  textColor: string | null;
  highlight: string | null;
  align: BlockAlign;
  group: "page" | "card";
  decoration: string | null;
  calloutTone: CalloutTone | null;
  codeLanguage: string | null;
  /** The line takes the block tools (alignment, groups, decorations): a text line. */
  blockTools: boolean;
}

export interface InsertArgs {
  kind: EditorInsertKind;
}

export interface LinkArgs {
  /** null removes the link at the selection. */
  href: string | null;
}

export interface PanelOpenArgs {
  panel: EditorPanel;
}

export interface AiArgs {
  /** "open": the note's Foli AI panel; "ask": the panel with `prompt` sent. */
  action: "open" | "ask";
  prompt?: string;
}

export interface NoteMenuArgs {
  action: NoteMenuAction;
}

export interface InsetsArgs {
  /** The native bars' heights over the page, in CSS pixels, so content and the caret stay clear. */
  top: number;
  bottom: number;
}

/** The reply to `note.prepare` and `note.show`. */
export interface NoteShownResult {
  id: string;
  /** The note's first frame is already drawn (`note.ready` was sent before this reply). */
  ready: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------------------------

export interface EngineReadyEvent {
  place: string | null;
  protocol: number;
  revision: number;
}

/**
 * Which full screen native shows instead of the app (revision 3 adds everything but `gate`). Null `gate`: signed in
 * and ready, no screen. Values of `gate`:
 * - "loading": the page is starting, checking the session or opening the store (`title` says which).
 * - "modeChoice": first launch, "Where should your notes live?" (actions "account", "local").
 * - "signedOut": no session; native signs in with ShellAuth, then the page reloads into the account.
 * - "emailUnverified", "suspended", "setupFailed", "offline", "error": a message with its actions.
 * - "deviceLimit": too many devices (`deviceLimit`).
 * - "onboarding": the account hasn't finished onboarding (`onboarding.step`).
 * - "librarySetup", "libraryLocked": local mode's library needs choosing or unlocking (native's LibraryService).
 * - "updateRequired": this build is too old for the server.
 * - "migration": moving a library into an account or out of it, "move or keep" first (`migration`, `progress`).
 * - "placeMove": a move between places that switched here to run (`progress`).
 * - "e2eeLocked", "e2eeSetup", "e2eeWaiting", "e2eeTrust": an encrypted space to unlock, set up, wait for, or
 *   the trust choice right after unlocking (`e2ee`).
 * Each screen's buttons are `actions`; native sends `gate.act { action, values }` with the `fields` filled in.
 */
export interface GateChangedEvent {
  gate: string | null;
  /** The web's own heading and text for the screen (empty when native has its own words). */
  title: string;
  message: string;
  busy: boolean;
  actions: GateAction[];
  fields: GateField[];
  progress: GateProgress | null;
  migration: MigrationSummary | null;
  deviceLimit: DeviceLimitInfo | null;
  e2ee: E2eeGateInfo | null;
  onboarding: OnboardingGateInfo | null;
  /** What went wrong with the last action (a wrong passphrase), for the screen to show. */
  error: EngineError | null;
}

export interface GateAction {
  id: string;
  label: string;
  style: "primary" | "secondary" | "quiet" | "destructive";
  /** False while it can't be pressed yet ("Getting ready…"). */
  enabled: boolean;
}

export interface GateField {
  id: string;
  kind: "text" | "secret" | "recoveryKey" | "code";
  label: string;
  placeholder: string;
}

export interface GateProgress {
  done: number;
  total: number | null;
  label: string;
}

/** "Move your notes to Folevi" (and back to a library): what moves, and whether it fits. */
export interface MigrationSummary {
  direction: "upload" | "export";
  /** "ready" (asking move or keep), "moving", "stopped", "done". */
  phase: string;
  notes: number;
  folders: number;
  tags: number;
  files: number;
  fileBytes: number;
  /** The account's free storage; null when unknown. */
  availableBytes: number | null;
  fits: boolean;
  /** Notes the account has already (they stay beside the moved ones). */
  existingNotes: number;
  writable: boolean;
  /** Whether version history comes along (the "versions" action turns it on or off). */
  versions: boolean;
}

export interface DeviceLimitInfo {
  limit: number;
  /** The other devices signed in; each has the action `signOut:<id>`. */
  devices: GateDevice[];
}

export interface GateDevice {
  id: string;
  label: string;
  lastSeenAt: number;
}

export interface E2eeGateInfo {
  space: SpaceRef | null;
  spaceName: string | null;
  /** "choose", "passphrase", "recovery", "trust", "needsSetup", "waitingForKey", "opening". */
  view: string;
  /** Ways this device can unlock: "device" (approve from another device), "passkey", "passphrase", "recovery". */
  methods: string[];
  /**
   * Revision 8, approving from another device: "waiting" (asked), "compare" (`approvalCode` to compare on both
   * devices), "failed" (cancelled or expired), or null.
   */
  approval: string | null;
  approvalCode: string | null;
  /** Revision 8, setting encryption up ("e2eeSetup"): the step, "start", "methods", "recovery", "passphrase", "done". */
  setupStep: string | null;
  /** The new recovery key, shown once while `setupStep` is "recovery" (confirm groups 3 and 7 with `confirmRecovery`). */
  recoveryKey: string | null;
  /** Ways to unlock added so far ("recoveryKey", "passphrase", "passkey", "device"); two are needed. */
  methodsAdded: string[];
}

export interface OnboardingGateInfo {
  /** "workspace" (welcome), "uses", "style", "appearance", "ai", "welcome" (ready). */
  step: string;
  /**
   * Revision 10 (R14.2, R5.2): where it is, and the choices so far. The gate's actions: "continue" (with the
   * step's values: `useCases` as ids joined by commas, `noteStyle`, `appearance`, `aiEnabled` "true" or "false"),
   * "back", "skip" (this step), "skipAll" (to the summary) and, on the last step, "finish".
   */
  index: number;
  total: number;
  useCases: string[];
  useCaseOptions: OnboardingChoice[];
  noteStyle: string;
  noteStyleOptions: string[];
  appearance: string;
  aiEnabled: boolean;
}

export interface OnboardingChoice {
  id: string;
  label: string;
}

export interface PlaceChangedEvent {
  place: string | null;
  space: SpaceRef;
}

export interface ToastUndo {
  command: CommandName;
  args: Record<string, unknown>;
}

export interface ToastEvent {
  message: string;
  tone: "info" | "success" | "error";
  /** A command that undoes what the toast reports. */
  undo: ToastUndo | null;
  /**
   * Revision 2: a button the web page attached to its toast (Undo, Retry, Open, ...). Native shows `label` and
   * sends `toast.action { id }` when it's tapped; ids are good for a minute.
   */
  action: ToastAction | null;
}

export interface ToastAction {
  id: string;
  label: string;
}

/** A link inside a note (to another note or a screen) that native should open. */
export interface NavigateRequestEvent {
  /** The app route, `/d/<id>`, `/folders/<id>`, `/tasks/today`. */
  route: string;
  /** Set when the route is a note. */
  noteId: string | null;
  /** A web page outside Folevi (native opens it in Safari's sheet). */
  external: boolean;
  /** Revision 3: asked to open in a new tab or window (a modifier click, "Open in new tab"). */
  newTab: boolean;
}

/**
 * Revision 20: joined notes changed on the page (the Join picker, the Unjoin button, a pane's bar, a resize). Native
 * owns the tabs: it changes its tab and shows the note again with the new panes.
 */
export interface PanesChangeEvent {
  /** "join": `note` joins on the right; "unjoin": split at the gap after pane `gap`; "move": pane `from` to `to`;
   * "detach": `note` out into its own tab; "sizes": the panes' shares (null: equal). */
  action: "join" | "unjoin" | "move" | "detach" | "sizes";
  note?: string;
  gap?: number;
  from?: number;
  to?: number;
  sizes?: number[] | null;
}

export interface NoteReadyEvent {
  id: string;
  title: string;
}

/** The editor at the selection, for the keyboard toolbar (sent at most once a frame, only when it changed). */
export interface EditorStateEvent {
  noteId: string | null;
  focused: boolean;
  canEdit: boolean;
  /** The current block's `EditorBlock` type, or another block type name ("image", "table", ...). */
  block: string;
  marks: EditorMark[];
  link: boolean;
  undo: boolean;
  redo: boolean;
  /** Revision 8 (R8.9): Focus Mode is on (native hides its bars). */
  focus: boolean;
  /** Revision 8 (R8.9): the note is always fully encrypted ("Lock"). */
  locked: boolean;
  /** Revision 8: "Lock" is offered for this note (an account with encryption, the person's own space). */
  canLock: boolean;
  /** Revision 21: the line's formatting (null with no note open). */
  format: EditorFormatState | null;
}

export interface EditorPanelEvent {
  panel: EditorPanel | null;
}

export interface MemoryRelievedEvent {
  /** What was dropped ("editor", "caches"). */
  dropped: string[];
}

// ---------------------------------------------------------------------------------------------------------------
// Revision 4: notes, folders, Trash, templates, Shared with Me, Changes, notifications, search
// ---------------------------------------------------------------------------------------------------------------

export interface NoteReorderArgs {
  id: string;
  /** The note it goes right after in manual order; null: first. */
  afterId: string | null;
  view: NotesListView;
  folderId?: string;
  space?: SpaceRef;
}

export interface NoteCopyToArgs {
  ids: string[];
  /** Where the copies go: Personal or a workspace of this place. */
  space: SpaceRef;
  /** A folder there; null or left out: Drafts. */
  folderId?: string | null;
}

export interface TemplateCreateArgs {
  space?: SpaceRef;
  title?: string;
  /** Open it in the note page straight away. */
  open?: boolean;
}

export interface TrashEmptyResult {
  /** Notes being deleted for good now. */
  deleted: number;
  /** Notes left in Trash (this person may not delete them). */
  skipped: number;
  /** A very full Trash goes on emptying in the background. */
  continuing: boolean;
}

export interface FolderRenameArgs {
  id: string;
  name: string;
}

/** A tag's name and/or colour (the sidebar's Edit tag… and Color: …; organization.updateTag). */
export interface TagUpdateArgs {
  id: string;
  /** At most 40 characters. */
  name?: string;
  /** accent, moss, marigold, plum, coral or muted. */
  color?: string;
}

/** Delete tag…: removed from every note, the notes stay. */
export interface TagIdArgs {
  id: string;
}

export interface FolderSetColorArgs {
  id: string;
  /** A folder colour key, null for the default. */
  color: string | null;
}

/** Refused with `folder_self`, `folder_descendant` or `folder_depth`, as folderMoveProblem refuses. */
export interface FolderMoveArgs {
  id: string;
  /** New parent; null: the top level. */
  parentId: string | null;
  /** The sibling it goes right after; null: first among its new siblings. */
  afterId: string | null;
  /** The space whose folders it's checked against (default: the one shown). */
  space?: SpaceRef;
}

export interface FolderIdArgs {
  id: string;
}

export interface TrashSummaryValue {
  total: number;
  /** The ones this person may delete for good. */
  deletable: number;
}

export interface BuiltInTemplate {
  /** `builtin:<key>`, what `note.create { templateId }` takes. */
  key: string;
  name: string;
  description: string;
  /** An icon name from the web's template tiles ("calendar", "list-checks", ...). */
  icon: string;
}

export interface BuiltInTemplatesValue {
  templates: BuiltInTemplate[];
}

export interface FolderCardsArgs {
  space?: SpaceRef;
  /** Whose subfolders; null or left out: the top level. */
  parentId?: string | null;
  /** Revision 11 (R9.3): every folder of the space, nested ones too, in tree order (`parentId` is then ignored). */
  all?: boolean;
}

export interface FolderCardsValue {
  folders: FolderCard[];
}

/** Revision 21: the Tags page (OrganizeIndex.tsx TagsIndex): every tag of the space with how many pages it's on. */
export interface TagsIndexArgs {
  space?: SpaceRef;
}

export interface TagIndexRow {
  id: string;
  name: string;
  color: string;
  /** Pages with the tag that this person can open. */
  documentCount: number;
  /** Unix milliseconds (the page's Newest sort). */
  createdAt: number;
}

export interface TagsIndexValue {
  tags: TagIndexRow[];
}

/** A page shared with this person (`sharing.sharedWithMe`). */
export interface SharedRow {
  id: string;
  title: string;
  excerpt: string;
  icon: string | null;
  sharedBy: string;
  /** The workspace it lives in, or null for someone's Personal. */
  workspaceName: string | null;
  ownerName: string | null;
  /** "editor", "commenter" or "viewer" (open). */
  role: string;
  sharedAt: number;
  updatedAt: number;
  encrypted: boolean;
  h: string;
}

/** `shared.list`: a value view (lists of rows other than notes are value views; they're small). */
export interface SharedValue {
  rows: SharedRow[];
}

/** A change a connected app proposed to a note (`proposals.list`). */
export interface ProposalRow {
  id: string;
  /** Null when this person can't open the note any more. */
  noteId: string | null;
  title: string;
  sourceName: string;
  /** The added lines as plain text, for the row's preview. */
  summary: string;
  createdAt: number;
  /** Why it can't be accepted any more (only Reject is offered), or null. */
  problem: string | null;
}

/** A note someone else changed since this person last looked (`changes.list`). */
export interface ChangedNoteRow {
  id: string;
  title: string;
  icon: string | null;
  /** "Maya and 2 others". */
  who: string;
  /** "3 lines added, 1 removed". */
  counts: string;
  changedAt: number;
}

export interface ChangesValue {
  proposals: ProposalRow[];
  notes: ChangedNoteRow[];
}

export interface ProposalIdArgs {
  id: string;
}

/** A notification in the bell (`notifications.list`). */
export interface NotificationRow {
  id: string;
  /** "mention", "comment", "share", "invite", "reminder", "change", ... (open). */
  kind: string;
  title: string;
  /** "" when there's none (or the note can't be read any more). */
  body: string;
  at: number;
  read: boolean;
  /** Where tapping it goes (an app route), or null. */
  route: string | null;
  actorName: string | null;
  actorAvatarUrl: string | null;
  noteId: string | null;
  noteTitle: string | null;
  /** How many events it stands for ("and 3 more"). */
  count: number;
  /** A workspace invitation to accept (`invite.accept`), or null. */
  inviteId: string | null;
  /** A page invitation to accept (`pageInvite.accept`), or null. */
  pageInviteId: string | null;
  /** A folder shared with this person (revision 12): `route` opens it (`/shared/<id>`, `sharedFolder.open`). */
  folderId: string | null;
  /** A folder invitation to accept (`folderInvite.accept`) or decline (`invite.decline { kind: "folder" }`), or null (revision 12). */
  folderInviteId: string | null;
  /** A file to download, or null. */
  fileId: string | null;
}

export interface NotificationsValue {
  unread: number;
  rows: NotificationRow[];
}

export interface NotificationMarkArgs {
  ids: string[];
  /** true: read; false: unread. */
  read: boolean;
}

export interface NotificationIdsArgs {
  ids: string[];
}

export interface InviteAcceptArgs {
  inviteId: string;
}

export interface PageInviteAcceptResult {
  noteId: string;
}

/** `search`: a one-off query (debounce it), or a live view while the search screen is up. */
export interface SearchArgs {
  text: string;
  /** "place" (the space shown, or `space`) or "everywhere" (every space of this place). Default "place". */
  scope?: "place" | "everywhere";
  space?: SpaceRef;
  folderId?: string;
  tagId?: string;
  /** Only notes edited after this (milliseconds since 1970). */
  updatedAfter?: number;
  includeArchived?: boolean;
  /** Revision 9 (R11.1): only notes this person created (a profile id; with `scope: "place"` only). */
  creatorId?: string;
  /** Also search by meaning where the plan has it (`meaningAvailable`). */
  meaning?: boolean;
  /** Default 20, at most 40. */
  limit?: number;
}

export interface SearchHit {
  id: string;
  title: string;
  icon: string | null;
  /** The matched text around the match. */
  snippet: string;
  folder: FolderChip | null;
  updatedAt: number;
  archived: boolean;
  kind: string;
  /** Everywhere: the space it's in ("personal" or a workspace id) and its name. */
  space: SpaceRef | null;
  spaceName: string | null;
  /** "text" (the note's words), "file" (in a file or drawing), "meaning" (search by meaning). */
  matchIn: string;
  /** A match in a file: the block that holds it, and its page (PDFs). */
  blockId: string | null;
  page: number | null;
}

export interface SearchValue {
  text: string;
  hits: SearchHit[];
  /** Search by meaning can be asked for here. */
  meaningAvailable: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Revision 5: tasks, the calendar, Quick Add
// ---------------------------------------------------------------------------------------------------------------

export type TaskViewName = "inbox" | "today" | "upcoming" | "all" | "completed" | "mine";

/** A to-do as the task screens show it (`tasks.list`, `tasks.range`). Its id is the to-do block's. */
export interface TaskRow {
  id: string;
  noteId: string;
  noteTitle: string;
  noteIcon: string | null;
  title: string;
  /** "open", "done" or "canceled". */
  status: string;
  /** YYYY-MM-DD, or null. */
  dueDate: string | null;
  /** HH:MM, or null. */
  dueTime: string | null;
  /** "low", "medium", "high", or null. */
  priority: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  reminderAt: number | null;
  /** "daily", "weekly", "monthly", "yearly", "weekdays", ... (open), or null. */
  repeat: string | null;
  completedAt: number | null;
  updatedAt: number;
  /** Open and due before today. */
  overdue: boolean;
}

/** A heading in a task list: a note (most views) or a day (Upcoming). */
export interface TaskGroup {
  /** The note's id, or the day (YYYY-MM-DD). */
  id: string;
  kind: "note" | "day";
  title: string;
  icon: string | null;
  tasks: TaskRow[];
}

export interface TasksListArgs {
  space?: SpaceRef;
  view: TaskViewName;
}

export interface TasksValue {
  view: TaskViewName;
  groups: TaskGroup[];
  /** Tasks in all groups. */
  total: number;
}

export interface TaskCounts {
  inbox: number;
  today: number;
  upcoming: number;
  all: number;
  mine: number;
}

export interface TasksRangeArgs {
  space?: SpaceRef;
  /** YYYY-MM-DD, both included. */
  from: string;
  to: string;
  includeCompleted?: boolean;
}

export interface TasksRangeValue {
  tasks: TaskRow[];
}

/** An event from a subscribed calendar. Times are milliseconds since 1970 (UTC); all-day events cover whole days. */
export interface CalendarEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  /** A colour key ("accent", "moss", ...). */
  color: string;
  title: string;
  location: string;
  description: string;
  start: number;
  end: number;
  allDay: boolean;
}

export interface CalendarEventsArgs {
  /** Milliseconds since 1970; at most 400 days apart. */
  from: number;
  to: number;
}

export interface CalendarEventsValue {
  events: CalendarEvent[];
}

/** A calendar this person subscribed to (by its link). */
export interface CalendarSubscription {
  id: string;
  name: string;
  url: string;
  color: string;
  visible: boolean;
  lastFetchedAt: number | null;
  lastError: string | null;
  eventCount: number | null;
  loading: boolean;
}

export interface CalendarsValue {
  calendars: CalendarSubscription[];
}

/** A person tasks can be assigned to in a workspace. */
export interface MemberRow {
  id: string;
  name: string;
  email: string;
  /** "owner", "admin", "member" (open). */
  role: string;
  isYou: boolean;
}

export interface MembersValue {
  members: MemberRow[];
}

/** `task.parse`: what Quick Add reads in what's typed ("call Sam tomorrow 3pm every monday"). */
export interface TaskParseArgs {
  text: string;
}

export interface TaskParseValue {
  /** The task's words without the date and repeat. */
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  /** The words that said the date ("tomorrow 3pm"), to show and let the person keep as text. */
  dateText: string | null;
  /** "Every Monday", or null. */
  repeatLabel: string | null;
  repeatText: string | null;
}

export interface TaskCreateArgs {
  /** What was typed; dates and repeats in it are read unless `keepText` says not to. */
  text: string;
  space?: SpaceRef;
  /** The note it goes in; left out: the Inbox page. */
  noteId?: string;
  /** Overrides what's read from the text. */
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: "low" | "medium" | "high";
  /** Keep the date (and repeat) words as text instead of reading them. */
  keepText?: boolean;
}

export interface TaskCreateResult {
  id: string;
  noteId: string;
  /** "Inbox" or the note's title, for "Task added to …". */
  where: string;
}

/** Changes one task; fields left out stay as they are. */
export interface TaskUpdateArgs {
  id: string;
  checked?: boolean;
  canceled?: boolean;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: "none" | "low" | "medium" | "high";
  assigneeId?: string | null;
  reminderAt?: number | null;
  /**
   * Revision 9 (R10.2): "daily", "weekly", "weekdays", "monthly", "yearly", or a rule ("every 2 weeks on mon,thu",
   * "every 3 days"); null: no repeat. Needs `noteId`: the repeat is the to-do line's own, saved through the note.
   */
  repeat?: string | null;
  /** The task's note (required with `repeat`). */
  noteId?: string;
}

export interface TaskMoveArgs {
  id: string;
  /** Left out: the Inbox page. */
  noteId?: string;
}

export interface CalendarAddArgs {
  url: string;
  name?: string;
  color?: string;
}

export interface CalendarAddResult {
  id: string;
}

export interface CalendarUpdateArgs {
  id: string;
  name?: string;
  color?: string;
  visible?: boolean;
}

export interface CalendarIdArgs {
  id: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Revision 6: the account, Settings, sharing and invitations, web pages
// ---------------------------------------------------------------------------------------------------------------

export interface PlanInfo {
  /** "free", "core", "pro", "pro_ai", "team", ... (open). */
  tier: string;
  /** The plan's id ("personal_pro_month", ...), open. */
  id: string;
  paid: boolean;
  trialing: boolean;
  trialEndsAt: number | null;
  /** Foli AI is included. */
  ai: boolean;
}

export interface StorageInfo {
  usedBytes: number;
  /** Null: no limit. */
  limitBytes: number | null;
}

export interface AccountSpace {
  id: SpaceRef;
  kind: "personal" | "workspace";
  name: string;
  logoUrl: string | null;
  role: string;
  storage: StorageInfo | null;
  /** Revision 9 (R11.3): the space's plan ("Free", "Team", "Business"); null when unknown. */
  planName: string | null;
}

/** `account.details`: the open account for the account and place switcher and Settings > Account. */
export interface AccountDetails {
  profile: ProfileInfo;
  plan: PlanInfo | null;
  /** Personal storage, once the server has answered. */
  storage: StorageInfo | null;
  devicesActive: number | null;
  /** How many devices the plan allows; null: unlimited. */
  deviceLimit: number | null;
  spaces: AccountSpace[];
}

/** Settings > Account. */
export interface AccountSettings {
  name: string;
  email: string;
  avatarUrl: string | null;
  timeZone: string;
}

/** Settings > General. */
export interface GeneralSettings {
  timeZone: string;
  locale: string;
  /** Changes connected apps make to existing notes wait in Changes for review. */
  reviewAppEdits: boolean;
}

/** Settings > Appearance. */
export interface AppearanceSettings {
  appearance: "system" | "light" | "dark";
  /** Revision 10 (R13.1): the editor's text size on this device, 0.85 to 1.35 (1 is the default). */
  editorZoom: number;
  /** The sizes offered. */
  editorZooms: number[];
}

/** One kind of notification: in the app (the bell) and by email. */
export interface NotificationTopicSetting {
  /** "comments", "replies", "mentions", "shares", "access", "reminders". */
  id: string;
  label: string;
  hint: string;
  inApp: boolean;
  email: boolean;
}

/** Settings > Notifications. */
export interface NotificationSettings {
  topics: NotificationTopicSetting[];
  /** "off" or "daily". */
  digest: string;
  productEmail: boolean;
}

/** Settings > Foli AI, the basics. */
export interface AiSettings {
  /** Foli AI is on the plan here. */
  included: boolean;
  /** Turned on by this person. */
  enabled: boolean;
  history: boolean;
  memory: boolean;
  suggestions: boolean;
  attachments: boolean;
  webResearch: boolean;
  digests: boolean;
  readImages: boolean;
  deviceText: boolean;
}

export interface SessionRow {
  id: string;
  label: string;
  /** "web", "mac", "ios", "android" (open). */
  client: string;
  current: boolean;
  lastSeenAt: number;
}

/** Settings > Security, the basics: where this account is signed in. */
export interface SecuritySettings {
  sessions: SessionRow[];
  /** Revision 10 (R13.2): two-step verification is on; null until the sign-in service answered. */
  twoFactor: boolean | null;
  passkeys: PasskeyRow[];
  /** Ways to sign in: "password", "google", "apple" (open). */
  methods: string[];
}

export interface PasskeyRow {
  id: string;
  name: string;
  createdAt: number | null;
  lastUsedAt: number | null;
}

export interface SettingsUpdateArgs {
  name?: string;
  appearance?: "system" | "light" | "dark";
  timeZone?: string;
  reviewAppEdits?: boolean;
  aiEnabled?: boolean;
  /** Revision 10 (R13.1): the editor's text size on this device (one of `AppearanceSettings.editorZooms`). */
  editorZoom?: number;
}

export type AiPrefKey = "history" | "memory" | "suggestions" | "attachments" | "webResearch" | "digests" | "readImages" | "deviceText";

export interface AiPrefArgs {
  key: AiPrefKey;
  on: boolean;
}

export interface NotificationTopicArgs {
  topic: string;
  inApp?: boolean;
  email?: boolean;
}

export interface NotificationEmailsArgs {
  digest?: "off" | "daily";
  productEmail?: boolean;
}

export interface SessionIdArgs {
  id: string;
}

/** Someone with access to a note. */
export interface ShareGrant {
  profileId: string;
  name: string;
  /** Only for people who manage the note. */
  email: string | null;
  /** "editor", "commenter", "viewer". */
  role: string;
  guest: boolean;
  isYou: boolean;
  canChange: boolean;
}

export interface ShareInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: number;
  expired: boolean;
}

export interface PublicLinkRow {
  id: string;
  /** The link's first characters (the whole link is shown once, when made). */
  tokenHint: string;
  expiresAt: number | null;
  expired: boolean;
  hasPassword: boolean;
  allowIndexing: boolean;
  /** "note", "article", "docs", "minimal". */
  theme: string;
  viewCount: number;
  createdAt: number;
  encrypted: boolean;
}

/** `sharing.get`: who has a note, its invitations and public links, and what this person may change. */
export interface SharingValue {
  noteId: string;
  /** "workspace" (everyone in the workspace) or "restricted". */
  accessMode: string;
  yourAccess: string;
  canManage: boolean;
  canShare: boolean;
  /** The highest role this person may give, or null. */
  maxRole: string | null;
  youAreGuest: boolean;
  ownerName: string;
  sharedBy: string | null;
  people: ShareGrant[];
  invites: ShareInvite[];
  links: PublicLinkRow[];
  publicLinksAvailable: boolean;
  /** End-to-end encrypted: public links are made from the note page (`note.menu share`). */
  encrypted: boolean;
}

export interface ShareInviteArgs {
  noteId: string;
  email: string;
  role: "editor" | "commenter" | "viewer";
}

export interface ShareInviteResult {
  /** "shared" (they have an account) or "invited" (an email went out). */
  status: string;
}

export interface ShareRevokeArgs {
  noteId: string;
  profileId: string;
}

export interface ShareInviteIdArgs {
  inviteId: string;
}

export interface AccessModeArgs {
  noteId: string;
  mode: "workspace" | "restricted";
}

export interface PublicLinkCreateArgs {
  noteId: string;
  expiresAt?: number;
  password?: string;
  allowIndexing?: boolean;
  theme?: "note" | "article" | "docs" | "minimal";
  /**
   * Revision 8, an end-to-end encrypted note: false or left out makes an encrypted link (its key in the link's
   * fragment; the reader's browser opens it); true publishes a readable copy (after the person confirmed that it
   * won't be encrypted and won't follow later edits).
   */
  plainCopy?: boolean;
}

export interface PublicLinkCreateResult {
  id: string;
  /** The whole link, shown (and copied) once. */
  url: string;
}

export interface PublicLinkThemeArgs {
  linkId: string;
  theme: "note" | "article" | "docs" | "minimal";
}

export interface PublicLinkIdArgs {
  linkId: string;
}

export interface InviteTokenArgs {
  /** "workspace" or "page"; "folder" since revision 12 (/share-invite/folder/<token>). */
  kind: "workspace" | "page" | "folder";
  token: string;
}

/** `invite.preview`: an invitation link opened in the app. */
export interface InvitePreview {
  valid: boolean;
  kind: "workspace" | "page" | "folder";
  inviterName: string | null;
  /** The workspace's name, the page's title or the folder's name (null when the invitation is for another address). */
  name: string | null;
  roleLabel: string | null;
  emailMatches: boolean;
}

export interface InviteTokenAcceptResult {
  /** The page to open (page invitations) or the workspace to show. */
  noteId: string | null;
  space: SpaceRef | null;
  /** The folder to open (folder invitations, revision 12), else null. */
  folderId: string | null;
}

/** Web pages the native app shows in the Page View with its own bars (owner decision Q1 and Q2). */
export type WebPage =
  | "settings.connectedApps"
  | "settings.workspaceData"
  | "settings.data"
  | "settings.aiExport"
  | "reviews"
  | "graph"
  // Revision 10 (R13.2, R13.4): two-step verification and passkeys (WebAuthn), encryption, the workspace's
  // members, guests, billing and privacy, and deleting the account.
  | "settings.security"
  | "settings.privacy"
  | "settings.workspace"
  | "settings.deleteAccount";

export interface WebShowArgs {
  page: WebPage;
}

// ---------------------------------------------------------------------------------------------------------------
// Revision 7: the Foli AI chat (section 5.9: native screens; the answer streams as a live view)
// ---------------------------------------------------------------------------------------------------------------

export interface ChatConversationRow {
  id: string;
  title: string;
  pinned: boolean;
  /** What it's about: "note", "notes", "folder", "workspace", "selection", "none" (open). */
  context: string;
  lastMessageAt: number;
  createdAt: number;
  shared: boolean;
}

export interface ChatConversationsArgs {
  space?: SpaceRef;
  /** Titles and messages containing this (one page of matches, pinned first). */
  search?: string;
}

export interface ChatConversationsValue {
  pinned: ChatConversationRow[];
  recent: ChatConversationRow[];
  /** More older conversations than these. */
  more: boolean;
}

export interface ChatCitation {
  n: number;
  noteId: string;
  title: string;
  blockId: string | null;
}

export interface ChatWebCitation {
  n: number;
  url: string;
  title: string;
  domain: string;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** "image", "pdf", "sheet", "text", "audio", "file" (open). */
  kind: string;
}

/** A change an answer proposes (Apply or Dismiss): make a folder, make a note, move a note. */
export interface ChatAction {
  /** "createFolder", "createNote", "moveNote" (open). */
  type: string;
  /** The folder's name, the note's title (to make or to move). */
  title: string;
  /** A note to make: its Markdown. */
  markdown: string | null;
  /** The note to move. */
  noteId: string | null;
  folderId: string | null;
  folderName: string | null;
}

export interface ChatAgentStep {
  tool: string;
  count: number;
  ok: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** Markdown. While `live`, the rest of it streams in `ai.stream`. */
  text: string;
  /** "streaming", "done", "stopped", "error". */
  status: string;
  /** The text so far is in `ai.stream { messageId }`. */
  live: boolean;
  /** What it's doing ("Reading your notes"), while it streams. */
  phase: string | null;
  error: EngineError | null;
  citations: ChatCitation[];
  webCitations: ChatWebCitation[];
  /** Follow-up questions to offer. */
  suggestions: string[];
  credits: number | null;
  attachments: ChatAttachment[];
  actions: ChatAction[];
  /** "applied", "dismissed", or null while it waits for an answer. */
  actionsOutcome: string | null;
  /** An agent's answer: the steps it took, and whether it offers Continue. */
  agentSteps: ChatAgentStep[];
  agentMore: boolean;
  /** A preference it offers to remember (Save or Not now). */
  memory: ChatMemoryOffer | null;
  createdAt: number;
  /** Revision 8: the agent's proposed changes, to approve (`ai.agentApprove`), discard, or undo once done. */
  agentRun: ChatAgentRun | null;
}

export interface ChatAgentRun {
  id: string;
  /** "preview" (waiting for approval), "running", "done", "discarded", "undone", "failed" (open). */
  status: string;
  operations: ChatAgentOperation[];
}

export interface ChatAgentOperation {
  id: string;
  /** "edit_note", "create_note", "move_note", "tag_note", ... (open). */
  kind: string;
  /** What it does, for people. */
  summary: string;
  /** "pending", "done", "failed", "skipped", ... (open). */
  status: string;
  error: string | null;
  noteId: string | null;
  noteTitle: string | null;
  /** A note to make, or text to add: the start of its Markdown. */
  markdown: string | null;
  /** A note's edits: what each changes. */
  edits: ChatAgentEdit[];
}

export interface ChatAgentEdit {
  /** "replace", "insert", "delete" (open). */
  action: string;
  before: string;
  after: string;
}

export interface ChatMemoryOffer {
  /** "tone", "language", "length", "term", "instruction" (open). */
  kind: string;
  text: string;
  /** "proposed", "saved", "dismissed". */
  status: string;
}

export interface ChatConversationInfo {
  id: string;
  title: string;
  pinned: boolean;
  /** Not kept (history off): it lasts while the chat is open. */
  ephemeral: boolean;
  space: SpaceRef;
  context: string;
  shared: boolean;
  canShare: boolean;
  createdAt: number;
  lastMessageAt: number;
}

export interface ChatConversationValue {
  /** False when it's gone (or not this person's), or new and not yet sent. */
  found: boolean;
  conversation: ChatConversationInfo | null;
  messages: ChatMessage[];
}

export interface ChatStreamArgs {
  messageId: string;
}

/** `ai.stream`: the answer's text so far (null once it's finished; read the message then). */
export interface ChatStreamValue {
  messageId: string;
  text: string | null;
}

/** What Foli AI can do here. */
export interface ChatCapabilities {
  /** On the plan here and turned on. */
  available: boolean;
  vision: boolean;
  webResearch: boolean;
  attachments: boolean;
  /** Conversations are kept (Settings > Foli AI > History). */
  history: boolean;
  agent: boolean;
  /**
   * Revision 16. Why Foli AI can't be used here (null when it can): "off" (turned off in Settings > AI), "plan" (not on the
   * person's plan), "workspacePlan" (not on this workspace's plan), "setup" (local mode: no model on this device
   * yet). Open: show the message for an unknown one as "plan".
   */
  unavailable: string | null;
  /** Revision 16 (R12.7): the AI credits that apply here; null in local mode (no credits) and while unknown. Usage only. */
  credits: ChatCredits | null;
}

/** R12.7: the AI credits that apply where the person is working (billing.credits). Never a purchase surface. */
export interface ChatCredits {
  /** Foli AI is on the plan here. */
  included: boolean;
  /** Credits left in all (this period's and bought ones). */
  available: number;
  /** Few enough left that the chat says so (the web's AiCreditsNote: under 20% of the month, or a handful). */
  low: boolean;
  /** When this period's credits reset (ms), or the trial ends. */
  resetsAt: number | null;
  trialing: boolean;
  /** A seat in a team workspace (the workspace's credits). */
  seat: boolean;
  /** More can be bought here ("Buy more"); false on iOS and in local mode. */
  canBuy: boolean;
}

export interface ChatContextArgs {
  /** "note", "notes", "folder", "workspace". */
  kind: "note" | "notes" | "folder" | "workspace";
  ids: string[];
}

export interface ChatSendArgs {
  /** Left out: a new conversation (its id comes back). */
  conversationId?: string;
  text: string;
  space?: SpaceRef;
  /** What a new conversation is about. */
  context?: ChatContextArgs;
  /** Let it search the web. */
  web?: boolean;
  /** Files uploaded for the chat. */
  attachments?: string[];
  /**
   * "auto" (the default: a request to change notes goes to the agent, a question gets the quick answer), "ask",
   * "agent", or (revision 8) "research": a report from the web and the notes, followed in `ai.research`.
   */
  mode?: "auto" | "ask" | "agent" | "research";
}

export interface ChatSendResult {
  conversationId: string;
  /** The answer being written: watch `ai.conversation` (and `ai.stream` while it's live). */
  messageId: string | null;
}

export interface ChatEditArgs {
  conversationId: string;
  messageId: string;
  text: string;
  web?: boolean;
}

export interface ChatConversationArgs {
  conversationId: string;
  web?: boolean;
}

export interface ChatRenameArgs {
  conversationId: string;
  title: string;
}

export interface ChatPinArgs {
  conversationId: string;
  pinned: boolean;
}

/** Revision 21 (R12.6): share a conversation with its workspace (ConversationActions.tsx), or stop sharing it. */
export interface ChatShareArgs {
  conversationId: string;
  shared: boolean;
}

export interface ChatMessageArgs {
  messageId: string;
}

export interface ChatSaveArgs {
  conversationId: string;
  /** Just one answer (and its question); left out: the whole conversation. */
  messageId?: string;
}

/** Revision 21: a conversation (or one answer) as the web's Markdown file (ConversationActions.tsx's Copy as
 *  Markdown and Download Markdown), with its file name. */
export interface ChatMarkdownResult {
  filename: string;
  markdown: string;
}

export interface ChatActionsArgs {
  conversationId: string;
  messageId: string;
  /** Apply the proposed changes, or dismiss them. */
  apply: boolean;
}

export interface ChatMemoryArgs {
  messageId: string;
  save: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Revision 8: the Mac frame's R8.5 to R8.9, research, the agent's changes, the profile picture
// ---------------------------------------------------------------------------------------------------------------

/** R8.6: a macOS banner's action. */
export interface NotificationActArgs {
  /** The notification's id. */
  id: string;
  /** "reply" (with `text`), "read", "done" (a task), "snooze-hour", "snooze-evening", "snooze-tomorrow" (a reminder). */
  action: string;
  text?: string;
  /** The comment thread to reply in, when the banner knows it. */
  thread?: string;
}

/** R8.7: where notes can go from the open place. */
export interface PlaceMoveDestination {
  /** Pass as `to`: "<place id>|personal" or "<place id>|ws:<workspace id>". */
  value: string;
  label: string;
  place: string;
  space: SpaceRef;
  /** The library's page can't reach accounts: the move runs from the account's page after switching there. */
  switches: boolean;
}

export interface PlaceMovePreviewArgs {
  /** A destination's `value`; left out: the first one. */
  to?: string;
  folders?: string[];
  notes?: string[];
}

/** `places.move.preview`: the destinations, and what goes (everything here, or the folders and notes picked). */
export interface PlaceMovePreview {
  from: string;
  destinations: PlaceMoveDestination[];
  to: PlaceMoveDestination | null;
  folders: number;
  notes: number;
  everything: boolean;
  /** Whether it fits the destination's storage, when known (null: not known; the move says if it doesn't). */
  fits: boolean | null;
}

export interface PlaceMoveArgs {
  to: string;
  /** Left out or both empty: everything in the open space. */
  folders?: string[];
  notes?: string[];
  /** true: copy (they stay here too); false: move (they go to Trash here). */
  copy: boolean;
  /** Bring version history (default true). */
  versions?: boolean;
}

/** The move's result; its progress shows as the `placeMove` gate while it runs. */
export interface PlaceMoveResult {
  /** "done", or "switched" (the page goes to the account to run it there). */
  status: string;
  notes: number;
  problems: number;
}

/** R8.8: notes' current titles, for restored tabs. */
export interface NotesMetaArgs {
  ids: string[];
}

export interface NoteBrief {
  id: string;
  /** False: gone, or not readable any more. */
  found: boolean;
  title: string;
  icon: string | null;
  inTrash: boolean;
}

export interface NotesMetaValue {
  notes: NoteBrief[];
}

/** R8.9 */
export interface BlockMoveArgs {
  dir: "up" | "down";
}

/** A research job for a conversation (`ai.research`): its steps and its report's sources. */
export interface ResearchStep {
  /** "plan", "notes", "search", "read", "write". */
  kind: string;
  label: string;
  /** "running", "done", "failed", "skipped". */
  status: string;
  count: number | null;
}

export interface ResearchSource {
  n: number;
  /** "note" or "web". */
  kind: string;
  /** The note's id, or null for a web page. */
  noteId: string | null;
  url: string | null;
  title: string;
  domain: string | null;
}

export interface ResearchJob {
  id: string;
  messageId: string;
  question: string;
  /** "running", "done", "failed", "cancelled". */
  status: string;
  steps: ResearchStep[];
  sources: ResearchSource[];
  /** The report saved as a note, once it is. */
  noteId: string | null;
  error: EngineError | null;
  credits: number | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface ResearchArgs {
  conversationId: string;
}

export interface ResearchValue {
  jobs: ResearchJob[];
}

export interface ResearchIdArgs {
  researchId: string;
}

export interface ResearchSaveArgs {
  researchId: string;
  folderId?: string;
}

export interface AgentApproveArgs {
  runId: string;
  /** The operations to run (all of `ChatAgentRun.operations`, or the ones the person kept ticked). */
  operationIds: string[];
}

export interface AgentRunArgs {
  runId: string;
}

export interface AgentUndoResult {
  /** "undone", or "changed" (some notes changed since: `changed` lists them; undo again with `force`). */
  status: string;
  changed: string[];
}

export interface AgentUndoArgs {
  runId: string;
  /** Undo even what changed since ("all"), or only what didn't ("rest"). */
  force?: "all" | "rest";
}

/** The profile picture: the image's bytes as base64 in `data`, or POSTed to `/_bridge/<bodyId>` (big ones). */
export interface AvatarArgs {
  data?: string;
  bodyId?: string;
  /** "image/jpeg", "image/png", "image/webp", "image/gif". */
  mimeType: string;
  name?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Revision 9: the Tasks, Calendar, Search, Notifications and Places requests (R10.2 to R11.5)
// ---------------------------------------------------------------------------------------------------------------

/** R10.3: the calendar feed (tasks in another calendar app). */
export interface CalendarFeedValue {
  /** A link exists. */
  active: boolean;
  /** Always null here: the link is shown once, when it's made (`calendar.feedCreate`); the server keeps only its hash. */
  url: string | null;
  createdAt: number | null;
  lastFetchedAt: number | null;
  /** The feed has workspaces' tasks too, not only Personal's. */
  includeWorkspaces: boolean;
}

export interface CalendarFeedCreateArgs {
  includeWorkspaces?: boolean;
}

export interface CalendarFeedCreateResult {
  /** The .ics link, shown once (making a new one ends the old one). */
  url: string;
}

export interface CalendarFeedWorkspacesArgs {
  includeWorkspaces: boolean;
}

/** R11.4 */
export interface FileUrlsArgs {
  ids: string[];
}

export interface FileLink {
  /** A short-lived signed link, or null when the file can't be had. */
  url: string | null;
  filename: string | null;
  mimeType: string | null;
  size: number | null;
  /** End-to-end encrypted: the bytes behind `url` are ciphertext (opened in the note page). */
  sealed: boolean;
}

export interface FileUrlsValue {
  urls: Record<string, FileLink>;
}

/** R11.5 */
export interface RecentArgs {
  /** "place" (the space shown) or "everywhere" (every space of this place). Default "place". */
  scope?: "place" | "everywhere";
  /** Default 10, at most 30. */
  limit?: number;
}

/** A recent note and the space it's in. */
export interface RecentRow {
  row: NoteRow;
  space: SpaceRef;
  spaceName: string;
}

export interface RecentValue {
  rows: RecentRow[];
}

// ---------------------------------------------------------------------------------------------------------------
// Revision 10: the Settings and sign-in requests (R13.1 to R14.4)
// ---------------------------------------------------------------------------------------------------------------

/** One space's device copy (plan 11.8), as Settings > This device shows it. */
export interface SpaceCopyInfo {
  space: SpaceRef;
  name: string;
  /** "listing", "filling", "live"; "encrypted" for a space with end-to-end encryption (its own copy). */
  phase: string;
  have: number;
  total: number | null;
}

/** `device.storage` (R13.3): this place's copy on this device. */
export interface DeviceStorageValue {
  place: string | null;
  /** "Keep all notes on this device" (this account, on this device). */
  keepAll: boolean;
  /** The copy is running here (account mode, not a public computer). */
  available: boolean;
  spaces: SpaceCopyInfo[];
  notesKept: number | null;
  attachmentsKept: number | null;
  attachmentsBytes: number | null;
  /** What Folevi takes on this device, and what's free (the browser's estimate); null when unknown. */
  usedBytes: number | null;
  freeBytes: number | null;
  /** The attachments' budget: 2 GB or a tenth of the free space, whichever is smaller. */
  attachmentLimitBytes: number | null;
  /** Changes on this device waiting to sync (never removed with the copy). */
  waiting: number;
}

export interface DeviceKeepAllArgs {
  on: boolean;
}

export interface DeviceRemoveCopyArgs {
  /** Remove even when changes wait (they stay either way; this only skips the question). */
  force?: boolean;
}

export interface DeviceRemoveCopyResult {
  removed: boolean;
  /** Changes waiting: without `force`, nothing is removed and native asks first. */
  waiting: number;
}

export interface ShareRoleArgs {
  noteId: string;
  profileId: string;
  role: "editor" | "commenter" | "viewer";
}

// ---------------------------------------------------------------------------------------------------------------
// The maps (names to argument and result types). The codegen reads these interfaces.
// ---------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------
// Revision 11: declining invitations, the support form, folder locks, a note's changes, All folders, Foli AI drafts
// ---------------------------------------------------------------------------------------------------------------

/** `invite.decline` (R11.2): by the notification's id, or by the link's token (`invite.preview`). */
export interface InviteDeclineArgs {
  /** "folder" since revision 12. */
  kind: "workspace" | "page" | "folder";
  inviteId?: string;
  token?: string;
}

/** A topic of the support form. */
export interface SupportTopic {
  id: string;
  label: string;
}

/** `support.topics` (R13.5): the form's topics, in order. */
export interface SupportTopicsValue {
  topics: SupportTopic[];
}

/** `support.send` (R13.5): filed under the signed-in account and its address; `name` left out: the profile's. */
export interface SupportSendArgs {
  topic: string;
  /** 10 to 5000 characters. */
  message: string;
  name?: string;
}

export interface SupportSendResult {
  /** The request's number (#1234) for the confirmation. */
  number: number | null;
}

/** `folder.lock` (R9.1): makes the space's key first when it has none; "e2ee_not_set_up" when the account has no keys. */
export interface FolderLockArgs {
  id: string;
  locked: boolean;
  space?: SpaceRef;
}

export interface ChangeDiffArgs {
  id: string;
}

/** A run of an edited line's words: "same", "added" or "removed". */
export interface ChangeTextPart {
  kind: string;
  text: string;
}

/** One changed block of `changes.diff` (R9.2), drawn from text. */
export interface ChangeDiffBlock {
  id: string;
  /** "added", "removed", "changed" (the words) or "styled" (the same words, another type or format). */
  change: string;
  /** Block type as in PreviewLine.t ("paragraph", "heading", "todo", ...); `l` heading level, `c` checked. */
  t: string;
  x: string;
  l?: number;
  c?: boolean;
  /** "changed": the text before, and the words kept, added and removed (when the version from before is known). */
  before?: string;
  parts?: ChangeTextPart[];
  /** Who made it (a person's name, an app, "Foli AI"), when known. */
  who: string | null;
  at: number | null;
}

export interface ChangeDiffValue {
  id: string;
  title: string;
  blocks: ChangeDiffBlock[];
  /** More changed lines than the server sends. */
  truncated: boolean;
  /** End-to-end encrypted: the lines open only on the note page (`blocks` is empty). */
  encrypted: boolean;
  /** "Undo these changes" is possible. */
  canUndo: boolean;
}

/** `ai.generate` (R9.4): a template or a note written by Foli AI from a description. */
export interface AiGenerateArgs {
  kind: "template" | "note";
  instruction: string;
  space?: SpaceRef;
}

export interface AiGenerateResult {
  title: string;
  /** Markdown. */
  text: string;
}

export interface AiSaveDraftArgs {
  kind: "template" | "note";
  title: string;
  /** Markdown (becomes real blocks). */
  text: string;
  space?: SpaceRef;
  folderId?: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Revision 12: sharing folders (R14.4, docs/SHARING.md). A folder's people reach every note in it and in its
// subfolders, notes added later too; restricted, encrypted and locked notes are never reached. Revision 12 also
// lets `invite.preview`, `invite.acceptLink` and `invite.decline` take `kind: "folder"`, adds
// `InviteTokenAcceptResult.folderId`, and `NotificationRow.folderId` / `folderInviteId`.
// ---------------------------------------------------------------------------------------------------------------

/** Someone a folder is shared with (on it, or on a folder above it in `inherited`). */
export interface FolderShareGrant {
  profileId: string;
  name: string;
  /** Only for people who manage the folder; null otherwise and in `inherited`. */
  email: string | null;
  /** "editor", "commenter", "viewer". */
  role: string;
  /** Not a member of the folder's place (no seat, not billed). */
  guest: boolean;
  isYou: boolean;
  /** Role and removal can be changed here (`folderSharing.setRole`, `folderSharing.revoke`). */
  canChange: boolean;
}

/** People who have this folder through a folder above it (changed in that folder's sharing). */
export interface FolderShareInherited {
  folderId: string;
  folderName: string;
  people: FolderShareGrant[];
}

/** `folderSharing.get { id }`: who a folder is shared with and what this person may change. */
export interface FolderSharingValue {
  folderId: string;
  name: string;
  color: string | null;
  /** "read", "comment", "write" or "manage". */
  yourAccess: string;
  /** Add people, change roles, remove people and invitations: the Personal's owner, a workspace's owners and admins. */
  canManage: boolean;
  /** Shared with this person from someone else's place: the list shows only them; they may `folderSharing.revoke` themselves (leave). */
  youAreGuest: boolean;
  ownerName: string | null;
  /** Null in a Personal. */
  workspaceName: string | null;
  personal: boolean;
  sharedBy: string | null;
  /** Notes people with access see through it (its subfolders' too). */
  noteCount: number;
  /** Why it can't be shared as a folder (end-to-end encryption), or null. Show it; offer no invite field. */
  blocked: string | null;
  people: FolderShareGrant[];
  inherited: FolderShareInherited[];
  /** Pending invitations by email (managers only). */
  invites: ShareInvite[];
}

export interface FolderShareInviteArgs {
  folderId: string;
  email: string;
  role: "editor" | "commenter" | "viewer";
}

export interface FolderShareRoleArgs {
  folderId: string;
  profileId: string;
  role: "editor" | "commenter" | "viewer";
}

/** `folderSharing.revoke`: a manager removes someone, or anyone removes themselves (leaves the folder). */
export interface FolderShareRevokeArgs {
  folderId: string;
  profileId: string;
}

export interface FolderInviteIdArgs {
  inviteId: string;
}

export interface FolderInviteAcceptResult {
  /** The folder to open (`sharedFolder.open`). */
  folderId: string;
}

/** A folder shared with this person (Shared with Me). One inside another shared folder is left out. */
export interface SharedFolderRow {
  id: string;
  name: string;
  color: string | null;
  /** "editor", "commenter", "viewer". */
  role: string;
  sharedBy: string;
  sharedAt: number;
  workspaceName: string | null;
  ownerName: string | null;
  noteCount: number;
  updatedAt: number;
  /** In one of this person's own places (they could see it already; the share raised their access). */
  inYourPlace: boolean;
}

/** `shared.folders`: folders shared with this person, newest share first (Shared with Me lists them above pages). */
export interface SharedFoldersValue {
  rows: SharedFolderRow[];
}

export interface SharedFolderPathItem {
  id: string;
  name: string;
}

export interface SharedSubfolder {
  id: string;
  name: string;
  color: string | null;
  noteCount: number;
}

/** A note in a shared folder, with this person's access to it. */
export interface SharedFolderNote {
  id: string;
  title: string;
  icon: string | null;
  /** "document", "template", ... (open). */
  kind: string;
  excerpt: string;
  updatedAt: number;
  /** "read", "comment", "write" or "manage". */
  access: string;
}

/** `sharedFolder.open { id }`: a folder shared with this person, opened like a folder. `found: false` once it can't be opened. */
export interface SharedFolderValue {
  found: boolean;
  id: string;
  name: string;
  color: string | null;
  /** "read", "comment", "write" or "manage" (none when not found). */
  access: string;
  /** "Can edit", "Can comment", "Can view", or null when it's theirs some other way. */
  roleLabel: string | null;
  sharedBy: string | null;
  /** The folder the access comes from (this one, or one above it). */
  sharedFolderId: string | null;
  ownerName: string | null;
  workspaceName: string | null;
  inYourPlace: boolean;
  /** The folders above it this person can open, outermost first. */
  path: SharedFolderPathItem[];
  subfolders: SharedSubfolder[];
  notes: SharedFolderNote[];
}

/** `notes.moveCheck`: would moving these notes to `folderId` (null: Drafts) change who sees them through folder sharing? */
export interface NotesMoveCheckArgs {
  ids: string[];
  folderId: string | null;
}

/** Ask before moving when `title` isn't null: show `title` and `message`, with Move and Cancel. */
export interface NotesMoveCheckValue {
  gainCount: number;
  loseCount: number;
  /** Up to 5 names each way. */
  gains: string[];
  loses: string[];
  title: string | null;
  message: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// The Vault (revision 18; docs/VAULT_PLAN.md, docs/MAC_REBUILD_PLAN.md §5.6). Everything decrypted here is decrypted
// by the engine (lib/vault/*), in memory only; keys never cross the bridge and nothing of the Vault is kept on the
// device by the engine's kept answers. Every open the web logs is logged the same way (the server's log in an
// account; a library's Vault has none). In a library (local mode) People, sharing and Activity are absent.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Where the Vault page is: `none` (no Vault for this person here: the sidebar has no row), `setUp` (its owner can
 * set it up), `encryptionLocked` (this device must unlock encryption first), `waitingForKey`, `needsPasscode` (a
 * custodian shared the key), `locked`, `open`.
 */
export type VaultState = "none" | "setUp" | "encryptionLocked" | "waitingForKey" | "needsPasscode" | "locked" | "open";

/** The Vault's sections: the two tabs and the ones in the ⋯ menu beside Lock. */
export type VaultSection = "files" | "passwords" | "health" | "activity" | "people" | "trash" | "settings";

export interface VaultSummaryValue {
  state: VaultState;
  /** Null until it exists. */
  vaultId: string | null;
  personal: boolean;
  /** A library's Vault on this device (no account): no People, sharing or Activity. */
  local: boolean;
  /** "owner", "custodian" or "member". */
  role: string;
  autoLockMinutes: number;
  /** When it locks itself if nothing happens (open only). */
  locksAt: number | null;
  /** The recovery key to show once after set-up or "Make a new recovery key", until `vault.recoverySaved`. */
  recoveryToSave: string | null;
  recoveryOutdated: boolean;
  accessReviewDue: boolean;
  custodiansNameCustodians: boolean;
  /** The ⋯ menu's sections, in order (Health, Activity, People, Trash, Settings as this Vault has them). */
  moreSections: VaultSection[];
  /** The passcode lengths offered (6, 8, 12). */
  passcodeLengths: number[];
}

/** A field of an item kind (lib/vault/items.ts ITEM_KINDS). `type`: text, secret, url, date, multiline, totp. */
export interface VaultFieldDef {
  key: string;
  label: string;
  type: string;
}

export interface VaultKindDef {
  kind: string;
  label: string;
  fields: VaultFieldDef[];
}

export interface VaultItemHealth {
  strength: number;
  /** "breached", "ok" or "unknown". */
  breached: string;
  checkedAt: number;
}

/** A row of a list: what its sealed summary holds, opened by the engine. */
export interface VaultItemRow {
  id: string;
  /** A password kind (login, apiKey, …), "note" or "file". */
  kind: string;
  kindLabel: string;
  title: string;
  /** The web's second line: kind and username for passwords, the excerpt for a note, the size for a file. */
  detail: string;
  folderId: string | null;
  revision: number;
  updatedAt: number;
  deletedAt: number | null;
  /** A file's type and size in bytes. */
  mime: string | null;
  size: number | null;
}

export interface VaultItemsArgs {
  vaultId: string;
  section: "passwords" | "files" | "trash";
  folderId?: string | null;
}

export interface VaultItemsValue {
  items: VaultItemRow[];
  /** The item kinds (for the filter and Add). */
  kinds: VaultKindDef[];
}

export interface VaultIdArgs {
  vaultId: string;
}

export interface VaultFolderRow {
  id: string;
  parentId: string | null;
  name: string;
  updatedAt: number;
}

export interface VaultFoldersValue {
  folders: VaultFolderRow[];
}

export interface VaultHealthGroup {
  /** breached, expired, reused, weak, expiring, unchecked. */
  issue: string;
  title: string;
  body: string;
  /** danger, warning or muted. */
  tone: string;
  items: VaultItemRow[];
}

export interface VaultHealthValue {
  /** Items with something other than "not checked yet". */
  needsLook: number;
  groups: VaultHealthGroup[];
}

export interface VaultActivityArgs {
  vaultId: string;
  /** An event prefix ("vault.", "item.", …) or left out for everything. */
  event?: string;
  failedOnly?: boolean;
  personId?: string;
}

export interface VaultLogEntry {
  seq: number;
  actorName: string;
  label: string;
  failed: boolean;
  reason: string | null;
  at: number;
  /** Role, kind, device, IP and "reported by the device", joined as the web shows them. */
  detail: string;
}

export interface VaultActivityValue {
  /** The owner and custodians see everyone's; a member their own. */
  everything: boolean;
  entries: VaultLogEntry[];
}

export interface VaultPerson {
  profileId: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  isYou: boolean;
  /** "Can open it", "Waiting for the key" or "Hasn't set a passcode yet". */
  status: string;
}

export interface VaultCandidate {
  profileId: string;
  name: string;
}

export interface VaultPeopleValue {
  people: VaultPerson[];
  canAdd: boolean;
  canNameCustodians: boolean;
  onlyOneCustodian: boolean;
  /** Workspace members not in the Vault (who can be added). */
  candidates: VaultCandidate[];
}

export interface VaultItemIdArgs {
  vaultId: string;
  itemId: string;
}

export interface VaultSharePerson {
  id: string;
  name: string;
  email: string | null;
  canEdit: boolean;
  expired: boolean;
  expiresAt: number | null;
}

export interface VaultShareLink {
  id: string;
  views: number;
  maxViews: number;
  expiresAt: number;
  hasPassword: boolean;
}

export interface VaultSharesValue {
  people: VaultSharePerson[];
  links: VaultShareLink[];
}

export interface VaultSetUpArgs {
  passcode: string;
  space?: SpaceRef;
}

export interface VaultPasscodeArgs {
  vaultId: string;
  passcode: string;
}

export interface VaultResetArgs {
  vaultId: string;
  recoveryKey: string;
  passcode: string;
}

export interface VaultChangePasscodeArgs {
  vaultId: string;
  current: string;
  next: string;
}

/** How an unlock went: `ok`, `wrong`, `locked` (until `until`), `notSetUp`, `needsPasscode`, or `oldPasscode` (a passcode from before PINs: choose a PIN with `vault.changePasscode`). `message` is the web's words. */
export interface VaultUnlockResult {
  status: string;
  until: number | null;
  message: string | null;
}

// ---- Revision 19: unlocking this device's encryption in place (the Vault's first step), no full-page gate ----

/** This device's encryption: `none` (the account has none), `locked`, `unlocking`, `unlocked`. */
export type E2eeLockState = "none" | "locked" | "unlocking" | "unlocked";

/** Approving this device from another one: not asked, waiting for the other device, comparing codes, failed. */
export type E2eeApprovalState = "idle" | "waiting" | "compare" | "failed";

/** A way to unlock in place: approve from another device, the account's passphrase, its recovery key. */
export type E2eeUnlockMethod = "approve" | "passphrase" | "recovery";

/** `e2ee.state`: where this device's encryption is, and an approval under way. */
export interface E2eeStateValue {
  state: E2eeLockState;
  approval: E2eeApprovalState;
  /** The code both devices show while comparing (`compare` only). */
  approvalCode: string | null;
  /** The ways offered here, in order (the apps have no passkeys: they're approved from the browser instead). */
  methods: E2eeUnlockMethod[];
  /** How the screens name this device: "this Mac", "this iPhone", "this iPad", "this phone". */
  device: string;
}

export interface E2eeUnlockArgs {
  /** "passphrase" or "recovery". */
  method: E2eeUnlockMethod;
  secret: string;
}

/** `badFormat`: not shaped like a recovery key; `rateLimited`: too many tries for now. */
export type E2eeUnlockStatus = "ok" | "wrong" | "badFormat" | "rateLimited";

/** An unlock's outcome; when it isn't `ok`, `message` says what to do next, in the web's words. In the apps an unlocked
 *  device is trusted at once (no "public or shared computer" there: it can be removed in Settings > Devices). */
export interface E2eeUnlockResult {
  status: E2eeUnlockStatus;
  message: string | null;
}

export interface VaultRecoveryResult {
  recoveryKey: string;
}

/** One field of an opened item, in the kind's order (custom fields after), with its value. */
export interface VaultFieldValue {
  key: string;
  label: string;
  type: string;
  value: string;
}

export interface VaultItemValue {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  fields: VaultFieldValue[];
  notes: string;
  canChange: boolean;
  revision: number;
  createdBy: string;
  updatedBy: string;
  updatedAt: number;
}

export interface VaultItemSaveArgs {
  vaultId: string;
  /** Left out for a new item. */
  itemId?: string;
  kind: string;
  title: string;
  values: Record<string, string>;
  notes: string;
}

export interface VaultIdResult {
  id: string;
}

export interface VaultVersion {
  revision: number;
  title: string;
  editedBy: string;
  editedAt: number;
  fields: VaultFieldValue[];
}

export interface VaultHistoryResult {
  versions: VaultVersion[];
}

export interface VaultRevisionArgs {
  vaultId: string;
  itemId: string;
  revision: number;
}

/** What only the device sees, for the log: item.reveal, item.copy, totp.show, totp.copy, file.preview, section.open, folder.open, history.view. */
export interface VaultRecordArgs {
  vaultId: string;
  event: string;
  itemId?: string;
  /** The field revealed or copied, or the section opened. */
  field?: string;
}

export interface VaultTotpArgs {
  secret: string;
}

/** The 6-digit code now and the seconds it has left; null when the secret isn't one Folevi reads. */
export interface VaultTotpResult {
  code: string | null;
  secondsLeft: number;
}

export interface VaultGenerateArgs {
  kind: "password" | "passphrase";
}

export interface VaultGenerateResult {
  value: string;
}

export interface VaultStrengthArgs {
  password: string;
}

/** 0 to 4, and the web's words ("Strong", …). */
export interface VaultStrengthResult {
  score: number;
  label: string;
}

export interface VaultFolderCreateArgs {
  vaultId: string;
  parentId?: string | null;
  name: string;
}

export interface VaultNoteCreateArgs {
  vaultId: string;
  folderId?: string | null;
  title: string;
}

/** A note's content as plain paragraphs (the editor's document, read on the Mac as text). */
export interface VaultNoteValue {
  id: string;
  title: string;
  text: string;
  canChange: boolean;
  revision: number;
}

export interface VaultNoteSaveArgs {
  vaultId: string;
  itemId: string;
  revision: number;
  text: string;
}

export interface VaultRevisionResult {
  revision: number;
}

export interface VaultUploadArgs {
  vaultId: string;
  folderId?: string | null;
  name: string;
  mime: string;
  /** The file's bytes, base64. Sealed by the engine before they go anywhere. */
  data: string;
}

export interface VaultFileOpenArgs {
  vaultId: string;
  itemId: string;
  purpose: "preview" | "download";
}

/** A file decrypted in memory: its name, type, how to show it (image, pdf, text, csv, audio, video, other) and bytes. */
export interface VaultFileValue {
  name: string;
  mime: string;
  kind: string;
  /** base64. */
  data: string;
}

export interface VaultRemovedResult {
  removed: number;
}

export interface VaultSettingsArgs {
  vaultId: string;
  autoLockMinutes?: number;
  custodiansNameCustodians?: boolean;
}

export interface VaultPersonArgs {
  vaultId: string;
  profileId: string;
}

export interface VaultRoleArgs {
  vaultId: string;
  profileId: string;
  role: "custodian" | "member";
}

export interface VaultShareArgs {
  vaultId: string;
  itemId: string;
  email: string;
  /** For someone outside the workspace: how long they have it. */
  days: number;
  canEdit: boolean;
}

/** What happened: `shared`, `notFound`, `inVault`, `unchecked`; `message` says it in the web's words. */
export interface VaultShareResult {
  status: string;
  message: string;
}

export interface VaultShareStopArgs {
  vaultId: string;
  itemId: string;
  shareId: string;
}

export interface VaultLinkArgs {
  vaultId: string;
  itemId: string;
  maxViews: number;
  /** How long it works, in milliseconds (1 hour to 30 days). */
  lastsMs: number;
  password?: string;
}

/** The link, shown only now. */
export interface VaultLinkResult {
  url: string;
}

export interface VaultLinkRevokeArgs {
  vaultId: string;
  linkId: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Revision 13: the Graph and Reviews pages, native on the Mac (docs/MAC_REBUILD_PLAN.md: all native but the editor)
// ---------------------------------------------------------------------------------------------------------------

/** `graph { space?, kinds? }`: the space's notes and links (aiGraph.graph); `kinds` limits the entities shown. */
export interface GraphArgs {
  space?: SpaceRef;
  /** "person", "project", "organization", "topic", "decision"; left out: all of them. */
  kinds?: string[];
}

/** A node, placed by the web's own force layout (lib/graph/layout.ts Simulation, deterministic) in world units. */
export interface GraphNode {
  id: string;
  /** "note", or an entity's kind (open). */
  kind: string;
  label: string;
  x: number;
  y: number;
  /** How many edges it has. */
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** "link", "mention", "similar", "related", "references", "contradicts", "supersedes" (open). */
  kind: string;
  inferred: boolean;
}

export interface GraphValue {
  /** Entities (people, projects...) are in the plan, so their filters show. */
  full: boolean;
  /** Why some of the graph isn't there (the plan, Foli AI off), or null. */
  note: string | null;
  /** The plan is why: point at plans. */
  upgrade: boolean;
  /** Only the most recently edited notes are shown. */
  truncated: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** `reviews { noteId?, space? }`: the cards due now. Neither: everywhere; `space`: one space; `noteId`: one note. */
export interface ReviewsArgs {
  noteId?: string;
  space?: SpaceRef;
}

/** How long until a card comes back after each rating (ms). */
export interface ReviewIntervals {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export interface ReviewCard {
  blockId: string;
  /** "flashcard", "quiz" (open). */
  kind: string;
  noteId: string;
  noteTitle: string;
  front: string;
  back: string;
  isNew: boolean;
  lastReview: number | null;
  intervals: ReviewIntervals;
}

export interface ReviewsValue {
  /** False when the note asked for can't be opened any more. */
  found: boolean;
  /** In order, at most 20 (study.queue). */
  cards: ReviewCard[];
  due: number;
  new: number;
  /** Due later today. */
  later: number;
  total: number;
  hasCards: boolean;
  /** The note's title when one note is reviewed, else null. */
  noteTitle: string | null;
  /** New cards a day (0, 10, 20, 30, 50, 100). */
  newPerDay: number;
}

/** `review.rate`: how well a card was known ("again", "hard", "good", "easy"). */
export interface ReviewRateArgs {
  blockId: string;
  rating: string;
  lastReview: number | null;
}

/** `review.setNewPerDay`: one of 0, 10, 20, 30, 50, 100. */
export interface ReviewNewPerDayArgs {
  value: number;
}

/** `recent.viewed { space?, limit? }`: the notes this person opened last (documents.recent), newest first, for ⌘K's Recent. */
export interface RecentViewedArgs {
  space?: SpaceRef;
  /** Default 8, at most 30. */
  limit?: number;
}

export interface RecentViewedRow {
  id: string;
  title: string;
  icon: string | null;
  updatedAt: number;
}

export interface RecentViewedValue {
  rows: RecentViewedRow[];
}

/**
 * Settings on the Mac, native (docs/MAC_REBUILD_PLAN.md section 0): `settings.query` reads one of these, worded as
 * the web's Settings words it (viewsSettings.ts); "convex" is one of the Convex queries Settings reads
 * (args { fn, args }, an allowlist).
 */
export type SettingsQueryKey = "library" | "localAi" | "desktop" | "convex";
/** What `settings.run` does: the library's controls, Foli AI's keys on the device, the Mac app's settings, and the Convex changes Settings makes (args { fn, args }, an allowlist). */
export type SettingsRunKey =
  | "library.syncNow"
  | "library.move"
  | "library.cloudConnect"
  | "library.cloudCancel"
  | "library.cloudSignOut"
  | "library.setPassphrase"
  | "library.changePassphrase"
  | "library.removePassphrase"
  | "library.lock"
  | "library.forget"
  | "localAi.setKey"
  | "localAi.removeKey"
  | "localAi.testKey"
  | "localAi.setChoice"
  | "desktop.set"
  | "desktop.pauseShortcut"
  | "text.lines"
  | "data.import"
  | "takeout.import"
  | "convex.mutation"
  | "convex.action";

export interface SettingsQueryArgs {
  key: SettingsQueryKey;
  args?: Record<string, unknown>;
}
/** The section's data as the web's section would show it (each key's shape is in viewsSettings.ts). */
export interface SettingsQueryValue {
  data: unknown;
}
export interface SettingsRunArgs {
  key: SettingsRunKey;
  args?: Record<string, unknown>;
}
export interface SettingsRunResult {
  data: unknown;
}

// ---------------------------------------------------------------------------------------------------------------
// Revision 14: the note page's own sidebar (components/doc/DocumentSidebar.tsx) drawn natively. The note page
// sends what the sidebar shows (`note.tools`) and takes its clicks (`block.jump`, `task.toggle`, `thread.open`,
// `find`, `find.clear`). (Revision 13 is the "more" area's.)
// ---------------------------------------------------------------------------------------------------------------

/** One step of where the note lives ("In Travel > Japan"): a folder or a parent page, outermost first. */
export interface NoteToolsCrumb {
  /** The app path it opens ("/folders/<id>", "/d/<id>", "/documents"). */
  href: string;
  label: string;
}

/** A row of the Table of contents: a heading (level 1 to 3) or a nested page. */
export interface NoteOutlineItem {
  kind: "heading" | "page";
  /** The block's id (what `block.jump` takes). */
  id: string;
  /** The heading's text ("" when empty) or the nested page's title. */
  text: string;
  /** Headings: 1, 2 or 3; pages: 0. */
  level: number;
  /** Pages: the nested page's note id; headings: null. */
  documentId: string | null;
}

/** A to-do in the note. */
export interface NoteToolsTask {
  id: string;
  text: string;
  checked: boolean;
}

/** An image, file or recording in the note. */
export interface NoteToolsAttachment {
  id: string;
  /** "image", "file" or "audio". */
  kind: string;
  name: string;
  /** A file still on its way up. */
  uploading: boolean;
}

/** A link in the note: a web address (embed, bookmark, linked text) or a page link. */
export interface NoteToolsLink {
  key: string;
  blockId: string;
  label: string;
  href: string;
  /** A page link ("/d/<id>"), opened in the app; otherwise a web address. */
  internal: boolean;
}

/** A comment thread, as the Comments tab lists it. */
export interface NoteToolsThread {
  id: string;
  /** The block it's on (null: on the whole note). */
  blockId: string | null;
  /** What it's on ("On “Temples to see”", "On the whole note"). */
  anchor: string;
  author: string;
  avatarUrl: string | null;
  /** The first comment's text (plain). */
  text: string;
  deleted: boolean;
  replies: number;
  status: "open" | "resolved";
  resolvedBy: string | null;
  unread: boolean;
  lastActivityAt: number;
  /** "waiting" or "failed" while it's not on the server yet, else null. */
  waiting: string | null;
  /** Revision 22: every comment of the thread, oldest first (a thread on the whole note opens in the list). */
  comments: NoteToolsComment[];
  /** Revision 22: this person may resolve or reopen it (`comment.resolve`). */
  canResolve: boolean;
  /** Revision 22: this person may delete it (`comment.deleteThread`). */
  canDelete: boolean;
}

/** Revision 22: one comment of a thread. */
export interface NoteToolsComment {
  id: string;
  author: string;
  avatarUrl: string | null;
  /** Its text (plain; a mention as "@Name"). */
  text: string;
  deleted: boolean;
  createdAt: number;
}

export interface NoteToolsComments {
  /** False in local mode (no comments: the tab says what they need). */
  available: boolean;
  /** The threads have loaded. */
  loaded: boolean;
  canComment: boolean;
  threads: NoteToolsThread[];
}

/** A page of the note's page tree (the note, its parent and nested pages), for a note with nested pages. */
export interface NoteToolsPage {
  id: string;
  title: string;
  depth: number;
}

/** `note.tools`: what the open note's sidebar shows, sent when the note opens and whenever it changes. */
export interface NoteToolsEvent {
  noteId: string;
  title: string;
  trail: NoteToolsCrumb[];
  outline: NoteOutlineItem[];
  /** The heading in view now (the outline marks it), or null. */
  current: string | null;
  tasks: NoteToolsTask[];
  attachments: NoteToolsAttachment[];
  links: NoteToolsLink[];
  comments: NoteToolsComments;
  /** Empty unless the note has nested pages (two or more pages). */
  pages: NoteToolsPage[];
  pagesTruncated: boolean;
  readOnly: boolean;
}

export interface BlockJumpArgs {
  blockId: string;
}

export interface TaskToggleArgs {
  blockId: string;
}

export interface ThreadOpenArgs {
  threadId: string;
}

export interface FindArgs {
  /** The text to find (case-insensitive); "" clears. */
  query: string;
  /** Which match to show (wraps around; negative counts from the end); left out: the first, not scrolled to. */
  index?: number;
}

/** A match with some text on each side (word boundaries, "…" where cut). */
export interface FindMatch {
  before: string;
  hit: string;
  after: string;
}

export interface FindResult {
  query: string;
  /** Matches found (at most 500). */
  count: number;
  /** The shown match (0-based), or -1 with none. */
  current: number;
  /** More than 500 matches. */
  truncated: boolean;
  /** The first 100 matches. */
  matches: FindMatch[];
}

// ---------------------------------------------------------------------------------------------------------------
// Revision 22: the note's Style and Comments tools drawn natively (the iPhone app's sheets; docs/IOS_REBUILD_PLAN.md
// I1). Style reads `note.style` and writes with `note.style.set` and `note.theme.set`; Comments lists the threads
// `note.tools` sends and writes with the `comment.*` commands (through the outbox, as the web's own controls).
// ---------------------------------------------------------------------------------------------------------------

/** A note theme as the Style tool offers it. */
export interface NoteStyleTheme {
  id: string;
  name: string;
  /** Its small picture: a web address for a theme added since the app was built, else null (the app's own
   * covers/<id>-thumb.webp). */
  thumb: string | null;
  /** Not on the plan where the note lives: picking it is refused with what it needs. */
  locked: boolean;
}

/** A colour the Style tool offers (a page colour or a text colour). */
export interface NoteStyleColor {
  id: string;
  name: string;
  /** CSS hex. */
  color: string;
}

export interface NoteStyleOption {
  id: string;
  name: string;
}

/** `note.style`: the Style tool for a note (components/doc/Inspector.tsx StylePanel). */
export interface NoteStyleValue {
  found: boolean;
  canEdit: boolean;
  /** "plain", "image" (the person's own image) or the theme's id. */
  current: string;
  /** What the preview names it: the theme's name, "Your image" or "Plain". */
  styleName: string;
  /** The theme it has, if any (for its picture behind the preview). */
  themeId: string | null;
  /** The note has the person's own image as its style. */
  ownImage: boolean;
  /** Published themes, plus the note's own even if it's been retired. */
  themes: NoteStyleTheme[];
  /** The page has a background behind it (a theme's or an image), which can be blurred. */
  hasBackdrop: boolean;
  blur: boolean;
  /** The page and text colours chosen (null: Auto, from the theme). */
  sheet: string | null;
  text: string | null;
  /** The page and text colours drawn now (CSS hex or a CSS colour). */
  sheetColor: string;
  textColor: string;
  /** Auto's colours (the theme's), or null without a theme. */
  autoPaper: string | null;
  autoInk: string | null;
  font: string;
  separator: string;
  /** "default" (Narrow) or "wide". */
  width: string;
  sheets: NoteStyleColor[];
  texts: NoteStyleColor[];
  fonts: NoteStyleOption[];
  separators: NoteStyleOption[];
}

export interface NoteStyleSetArgs {
  id: string;
  /** A page colour's id, or null for Auto. */
  sheet?: string | null;
  /** A text colour's id, or null for Auto. */
  text?: string | null;
  font?: string;
  separator?: string;
  width?: string;
  blur?: boolean;
}

export interface NoteThemeSetArgs {
  id: string;
  /** "plain" or a theme's id. */
  theme: string;
}

export interface CommentCreateArgs {
  /** The note; the comment is on the whole note. */
  noteId: string;
  text: string;
}

export interface CommentCreateResult {
  threadId: string;
  commentId: string;
}

export interface CommentReplyArgs {
  threadId: string;
  text: string;
}

export interface CommentReplyResult {
  commentId: string;
}

export interface CommentResolveArgs {
  threadId: string;
  resolved: boolean;
}

export interface CommentReadArgs {
  threadId: string;
  /** true: read up to its latest activity; false: unread again. */
  read: boolean;
}

export interface ThreadIdArgs {
  threadId: string;
}

export interface ViewMap {
  session: { args: EmptyArgs; value: SessionValue };
  "places.list": { args: EmptyArgs; value: PlacesValue };
  home: { args: SpaceArgs; value: HomeValue };
  "folders.tree": { args: SpaceArgs; value: FoldersTreeValue };
  "sync.status": { args: EmptyArgs; value: SyncStatusValue };
  "note.meta": { args: NoteIdArgs; value: NoteMeta };
  "trash.summary": { args: SpaceArgs; value: TrashSummaryValue };
  "templates.builtIn": { args: EmptyArgs; value: BuiltInTemplatesValue };
  "folders.cards": { args: FolderCardsArgs; value: FolderCardsValue };
  "tags.index": { args: TagsIndexArgs; value: TagsIndexValue };
  "shared.list": { args: EmptyArgs; value: SharedValue };
  changes: { args: EmptyArgs; value: ChangesValue };
  "notifications.list": { args: EmptyArgs; value: NotificationsValue };
  search: { args: SearchArgs; value: SearchValue };
  "tasks.list": { args: TasksListArgs; value: TasksValue };
  "tasks.counts": { args: SpaceArgs; value: TaskCounts };
  "tasks.range": { args: TasksRangeArgs; value: TasksRangeValue };
  "calendars.events": { args: CalendarEventsArgs; value: CalendarEventsValue };
  "calendars.list": { args: EmptyArgs; value: CalendarsValue };
  members: { args: SpaceArgs; value: MembersValue };
  "task.parse": { args: TaskParseArgs; value: TaskParseValue };
  "account.details": { args: EmptyArgs; value: AccountDetails };
  "settings.account": { args: EmptyArgs; value: AccountSettings };
  "settings.general": { args: EmptyArgs; value: GeneralSettings };
  "settings.appearance": { args: EmptyArgs; value: AppearanceSettings };
  "settings.notifications": { args: EmptyArgs; value: NotificationSettings };
  "settings.ai": { args: EmptyArgs; value: AiSettings };
  "settings.security": { args: EmptyArgs; value: SecuritySettings };
  "sharing.get": { args: NoteIdArgs; value: SharingValue };
  "invite.preview": { args: InviteTokenArgs; value: InvitePreview };
  "ai.conversations": { args: ChatConversationsArgs; value: ChatConversationsValue };
  "ai.conversation": { args: ChatConversationArgs; value: ChatConversationValue };
  "ai.stream": { args: ChatStreamArgs; value: ChatStreamValue };
  "ai.capabilities": { args: EmptyArgs; value: ChatCapabilities };
  "places.move.preview": { args: PlaceMovePreviewArgs; value: PlaceMovePreview };
  "notes.meta": { args: NotesMetaArgs; value: NotesMetaValue };
  "ai.research": { args: ResearchArgs; value: ResearchValue };
  "calendar.feed": { args: EmptyArgs; value: CalendarFeedValue };
  "tasks.unscheduled": { args: SpaceArgs; value: TasksRangeValue };
  "files.urls": { args: FileUrlsArgs; value: FileUrlsValue };
  recent: { args: RecentArgs; value: RecentValue };
  "device.storage": { args: EmptyArgs; value: DeviceStorageValue };
  "support.topics": { args: EmptyArgs; value: SupportTopicsValue };
  "changes.diff": { args: ChangeDiffArgs; value: ChangeDiffValue };
  "folderSharing.get": { args: NoteIdArgs; value: FolderSharingValue };
  "shared.folders": { args: EmptyArgs; value: SharedFoldersValue };
  "sharedFolder.open": { args: NoteIdArgs; value: SharedFolderValue };
  "notes.moveCheck": { args: NotesMoveCheckArgs; value: NotesMoveCheckValue };
  graph: { args: GraphArgs; value: GraphValue };
  reviews: { args: ReviewsArgs; value: ReviewsValue };
  "recent.viewed": { args: RecentViewedArgs; value: RecentViewedValue };
  "settings.query": { args: SettingsQueryArgs; value: SettingsQueryValue };
  "vault.summary": { args: SpaceArgs; value: VaultSummaryValue };
  "vault.items": { args: VaultItemsArgs; value: VaultItemsValue };
  "vault.folders": { args: VaultIdArgs; value: VaultFoldersValue };
  "vault.health": { args: VaultIdArgs; value: VaultHealthValue };
  "vault.activity": { args: VaultActivityArgs; value: VaultActivityValue };
  "vault.people": { args: VaultIdArgs; value: VaultPeopleValue };
  "vault.shares": { args: VaultItemIdArgs; value: VaultSharesValue };
  "e2ee.state": { args: EmptyArgs; value: E2eeStateValue };
  "note.style": { args: NoteIdArgs; value: NoteStyleValue };
}

export interface ListViewMap {
  "notes.list": { args: NotesListArgs; row: NoteRow };
}

// ---------------------------------------------------------------------------------------------------------------
// Revision 23: `account.signOut`, the page's own sign-out of the place it shows (the account sheet's Sign out in
// the iPhone's native frame): this account's copy and keys on the device go, the host ends its session and opens
// the next place (or, in local mode, the page starts again). The app warns about unsynced changes first.
// ---------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------
// Revision 24: `text.layout`, lines as the page's WebKit breaks them, for small web text the native apps draw
// themselves (a note card's preview, a folder card's papers): iOS WebKit's `text-wrap: pretty` in a line-clamped
// box can't be modelled closely enough. Read-only.
// ---------------------------------------------------------------------------------------------------------------

export interface TextLayoutArgs {
  /** Up to 64 texts, each up to 4,000 characters, set one after another in the same style. */
  texts: string[];
  /** The app's sans (Instrument Sans) or display face (Spectral). */
  family: "sans" | "display";
  /** CSS pixels (the `px` names are Doubles in the native contract). */
  pxSize: number;
  pxLineHeight: number;
  /** Default 400. */
  weight?: number;
  /** CSS pixels (default 0). */
  pxLetterSpacing?: number;
  /** The paragraph's width in CSS pixels. */
  pxWidth: number;
  wrap: "pretty" | "wrap" | "balance";
  /** `white-space: pre-line` (line breaks in the text kept), else normal. */
  pre?: boolean;
  /** A `-webkit-line-clamp` box of this many lines, as a card's preview is (one line more comes back, so a caller
   * knows there's more). */
  clamp?: number;
}

export interface TextLayoutResult {
  /** Each text's lines, as laid out, trailing spaces dropped; an empty line for each blank one. */
  lines: string[][];
}

export interface CommandMap {
  "space.switch": { args: SpaceSwitchArgs; result: SpaceSwitchResult };
  "note.create": { args: NoteCreateArgs; result: NoteCreateResult };
  "note.star": { args: NoteStarArgs; result: BulkResult };
  "note.move": { args: NoteMoveArgs; result: BulkResult };
  "note.archive": { args: NoteArchiveArgs; result: BulkResult };
  "note.trash": { args: NoteIdsArgs; result: BulkResult };
  "note.restore": { args: NoteIdsArgs; result: BulkResult };
  "note.hideFromRecent": { args: NoteIdsArgs; result: HiddenResult };
  "folder.create": { args: FolderCreateArgs; result: FolderCreateResult };
  "catchUp.run": { args: SpaceArgs; result: CatchUpCard };
  "catchUp.clear": { args: SpaceArgs; result: OkResult };
  "engine.refresh": { args: EmptyArgs; result: OkResult };
  "toast.action": { args: ToastActionArgs; result: OkResult };
  "gate.act": { args: GateActArgs; result: OkResult };
  "note.deleteForever": { args: NoteIdsArgs; result: BulkResult };
  "note.duplicate": { args: NoteIdArgs; result: NoteCreateResult };
  "note.picture": { args: NotePictureArgs; result: NotePictureResult };
  "note.copyTo": { args: NoteCopyToArgs; result: BulkResult };
  "note.reorder": { args: NoteReorderArgs; result: OkResult };
  "note.showInRecent": { args: NoteIdsArgs; result: HiddenResult };
  "template.create": { args: TemplateCreateArgs; result: NoteCreateResult };
  "trash.empty": { args: SpaceArgs; result: TrashEmptyResult };
  "folder.rename": { args: FolderRenameArgs; result: OkResult };
  "folder.setColor": { args: FolderSetColorArgs; result: OkResult };
  "folder.move": { args: FolderMoveArgs; result: OkResult };
  "folder.delete": { args: FolderIdArgs; result: OkResult };
  "tag.update": { args: TagUpdateArgs; result: OkResult };
  "tag.delete": { args: TagIdArgs; result: OkResult };
  "changes.markSeen": { args: NoteIdsArgs; result: OkResult };
  "proposal.accept": { args: ProposalIdArgs; result: OkResult };
  "proposal.reject": { args: ProposalIdArgs; result: OkResult };
  "notification.markRead": { args: NotificationMarkArgs; result: OkResult };
  "notification.markAllRead": { args: EmptyArgs; result: OkResult };
  "notification.remove": { args: NotificationIdsArgs; result: OkResult };
  "invite.accept": { args: InviteAcceptArgs; result: OkResult };
  "pageInvite.accept": { args: InviteAcceptArgs; result: PageInviteAcceptResult };
  "task.create": { args: TaskCreateArgs; result: TaskCreateResult };
  "task.update": { args: TaskUpdateArgs; result: OkResult };
  "task.moveToNote": { args: TaskMoveArgs; result: OkResult };
  "calendar.add": { args: CalendarAddArgs; result: CalendarAddResult };
  "calendar.update": { args: CalendarUpdateArgs; result: OkResult };
  "calendar.remove": { args: CalendarIdArgs; result: OkResult };
  "calendar.refresh": { args: CalendarIdArgs; result: OkResult };
  "settings.update": { args: SettingsUpdateArgs; result: OkResult };
  "settings.setAiPref": { args: AiPrefArgs; result: OkResult };
  "settings.setNotificationTopic": { args: NotificationTopicArgs; result: OkResult };
  "settings.setNotificationEmails": { args: NotificationEmailsArgs; result: OkResult };
  "settings.removeAvatar": { args: EmptyArgs; result: OkResult };
  "session.revoke": { args: SessionIdArgs; result: OkResult };
  "sharing.invite": { args: ShareInviteArgs; result: ShareInviteResult };
  "sharing.revoke": { args: ShareRevokeArgs; result: OkResult };
  "sharing.cancelInvite": { args: ShareInviteIdArgs; result: OkResult };
  "sharing.setAccessMode": { args: AccessModeArgs; result: OkResult };
  "publicLink.create": { args: PublicLinkCreateArgs; result: PublicLinkCreateResult };
  "publicLink.setTheme": { args: PublicLinkThemeArgs; result: OkResult };
  "publicLink.revoke": { args: PublicLinkIdArgs; result: OkResult };
  "invite.acceptLink": { args: InviteTokenArgs; result: InviteTokenAcceptResult };
  "ai.send": { args: ChatSendArgs; result: ChatSendResult };
  "ai.stop": { args: ChatMessageArgs; result: OkResult };
  "ai.regenerate": { args: ChatConversationArgs; result: ChatSendResult };
  "ai.edit": { args: ChatEditArgs; result: ChatSendResult };
  "ai.rename": { args: ChatRenameArgs; result: OkResult };
  "ai.pin": { args: ChatPinArgs; result: OkResult };
  "ai.share": { args: ChatShareArgs; result: OkResult };
  "ai.remove": { args: ChatConversationArgs; result: OkResult };
  "ai.saveAsNote": { args: ChatSaveArgs; result: NoteCreateResult };
  "ai.exportMarkdown": { args: ChatSaveArgs; result: ChatMarkdownResult };
  "ai.actions": { args: ChatActionsArgs; result: OkResult };
  "ai.memory": { args: ChatMemoryArgs; result: OkResult };
  "notification.act": { args: NotificationActArgs; result: OkResult };
  "places.move": { args: PlaceMoveArgs; result: PlaceMoveResult };
  "ai.researchCancel": { args: ResearchIdArgs; result: OkResult };
  "ai.researchSave": { args: ResearchSaveArgs; result: NoteCreateResult };
  "ai.agentApprove": { args: AgentApproveArgs; result: OkResult };
  "ai.agentDiscard": { args: AgentRunArgs; result: OkResult };
  "ai.agentUndo": { args: AgentUndoArgs; result: AgentUndoResult };
  "settings.setAvatar": { args: AvatarArgs; result: OkResult };
  "calendar.feedCreate": { args: CalendarFeedCreateArgs; result: CalendarFeedCreateResult };
  "calendar.feedRevoke": { args: EmptyArgs; result: OkResult };
  "calendar.feedWorkspaces": { args: CalendarFeedWorkspacesArgs; result: OkResult };
  "device.keepAll": { args: DeviceKeepAllArgs; result: OkResult };
  "device.download": { args: EmptyArgs; result: OkResult };
  "device.removeCopy": { args: DeviceRemoveCopyArgs; result: DeviceRemoveCopyResult };
  "device.removeFiles": { args: EmptyArgs; result: OkResult };
  "sharing.setRole": { args: ShareRoleArgs; result: OkResult };
  "invite.decline": { args: InviteDeclineArgs; result: OkResult };
  "support.send": { args: SupportSendArgs; result: SupportSendResult };
  "folder.lock": { args: FolderLockArgs; result: OkResult };
  "ai.generate": { args: AiGenerateArgs; result: AiGenerateResult };
  "ai.saveDraft": { args: AiSaveDraftArgs; result: NoteCreateResult };
  "folderSharing.invite": { args: FolderShareInviteArgs; result: ShareInviteResult };
  "folderSharing.setRole": { args: FolderShareRoleArgs; result: OkResult };
  "folderSharing.revoke": { args: FolderShareRevokeArgs; result: OkResult };
  "folderSharing.cancelInvite": { args: FolderInviteIdArgs; result: OkResult };
  "folderInvite.accept": { args: FolderInviteIdArgs; result: FolderInviteAcceptResult };
  "review.rate": { args: ReviewRateArgs; result: OkResult };
  "review.setNewPerDay": { args: ReviewNewPerDayArgs; result: OkResult };
  "settings.run": { args: SettingsRunArgs; result: SettingsRunResult };
  "vault.setUp": { args: VaultSetUpArgs; result: VaultRecoveryResult };
  "vault.unlock": { args: VaultPasscodeArgs; result: VaultUnlockResult };
  "vault.reset": { args: VaultResetArgs; result: VaultUnlockResult };
  "vault.finishPasscode": { args: VaultPasscodeArgs; result: VaultUnlockResult };
  "vault.changePasscode": { args: VaultChangePasscodeArgs; result: VaultUnlockResult };
  "vault.lock": { args: VaultIdArgs; result: OkResult };
  "vault.recoverySaved": { args: VaultIdArgs; result: OkResult };
  "vault.newRecoveryKey": { args: VaultIdArgs; result: VaultRecoveryResult };
  "vault.requestReset": { args: VaultIdArgs; result: OkResult };
  "vault.record": { args: VaultRecordArgs; result: OkResult };
  "vault.item.open": { args: VaultItemIdArgs; result: VaultItemValue };
  "vault.item.save": { args: VaultItemSaveArgs; result: VaultIdResult };
  "vault.item.duplicate": { args: VaultItemIdArgs; result: VaultIdResult };
  "vault.item.remove": { args: VaultItemIdArgs; result: OkResult };
  "vault.item.restore": { args: VaultItemIdArgs; result: OkResult };
  "vault.item.history": { args: VaultItemIdArgs; result: VaultHistoryResult };
  "vault.item.restoreVersion": { args: VaultRevisionArgs; result: OkResult };
  "vault.totp": { args: VaultTotpArgs; result: VaultTotpResult };
  "vault.generate": { args: VaultGenerateArgs; result: VaultGenerateResult };
  "vault.strength": { args: VaultStrengthArgs; result: VaultStrengthResult };
  "vault.folder.create": { args: VaultFolderCreateArgs; result: VaultIdResult };
  "vault.note.create": { args: VaultNoteCreateArgs; result: VaultIdResult };
  "vault.note.open": { args: VaultItemIdArgs; result: VaultNoteValue };
  "vault.note.save": { args: VaultNoteSaveArgs; result: VaultRevisionResult };
  "vault.file.upload": { args: VaultUploadArgs; result: VaultIdResult };
  "vault.file.open": { args: VaultFileOpenArgs; result: VaultFileValue };
  "vault.trash.empty": { args: VaultIdArgs; result: VaultRemovedResult };
  "vault.settings.update": { args: VaultSettingsArgs; result: OkResult };
  "vault.people.add": { args: VaultPersonArgs; result: OkResult };
  "vault.people.remove": { args: VaultPersonArgs; result: OkResult };
  "vault.people.setRole": { args: VaultRoleArgs; result: OkResult };
  "vault.people.reviewed": { args: VaultIdArgs; result: OkResult };
  "vault.share.person": { args: VaultShareArgs; result: VaultShareResult };
  "vault.share.stop": { args: VaultShareStopArgs; result: OkResult };
  "vault.link.create": { args: VaultLinkArgs; result: VaultLinkResult };
  "vault.link.revoke": { args: VaultLinkRevokeArgs; result: OkResult };
  "e2ee.unlock": { args: E2eeUnlockArgs; result: E2eeUnlockResult };
  "e2ee.approval.start": { args: EmptyArgs; result: OkResult };
  "e2ee.approval.cancel": { args: EmptyArgs; result: OkResult };
  "note.style.set": { args: NoteStyleSetArgs; result: OkResult };
  "note.theme.set": { args: NoteThemeSetArgs; result: OkResult };
  "comment.create": { args: CommentCreateArgs; result: CommentCreateResult };
  "comment.reply": { args: CommentReplyArgs; result: CommentReplyResult };
  "comment.resolve": { args: CommentResolveArgs; result: OkResult };
  "comment.read": { args: CommentReadArgs; result: OkResult };
  "comment.deleteThread": { args: ThreadIdArgs; result: OkResult };
  "account.signOut": { args: EmptyArgs; result: OkResult };
  "text.layout": { args: TextLayoutArgs; result: TextLayoutResult };
}

export interface EditorCommandMap {
  "note.prepare": { args: NotePrepareArgs; result: NoteShownResult };
  "note.show": { args: NoteShowArgs; result: NoteShownResult };
  "note.close": { args: EmptyArgs; result: OkResult };
  format: { args: FormatArgs; result: OkResult };
  "format.set": { args: FormatSetArgs; result: OkResult };
  insert: { args: InsertArgs; result: OkResult };
  link: { args: LinkArgs; result: OkResult };
  undo: { args: EmptyArgs; result: OkResult };
  redo: { args: EmptyArgs; result: OkResult };
  indent: { args: EmptyArgs; result: OkResult };
  outdent: { args: EmptyArgs; result: OkResult };
  focus: { args: EmptyArgs; result: OkResult };
  dismissKeyboard: { args: EmptyArgs; result: OkResult };
  "panel.open": { args: PanelOpenArgs; result: OkResult };
  "panel.close": { args: EmptyArgs; result: OkResult };
  ai: { args: AiArgs; result: OkResult };
  "note.menu": { args: NoteMenuArgs; result: OkResult };
  scrollToTop: { args: EmptyArgs; result: OkResult };
  insets: { args: InsetsArgs; result: OkResult };
  state: { args: EmptyArgs; result: EditorStateEvent };
  "web.show": { args: WebShowArgs; result: NoteShownResult };
  "block.move": { args: BlockMoveArgs; result: OkResult };
  "block.duplicate": { args: EmptyArgs; result: OkResult };
  "focus.toggle": { args: EmptyArgs; result: OkResult };
  "note.lock": { args: EmptyArgs; result: OkResult };
  "block.jump": { args: BlockJumpArgs; result: OkResult };
  "task.toggle": { args: TaskToggleArgs; result: OkResult };
  "thread.open": { args: ThreadOpenArgs; result: OkResult };
  find: { args: FindArgs; result: FindResult };
  "find.clear": { args: EmptyArgs; result: OkResult };
}

export interface EventMap {
  "engine.ready": EngineReadyEvent;
  "gate.changed": GateChangedEvent;
  "sync.status": SyncStatusValue;
  "place.changed": PlaceChangedEvent;
  toast: ToastEvent;
  "navigate.request": NavigateRequestEvent;
  "panes.change": PanesChangeEvent;
  "note.ready": NoteReadyEvent;
  "note.meta": NoteMeta;
  "editor.state": EditorStateEvent;
  "editor.panel": EditorPanelEvent;
  "memory.relieved": MemoryRelievedEvent;
  "note.tools": NoteToolsEvent;
}

export type ViewName = keyof ViewMap;
export type ListViewName = keyof ListViewMap;
export type CommandName = keyof CommandMap;
export type EditorCommandName = keyof EditorCommandMap;
export type EventName = keyof EventMap;

export type ViewArgs<N extends ViewName> = ViewMap[N]["args"];
export type ViewValue<N extends ViewName> = ViewMap[N]["value"];
export type ListViewArgs<N extends ListViewName> = ListViewMap[N]["args"];
export type ListViewRow<N extends ListViewName> = ListViewMap[N]["row"];
export type CommandArgs<N extends CommandName> = CommandMap[N]["args"];
export type CommandResult<N extends CommandName> = CommandMap[N]["result"];
export type EditorCommandArgs<N extends EditorCommandName> = EditorCommandMap[N]["args"];
export type EditorCommandResult<N extends EditorCommandName> = EditorCommandMap[N]["result"];
export type EventData<N extends EventName> = EventMap[N];

// Runtime lists of the names (the hello reply, the host's checks, the codegen's cross-check). The `satisfies`
// clauses below fail type checking when a name is missing from or extra to its map.
type Exhaustive<Keys extends string, List extends readonly string[]> = [Exclude<Keys, List[number]>] extends [never] ? ([Exclude<List[number], Keys>] extends [never] ? List : never) : never;

const viewNames = ["session", "places.list", "home", "folders.tree", "sync.status", "note.meta", "trash.summary", "templates.builtIn", "folders.cards", "shared.list", "changes", "notifications.list", "search", "tasks.list", "tasks.counts", "tasks.range", "calendars.events", "calendars.list", "members", "task.parse", "account.details", "settings.account", "settings.general", "settings.appearance", "settings.notifications", "settings.ai", "settings.security", "sharing.get", "invite.preview", "ai.conversations", "ai.conversation", "ai.stream", "ai.capabilities", "places.move.preview", "notes.meta", "ai.research", "calendar.feed", "tasks.unscheduled", "files.urls", "recent", "device.storage", "support.topics", "changes.diff", "folderSharing.get", "shared.folders", "sharedFolder.open", "notes.moveCheck", "settings.query", "graph", "reviews", "recent.viewed", "vault.summary", "vault.items", "vault.folders", "vault.health", "vault.activity", "vault.people", "vault.shares", "e2ee.state", "note.style", "tags.index"] as const;
const listViewNames = ["notes.list"] as const;
const commandNames = [
  "space.switch",
  "note.create",
  "note.star",
  "note.move",
  "note.archive",
  "note.trash",
  "note.restore",
  "note.hideFromRecent",
  "folder.create",
  "catchUp.run",
  "catchUp.clear",
  "engine.refresh",
  "toast.action",
  "gate.act",
  "note.deleteForever",
  "note.duplicate",
  "note.picture",
  "note.copyTo",
  "note.reorder",
  "note.showInRecent",
  "template.create",
  "trash.empty",
  "folder.rename",
  "folder.setColor",
  "folder.move",
  "folder.delete",
  "tag.update",
  "tag.delete",
  "changes.markSeen",
  "proposal.accept",
  "proposal.reject",
  "notification.markRead",
  "notification.markAllRead",
  "notification.remove",
  "invite.accept",
  "pageInvite.accept",
  "task.create",
  "task.update",
  "task.moveToNote",
  "calendar.add",
  "calendar.update",
  "calendar.remove",
  "calendar.refresh",
  "settings.update",
  "settings.setAiPref",
  "settings.setNotificationTopic",
  "settings.setNotificationEmails",
  "settings.removeAvatar",
  "session.revoke",
  "sharing.invite",
  "sharing.revoke",
  "sharing.cancelInvite",
  "sharing.setAccessMode",
  "publicLink.create",
  "publicLink.setTheme",
  "publicLink.revoke",
  "invite.acceptLink",
  "ai.send",
  "ai.stop",
  "ai.regenerate",
  "ai.edit",
  "ai.rename",
  "ai.pin",
  "ai.share",
  "ai.remove",
  "ai.saveAsNote",
  "ai.exportMarkdown",
  "ai.actions",
  "ai.memory",
  "notification.act",
  "places.move",
  "ai.researchCancel",
  "ai.researchSave",
  "ai.agentApprove",
  "ai.agentDiscard",
  "ai.agentUndo",
  "settings.setAvatar",
  "calendar.feedCreate",
  "calendar.feedRevoke",
  "calendar.feedWorkspaces",
  "device.keepAll",
  "device.download",
  "device.removeCopy",
  "device.removeFiles",
  "sharing.setRole",
  "invite.decline",
  "support.send",
  "folder.lock",
  "ai.generate",
  "ai.saveDraft",
  "folderSharing.invite",
  "folderSharing.setRole",
  "folderSharing.revoke",
  "folderSharing.cancelInvite",
  "folderInvite.accept",
  "review.rate",
  "review.setNewPerDay",
  "settings.run",
  "vault.setUp",
  "vault.unlock",
  "vault.reset",
  "vault.finishPasscode",
  "vault.changePasscode",
  "vault.lock",
  "vault.recoverySaved",
  "vault.newRecoveryKey",
  "vault.requestReset",
  "vault.record",
  "vault.item.open",
  "vault.item.save",
  "vault.item.duplicate",
  "vault.item.remove",
  "vault.item.restore",
  "vault.item.history",
  "vault.item.restoreVersion",
  "vault.totp",
  "vault.generate",
  "vault.strength",
  "vault.folder.create",
  "vault.note.create",
  "vault.note.open",
  "vault.note.save",
  "vault.file.upload",
  "vault.file.open",
  "vault.trash.empty",
  "vault.settings.update",
  "vault.people.add",
  "vault.people.remove",
  "vault.people.setRole",
  "vault.people.reviewed",
  "vault.share.person",
  "vault.share.stop",
  "vault.link.create",
  "vault.link.revoke",
  "e2ee.unlock",
  "e2ee.approval.start",
  "e2ee.approval.cancel",
  "note.style.set",
  "note.theme.set",
  "comment.create",
  "comment.reply",
  "comment.resolve",
  "comment.read",
  "comment.deleteThread",
  "account.signOut",
  "text.layout",
] as const;
const editorCommandNames = [
  "note.prepare",
  "note.show",
  "note.close",
  "format",
  "format.set",
  "insert",
  "link",
  "undo",
  "redo",
  "indent",
  "outdent",
  "focus",
  "dismissKeyboard",
  "panel.open",
  "panel.close",
  "ai",
  "note.menu",
  "scrollToTop",
  "insets",
  "state",
  "web.show",
  "block.move",
  "block.duplicate",
  "focus.toggle",
  "note.lock",
  "block.jump",
  "task.toggle",
  "thread.open",
  "find",
  "find.clear",
] as const;
const eventNames = ["engine.ready", "gate.changed", "sync.status", "place.changed", "toast", "navigate.request", "note.ready", "note.meta", "editor.state", "editor.panel", "memory.relieved", "note.tools", "panes.change"] as const;

export const VIEW_NAMES: Exhaustive<ViewName, typeof viewNames> = viewNames;
export const LIST_VIEW_NAMES: Exhaustive<ListViewName, typeof listViewNames> = listViewNames;
export const COMMAND_NAMES: Exhaustive<CommandName, typeof commandNames> = commandNames;
export const EDITOR_COMMAND_NAMES: Exhaustive<EditorCommandName, typeof editorCommandNames> = editorCommandNames;
export const EVENT_NAMES: Exhaustive<EventName, typeof eventNames> = eventNames;

export const EDITOR_MARKS: readonly EditorMark[] = ["bold", "italic", "underline", "strike", "code", "highlight"];
export const EDITOR_BLOCKS: readonly EditorBlock[] = ["paragraph", "heading1", "heading2", "heading3", "bulleted", "numbered", "todo", "toggle", "quote", "callout", "code"];
export const EDITOR_PANELS: readonly EditorPanel[] = ["format", "insert", "style", "comments", "ai", "info", "related"];
export const NOTE_MENU_ACTIONS: readonly NoteMenuAction[] = ["share", "move", "copyTo", "duplicate", "export", "history", "present", "print", "find", "delete"];
export const NOTES_LIST_VIEWS: readonly NotesListView[] = ["all", "starred", "archive", "trash", "templates", "unsorted", "folder", "tag"];
export const NOTES_SORTS: readonly NotesSort[] = ["updated", "created", "title", "manual"];
export const WEB_PAGES: readonly WebPage[] = ["settings.connectedApps", "settings.workspaceData", "settings.data", "settings.aiExport", "reviews", "graph", "settings.security", "settings.privacy", "settings.workspace", "settings.deleteAccount"];
export const AI_PREF_KEYS: readonly AiPrefKey[] = ["history", "memory", "suggestions", "attachments", "webResearch", "digests", "readImages", "deviceText"];
export const SETTINGS_QUERY_KEYS: readonly SettingsQueryKey[] = ["library", "localAi", "desktop", "convex"];
export const SETTINGS_RUN_KEYS: readonly SettingsRunKey[] = ["library.syncNow", "library.move", "library.cloudConnect", "library.cloudCancel", "library.cloudSignOut", "library.setPassphrase", "library.changePassphrase", "library.removePassphrase", "library.lock", "library.forget", "localAi.setKey", "localAi.removeKey", "localAi.testKey", "localAi.setChoice", "desktop.set", "desktop.pauseShortcut", "text.lines", "data.import", "takeout.import", "convex.mutation", "convex.action"];
export const TASK_VIEWS: readonly TaskViewName[] = ["inbox", "today", "upcoming", "all", "completed", "mine"];

/** Features the hello reply lists (for native to check before using something newer than the protocol). */
export const FEATURES: readonly string[] = ["windowed-lists", "row-hashes", "content-only", "editor-commands", "catch-up"];

/** FNV-1a 32-bit of a string, as 8 hex digits (row hashes and the schema hash use it; Swift has the same). */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * The contract's hash: FNV-1a of `<protocol>.<revision>|views|listViews|commands|editorCommands|events`, each list
 * joined by ",". The codegen computes the same string and embeds it in the generated Swift.
 */
export function schemaHash(): string {
  return fnv1a(
    [`${PROTOCOL_VERSION}.${CONTRACT_REVISION}`, VIEW_NAMES.join(","), LIST_VIEW_NAMES.join(","), COMMAND_NAMES.join(","), EDITOR_COMMAND_NAMES.join(","), EVENT_NAMES.join(",")].join("|"),
  );
}
