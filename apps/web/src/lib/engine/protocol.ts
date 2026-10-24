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
export const CONTRACT_REVISION = 4;

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

const viewNames = ["session", "places.list", "home", "folders.tree", "sync.status", "note.meta", "trash.summary", "templates.builtIn", "folders.cards", "shared.list", "changes", "notifications.list", "search"] as const;
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
