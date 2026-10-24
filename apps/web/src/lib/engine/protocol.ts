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
export const CONTRACT_REVISION = 8;

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
 * "bulleted", "numbered", "todo", "toggle", "quote", "callout"). Turning a block into its own type turns it back
 * into a paragraph, as the toolbar does.
 */
export type EditorBlock = "paragraph" | "heading1" | "heading2" | "heading3" | "bulleted" | "numbered" | "todo" | "toggle" | "quote" | "callout";

/** The note's tool panels (web panels drawn in the Page View). */
export type EditorPanel = "format" | "insert" | "style" | "comments" | "ai" | "info" | "related";

/**
 * What `insert { kind }` adds: a block ("divider", "table", "code", "mention" types `@`), or a special insert the
 * editor's menus run ("image", "file", "scan", "page", "bookmark", "embed", "date", "columns2", "tabs", ...; the
 * editor's SpecialInsert list).
 */
export type EditorInsertKind = string;

/** Actions of the note's "..." menu that need the note page (its dialogs and panels). */
export type NoteMenuAction = "share" | "move" | "copyTo" | "duplicate" | "export" | "history" | "present" | "print" | "find" | "delete";

export interface NotePrepareArgs {
  id: string;
}

export interface NoteShowArgs {
  id: string;
  /** Focus the editor (a new note opens ready to type in). */
  focus?: boolean;
}

export interface FormatArgs {
  mark?: EditorMark;
  block?: EditorBlock;
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
  step: string;
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
}

export interface FolderCardsValue {
  folders: FolderCard[];
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
}

export interface SettingsUpdateArgs {
  name?: string;
  appearance?: "system" | "light" | "dark";
  timeZone?: string;
  reviewAppEdits?: boolean;
  aiEnabled?: boolean;
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
  /** "workspace" or "page". */
  kind: "workspace" | "page";
  token: string;
}

/** `invite.preview`: an invitation link opened in the app. */
export interface InvitePreview {
  valid: boolean;
  kind: "workspace" | "page";
  inviterName: string | null;
  /** The workspace's name or the page's title (null when the invitation is for another address). */
  name: string | null;
  roleLabel: string | null;
  emailMatches: boolean;
}

export interface InviteTokenAcceptResult {
  /** The page to open (page invitations) or the workspace to show. */
  noteId: string | null;
  space: SpaceRef | null;
}

/** Web pages the native app shows in the Page View with its own bars (owner decision Q1 and Q2). */
export type WebPage = "settings.connectedApps" | "settings.workspaceData" | "settings.data" | "settings.aiExport" | "reviews" | "graph";

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

export interface ChatMessageArgs {
  messageId: string;
}

export interface ChatSaveArgs {
  conversationId: string;
  /** Just one answer (and its question); left out: the whole conversation. */
  messageId?: string;
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
// The maps (names to argument and result types). The codegen reads these interfaces.
// ---------------------------------------------------------------------------------------------------------------

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
}

export interface ListViewMap {
  "notes.list": { args: NotesListArgs; row: NoteRow };
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
  "note.copyTo": { args: NoteCopyToArgs; result: BulkResult };
  "note.reorder": { args: NoteReorderArgs; result: OkResult };
  "note.showInRecent": { args: NoteIdsArgs; result: HiddenResult };
  "template.create": { args: TemplateCreateArgs; result: NoteCreateResult };
  "trash.empty": { args: SpaceArgs; result: TrashEmptyResult };
  "folder.rename": { args: FolderRenameArgs; result: OkResult };
  "folder.setColor": { args: FolderSetColorArgs; result: OkResult };
  "folder.move": { args: FolderMoveArgs; result: OkResult };
  "folder.delete": { args: FolderIdArgs; result: OkResult };
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
  "ai.remove": { args: ChatConversationArgs; result: OkResult };
  "ai.saveAsNote": { args: ChatSaveArgs; result: NoteCreateResult };
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
}

export interface EditorCommandMap {
  "note.prepare": { args: NotePrepareArgs; result: NoteShownResult };
  "note.show": { args: NoteShowArgs; result: NoteShownResult };
  "note.close": { args: EmptyArgs; result: OkResult };
  format: { args: FormatArgs; result: OkResult };
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
}

export interface EventMap {
  "engine.ready": EngineReadyEvent;
  "gate.changed": GateChangedEvent;
  "sync.status": SyncStatusValue;
  "place.changed": PlaceChangedEvent;
  toast: ToastEvent;
  "navigate.request": NavigateRequestEvent;
  "note.ready": NoteReadyEvent;
  "note.meta": NoteMeta;
  "editor.state": EditorStateEvent;
  "editor.panel": EditorPanelEvent;
  "memory.relieved": MemoryRelievedEvent;
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

const viewNames = ["session", "places.list", "home", "folders.tree", "sync.status", "note.meta", "trash.summary", "templates.builtIn", "folders.cards", "shared.list", "changes", "notifications.list", "search", "tasks.list", "tasks.counts", "tasks.range", "calendars.events", "calendars.list", "members", "task.parse", "account.details", "settings.account", "settings.general", "settings.appearance", "settings.notifications", "settings.ai", "settings.security", "sharing.get", "invite.preview", "ai.conversations", "ai.conversation", "ai.stream", "ai.capabilities", "places.move.preview", "notes.meta", "ai.research"] as const;
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
  "note.copyTo",
  "note.reorder",
  "note.showInRecent",
  "template.create",
  "trash.empty",
  "folder.rename",
  "folder.setColor",
  "folder.move",
  "folder.delete",
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
  "ai.remove",
  "ai.saveAsNote",
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
] as const;
const editorCommandNames = [
  "note.prepare",
  "note.show",
  "note.close",
  "format",
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
] as const;
const eventNames = ["engine.ready", "gate.changed", "sync.status", "place.changed", "toast", "navigate.request", "note.ready", "note.meta", "editor.state", "editor.panel", "memory.relieved"] as const;

export const VIEW_NAMES: Exhaustive<ViewName, typeof viewNames> = viewNames;
export const LIST_VIEW_NAMES: Exhaustive<ListViewName, typeof listViewNames> = listViewNames;
export const COMMAND_NAMES: Exhaustive<CommandName, typeof commandNames> = commandNames;
export const EDITOR_COMMAND_NAMES: Exhaustive<EditorCommandName, typeof editorCommandNames> = editorCommandNames;
export const EVENT_NAMES: Exhaustive<EventName, typeof eventNames> = eventNames;

export const EDITOR_MARKS: readonly EditorMark[] = ["bold", "italic", "underline", "strike", "code", "highlight"];
export const EDITOR_BLOCKS: readonly EditorBlock[] = ["paragraph", "heading1", "heading2", "heading3", "bulleted", "numbered", "todo", "toggle", "quote", "callout"];
export const EDITOR_PANELS: readonly EditorPanel[] = ["format", "insert", "style", "comments", "ai", "info", "related"];
export const NOTE_MENU_ACTIONS: readonly NoteMenuAction[] = ["share", "move", "copyTo", "duplicate", "export", "history", "present", "print", "find", "delete"];
export const NOTES_LIST_VIEWS: readonly NotesListView[] = ["all", "starred", "archive", "trash", "templates", "unsorted", "folder", "tag"];
export const NOTES_SORTS: readonly NotesSort[] = ["updated", "created", "title", "manual"];
export const WEB_PAGES: readonly WebPage[] = ["settings.connectedApps", "settings.workspaceData", "settings.data", "settings.aiExport", "reviews", "graph"];
export const AI_PREF_KEYS: readonly AiPrefKey[] = ["history", "memory", "suggestions", "attachments", "webResearch", "digests", "readImages", "deviceText"];
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
