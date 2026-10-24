// The contract fixtures (docs/NATIVE_APP_PLAN.md section 3.8), written as typed TypeScript so the compiler checks
// every one against protocol.ts, and saved as JSON next to this file for the Swift tests. The vitest suite
// (test/engine/fixtures.test.ts) fails when the JSON files differ from this source; regenerate them with
//   UPDATE_ENGINE_FIXTURES=1 pnpm --filter @folevi/web exec vitest run test/engine/fixtures.test.ts
//
// File kinds (the `kind` field):
// - "view": a value view's args and one value (as the update's `value`), with `stale` for an offline value.
// - "list": a list view's args, a sequence of updates as the engine sends them, and the rows native must hold
//   after applying them all (`expected`), so both sides test their diff code against the same story.
// - "command" / "editor": args and the reply's value, or `error` for a refused one.
// - "event": one event's data.
// - "envelope": raw messages in both directions (handshake, errors, a batch).
import { applyDiff, emptyNativeList, nativeRows, windowDiff, withHash, type ListState } from "../diff";
import { gateEvent } from "../gates";
import { changesValue, notificationRow, searchHits, sharedRow } from "../viewsMore";
import {
  CONTRACT_REVISION,
  PROTOCOL_VERSION,
  schemaHash,
  COMMAND_NAMES,
  EDITOR_COMMAND_NAMES,
  EVENT_NAMES,
  FEATURES,
  LIST_VIEW_NAMES,
  VIEW_NAMES,
  type CommandArgs,
  type CommandName,
  type CommandResult,
  type EditorCommandArgs,
  type EditorCommandName,
  type EditorCommandResult,
  type EngineBatch,
  type EngineError,
  type EventData,
  type EventName,
  type FromEngine,
  type ListViewArgs,
  type ListViewName,
  type ListWindow,
  type NoteRow,
  type ToEngine,
  type UpdateMessage,
  type ViewArgs,
  type ViewName,
  type ViewValue,
  type CatchUpCard,
  type FolderCard,
  type SyncStatusValue,
} from "../protocol";

export interface ViewFixture<N extends ViewName = ViewName> {
  kind: "view";
  name: N;
  description: string;
  args: ViewArgs<N>;
  value: ViewValue<N>;
  stale?: boolean;
}

export interface ListFixture<N extends ListViewName = ListViewName> {
  kind: "list";
  name: N;
  description: string;
  args: ListViewArgs<N>;
  window: ListWindow;
  updates: UpdateMessage[];
  expected: { total: number; complete: boolean; start: number; rows: NoteRow[] };
}

export interface CommandFixture<N extends CommandName = CommandName> {
  kind: "command";
  name: N;
  description: string;
  args: CommandArgs<N>;
  result?: CommandResult<N>;
  error?: EngineError;
}

export interface EditorFixture<N extends EditorCommandName = EditorCommandName> {
  kind: "editor";
  name: N;
  description: string;
  args: EditorCommandArgs<N>;
  result?: EditorCommandResult<N>;
  error?: EngineError;
}

export interface EventFixture<N extends EventName = EventName> {
  kind: "event";
  name: N;
  description: string;
  data: EventData<N>;
}

export interface EnvelopeFixture {
  kind: "envelope";
  description: string;
  toEngine: ToEngine[];
  fromEngine: FromEngine[];
  batch?: EngineBatch;
}

export type Fixture = ViewFixture | ListFixture | CommandFixture | EditorFixture | EventFixture | EnvelopeFixture;

const view = <N extends ViewName>(f: Omit<ViewFixture<N>, "kind">): ViewFixture<N> => ({ kind: "view", ...f });
const command = <N extends CommandName>(f: Omit<CommandFixture<N>, "kind">): CommandFixture<N> => ({ kind: "command", ...f });
const editor = <N extends EditorCommandName>(f: Omit<EditorFixture<N>, "kind">): EditorFixture<N> => ({ kind: "editor", ...f });
const event = <N extends EventName>(f: Omit<EventFixture<N>, "kind">): EventFixture<N> => ({ kind: "event", ...f });

// ---------------------------------------------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------------------------------------------

const DAY = 86_400_000;
/** 2026-10-24 09:00 UTC: every time below counts back from it, so the fixtures never change by themselves. */
const NOW = Date.UTC(2026, 9, 24, 9, 0, 0);

const STYLE = { font: "modern", width: "normal", background: "paper", accent: "ember", card: "plain" };
const THEMES = ["art-03", "art-12", "art-27", "art-41", "art-55"];
const FOLDERS = [
  { id: "fld_trips", name: "Trips", color: "moss" },
  { id: "fld_work", name: "Work", color: null },
  { id: "fld_reading", name: "Reading", color: "plum" },
];
const TITLES = ["Kyoto in November", "Q4 planning", "Reading list", "Sourdough notes", "Interview loop", "Garden plan", "Weekly review", "Book club: The Overstory"];

/** A note row, deterministic from its number. */
export function seedRow(i: number, over: Partial<Omit<NoteRow, "h">> = {}): NoteRow {
  const folder = i % 4 === 3 ? null : FOLDERS[i % FOLDERS.length]!;
  const title = i < TITLES.length ? TITLES[i]! : `Note ${i + 1}`;
  return withHash({
    id: `doc_${String(i + 1).padStart(5, "0")}`,
    title,
    icon: i % 3 === 0 ? "🗺️" : null,
    kind: "document",
    excerpt: `${title}. First lines of the note.`,
    preview:
      i % 5 === 0
        ? [
            { t: "heading", x: title, l: 1 },
            { t: "todo", x: "Book the ryokan", c: true },
            { t: "todo", x: "Rail pass", c: false },
          ]
        : [{ t: "paragraph", x: `${title}. First lines of the note.` }],
    cover: i % 2 === 0 ? { kind: "theme", value: THEMES[i % THEMES.length]! } : { kind: "none" },
    style: STYLE,
    starred: i % 6 === 0,
    createdAt: NOW - (i + 30) * DAY,
    updatedAt: NOW - i * 3_600_000,
    folder,
    tags: i % 7 === 0 ? [{ id: "tag_ideas", name: "ideas", color: "marigold" }] : [],
    encrypted: false,
    archived: false,
    inTrash: false,
    deletedAt: null,
    sync: "saved",
    ...over,
  });
}

const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => seedRow(from + i));

const folderCard = (i: number, over: Partial<FolderCard> = {}): FolderCard => ({
  id: FOLDERS[i]!.id,
  name: FOLDERS[i]!.name,
  color: FOLDERS[i]!.color,
  parentId: null,
  noteCount: [12, 7, 31][i]!,
  childCount: i === 0 ? 2 : 0,
  updatedAt: NOW - i * DAY,
  previews: rows(3, i * 3).map((r) => ({ title: r.title, excerpt: r.excerpt, cover: r.cover })),
  encrypted: false,
  sync: "saved",
  ...over,
});

const CATCH_UP_IDLE: CatchUpCard = { available: true, state: "idle", brief: null, error: null };
const CATCH_UP_READY: CatchUpCard = {
  available: true,
  state: "ready",
  brief: {
    text: "**This week** you planned the Kyoto trip and drafted Q4 planning.\n\n- 3 to-dos are due tomorrow\n- The interview loop needs feedback",
    sources: [
      { id: "doc_00001", title: "Kyoto in November" },
      { id: "doc_00002", title: "Q4 planning" },
    ],
    at: NOW - 600_000,
  },
  error: null,
};

const SPACES = [
  { id: "personal", kind: "personal" as const, name: "Personal", role: "owner", canEdit: true, canManage: false, encrypted: false, locked: false },
  { id: "ws_studio", kind: "workspace" as const, name: "Airly Studio", role: "admin", canEdit: true, canManage: true, encrypted: false, locked: false },
];

const SYNC_SAVED: SyncStatusValue = { state: "saved", label: "Saved", pending: 0, conflicts: 0, online: true, authRequired: false, spaces: [{ space: "personal", state: "ready", have: 0, total: null }] };

// ---------------------------------------------------------------------------------------------------------------
// List stories: run the real diff code, so the fixture is exactly what the engine sends
// ---------------------------------------------------------------------------------------------------------------

function story(name: "notes.list", description: string, args: ListViewArgs<"notes.list">, steps: { ids: NoteRow[]; window: ListWindow; complete: boolean; stale?: boolean; error?: EngineError; restart?: boolean }[]): ListFixture<"notes.list"> {
  let state: ListState | null = null;
  let native = emptyNativeList();
  const updates: UpdateMessage[] = [];
  let rev = 0;
  for (const step of steps) {
    if (step.restart) {
      state = null;
      rev = 0;
    }
    const byId = new Map(step.ids.map((r) => [r.id, r]));
    const { diff, next } = windowDiff(state, step.ids.map((r) => r.id), byId, step.window, step.complete);
    state = next;
    if (!diff && !step.error) continue;
    const u: UpdateMessage = { kind: "update", sub: "s1", rev: ++rev };
    if (diff) u.diff = diff;
    if (step.stale) u.stale = true;
    if (step.error) u.error = step.error;
    updates.push(u);
    if (diff) native = applyDiff(native, diff);
  }
  const last = steps[steps.length - 1]!;
  return { kind: "list", name, description, args, window: last.window, updates, expected: { total: native.total, complete: native.complete, start: native.start, rows: nativeRows(native) } };
}

const twentyFive = rows(25);
const edited = twentyFive.map((r, i) => (i === 2 ? withHash({ ...r, title: "Reading list (2027)", updatedAt: NOW, sync: "waiting" }) : r));
const fresh = seedRow(900, { title: "New note", updatedAt: NOW + 1000, sync: "waiting", folder: null, starred: false });
const withNew = [fresh, ...edited];
const fiveThousand = rows(5000);

// ---------------------------------------------------------------------------------------------------------------
// The fixtures
// ---------------------------------------------------------------------------------------------------------------

export const FIXTURES: Record<string, Fixture> = {
  // ---- envelopes
  "envelope.hello": {
    kind: "envelope",
    description: "The handshake: native says hello, the engine replies with its protocol, contract hash and names.",
    toEngine: [{ v: 1, id: "1", kind: "hello", app: { platform: "ios", version: "1.1.00", build: "1100", protocol: PROTOCOL_VERSION, schemaHash: schemaHash() } }],
    fromEngine: [
      {
        kind: "reply",
        id: "1",
        ok: true,
        value: {
          protocol: PROTOCOL_VERSION,
          revision: CONTRACT_REVISION,
          build: "dev",
          schemaHash: schemaHash(),
          ready: true,
          place: "acct:user_1",
          features: [...FEATURES],
          views: [...VIEW_NAMES],
          listViews: [...LIST_VIEW_NAMES],
          commands: [...COMMAND_NAMES],
          editorCommands: [...EDITOR_COMMAND_NAMES],
          events: [...EVENT_NAMES],
          gate: gateEvent({ gate: null }),
        },
      },
    ],
  },
  "envelope.protocol-mismatch": {
    kind: "envelope",
    description: "An app built against another protocol is refused loudly.",
    toEngine: [{ v: 1, id: "1", kind: "hello", app: { platform: "macos", version: "1.1.00", build: "1100", protocol: 2 } }],
    fromEngine: [{ kind: "reply", id: "1", ok: false, error: { code: "protocol_mismatch", message: "This app speaks bridge protocol 2; the page speaks 1. Reinstall Folevi.", data: { app: 2, page: 1 } } }],
  },
  "envelope.watch": {
    kind: "envelope",
    description: "A watch is acknowledged with its sub; the first update (posted separately) carries the whole value.",
    toEngine: [{ v: 1, id: "7", kind: "watch", sub: "home-1", place: "acct:user_1", name: "home", args: {} }],
    fromEngine: [{ kind: "reply", id: "7", ok: true, value: { sub: "home-1" } }],
    batch: [{ kind: "update", sub: "home-1", rev: 1, value: { space: "personal", spaceName: "Personal", recents: [], recentsLoaded: false, catchUp: CATCH_UP_IDLE, rows: [], starred: { rows: [], more: false }, folders: [], tags: [] }, stale: true }],
  },
  "envelope.errors": {
    kind: "envelope",
    description: "Bridge errors: engine not ready, another place, an unknown view, bad arguments, an unknown subscription, and a server error passed through.",
    toEngine: [
      { v: 1, id: "1", kind: "watch", sub: "a", place: "acct:user_1", name: "home", args: {} },
      { v: 1, id: "2", kind: "watch", sub: "b", place: "acct:user_2", name: "home", args: {} },
      { v: 1, id: "3", kind: "query", place: "acct:user_1", name: "nope" as "home", args: {} },
      { v: 1, id: "4", kind: "command", place: "acct:user_1", name: "note.star", args: { ids: "doc_1" } },
      { v: 1, id: "5", kind: "window", sub: "zzz", window: { start: 0, count: 50 } },
      { v: 1, id: "6", kind: "command", place: "acct:user_1", name: "note.move", args: { ids: ["doc_00001"], folderId: "fld_gone" } },
    ],
    fromEngine: [
      { kind: "reply", id: "1", ok: false, error: { code: "engine_not_ready", message: "Folevi is still starting." } },
      { kind: "reply", id: "2", ok: false, error: { code: "place_mismatch", message: "This window shows another place.", data: { expected: "acct:user_1", got: "acct:user_2" } } },
      { kind: "reply", id: "3", ok: false, error: { code: "unknown_view", message: "There's no view named “nope”." } },
      { kind: "reply", id: "4", ok: false, error: { code: "invalid_args", message: "ids must be a list of note ids." } },
      { kind: "reply", id: "5", ok: false, error: { code: "unknown_subscription", message: "There's no subscription “zzz”." } },
      { kind: "reply", id: "6", ok: false, error: { code: "not_found", message: "Folder not found." } },
    ],
  },
  "envelope.batch": {
    kind: "envelope",
    description: "One postMessage: updates and events in the order they happened.",
    toEngine: [],
    fromEngine: [],
    batch: [
      { kind: "update", sub: "sync", rev: 4, value: SYNC_SAVED },
      { kind: "event", name: "sync.status", data: SYNC_SAVED },
      { kind: "event", name: "toast", data: { message: "Starred", tone: "info", undo: { command: "note.star", args: { ids: ["doc_00001"], starred: false } }, action: null } },
    ],
  },

  // ---- value views
  "view.session": view({
    name: "session",
    description: "A signed-in account with a team workspace, Personal showing.",
    args: {},
    value: {
      place: "acct:user_1",
      mode: "account",
      profile: { id: "prof_1", name: "Faisal", email: "faisal@example.com", avatarUrl: null },
      spaces: SPACES,
      space: "personal",
      online: true,
      today: "2026-10-24",
      timeZone: "Asia/Dhaka",
      appearance: "system",
      capabilities: { graph: true, sharing: true, changes: true, workspaces: true, ai: true, purchases: false },
    },
  }),
  "view.session.local": view({
    name: "session",
    description: "Local mode: the library on this device, no sharing, Changes or workspaces.",
    args: {},
    value: {
      place: "library",
      mode: "local",
      profile: { id: "local", name: "You", email: "", avatarUrl: null },
      spaces: [{ id: "personal", kind: "personal", name: "Personal", role: "owner", canEdit: true, canManage: false, encrypted: false, locked: false }],
      space: "personal",
      online: false,
      today: "2026-10-24",
      timeZone: "Europe/London",
      appearance: "dark",
      capabilities: { graph: false, sharing: false, changes: false, workspaces: false, ai: false, purchases: false },
    },
  }),
  "view.places.list": view({
    name: "places.list",
    description: "Two accounts and the library.",
    args: {},
    value: {
      current: "acct:user_1",
      places: [
        { id: "acct:user_1", kind: "account", name: "Faisal", email: "faisal@example.com", avatarUrl: null, syncs: null, workspaces: [{ id: "ws_studio", name: "Airly Studio", logoUrl: null }], unread: 2, reminders: 0, waiting: 0 },
        { id: "acct:user_2", kind: "account", name: "Faisal (work)", email: "f@work.example", avatarUrl: "https://example.com/a.png", syncs: null, workspaces: [], unread: 0, reminders: 1, waiting: 3 },
        { id: "library", kind: "library", name: "On this iPhone", email: null, avatarUrl: null, syncs: "Syncs with iCloud Drive", workspaces: [], unread: 0, reminders: 0, waiting: 0 },
      ],
    },
  }),
  "view.home": view({
    name: "home",
    description: "Home with recents, a Catch me up brief, counts, starred, nested folders and tags.",
    args: {},
    value: {
      space: "personal",
      spaceName: "Personal",
      recents: rows(10),
      recentsLoaded: true,
      catchUp: CATCH_UP_READY,
      rows: [
        { id: "notes", title: "All notes", count: null, route: "/notes" },
        { id: "drafts", title: "Drafts", count: 4, route: "/drafts" },
        { id: "shared", title: "Shared with Me", count: null, route: "/shared" },
        { id: "changes", title: "Changes", count: 3, route: "/changes" },
        { id: "reviews", title: "Reviews", count: 12, route: "/review" },
      ],
      starred: { rows: [seedRow(0), seedRow(6), seedRow(12)], more: false },
      folders: [folderCard(0), folderCard(1), folderCard(2)],
      tags: [{ id: "tag_ideas", name: "ideas", color: "marigold" }],
    },
  }),
  "view.home.empty": view({
    name: "home",
    description: "A new account: nothing yet, Foli AI off (no Catch me up card).",
    args: { space: "personal" },
    value: {
      space: "personal",
      spaceName: "Personal",
      recents: [],
      recentsLoaded: true,
      catchUp: { available: false, state: "idle", brief: null, error: null },
      rows: [
        { id: "notes", title: "All notes", count: null, route: "/notes" },
        { id: "drafts", title: "Drafts", count: null, route: "/drafts" },
        { id: "shared", title: "Shared with Me", count: null, route: "/shared" },
        { id: "changes", title: "Changes", count: null, route: "/changes" },
      ],
      starred: { rows: [], more: false },
      folders: [],
      tags: [],
    },
  }),
  "view.home.offline-stale": view({
    name: "home",
    description: "Offline cold start: the device's kept answers, marked stale; a note made offline waits to sync.",
    args: { space: "personal" },
    stale: true,
    value: {
      space: "personal",
      spaceName: "Personal",
      recents: [seedRow(900, { title: "Written on the train", sync: "waiting", folder: null }), ...rows(4)],
      recentsLoaded: true,
      catchUp: CATCH_UP_IDLE,
      rows: [
        { id: "notes", title: "All notes", count: null, route: "/notes" },
        { id: "drafts", title: "Drafts", count: 5, route: "/drafts" },
      ],
      starred: { rows: [seedRow(0)], more: false },
      folders: [folderCard(0, { sync: "waiting" })],
      tags: [],
    },
  }),
  "view.home.encrypted-locked": view({
    name: "home",
    description: "An end-to-end encrypted workspace while this device is locked: nothing readable is shown.",
    args: { space: "ws_vault" },
    value: {
      space: "ws_vault",
      spaceName: "Vault",
      recents: [],
      recentsLoaded: false,
      catchUp: { available: true, state: "idle", brief: null, error: null },
      rows: [{ id: "notes", title: "All notes", count: null, route: "/notes" }],
      starred: { rows: [], more: false },
      folders: [],
      tags: [],
    },
  }),
  "view.folders.tree": view({
    name: "folders.tree",
    description: "Nested folders, flat and depth first, one waiting to sync.",
    args: {},
    value: {
      space: "personal",
      folders: [
        { id: "fld_trips", name: "Trips", color: "moss", parentId: null, depth: 0, rank: "a0", childCount: 2, noteCount: 12, encrypted: false, sync: "saved" },
        { id: "fld_japan", name: "Japan", color: null, parentId: "fld_trips", depth: 1, rank: "a0", childCount: 1, noteCount: 5, encrypted: false, sync: "saved" },
        { id: "fld_kyoto", name: "Kyoto", color: null, parentId: "fld_japan", depth: 2, rank: "a0", childCount: 0, noteCount: 2, encrypted: false, sync: "saved" },
        { id: "fld_iceland", name: "Iceland", color: "accent", parentId: "fld_trips", depth: 1, rank: "a1", childCount: 0, noteCount: null, encrypted: false, sync: "waiting" },
        { id: "fld_work", name: "Work", color: null, parentId: null, depth: 0, rank: "a1", childCount: 0, noteCount: 7, encrypted: false, sync: "saved" },
      ],
      tags: [{ id: "tag_ideas", name: "ideas", color: "marigold" }],
    },
  }),
  "view.sync.status": view({ name: "sync.status", description: "Everything saved.", args: {}, value: SYNC_SAVED }),
  "view.sync.status.offline": view({
    name: "sync.status",
    description: "Offline with changes waiting; the encrypted workspace's copy still downloading.",
    args: {},
    value: {
      state: "offline",
      label: "Offline",
      pending: 4,
      conflicts: 0,
      online: false,
      authRequired: false,
      spaces: [
        { space: "personal", state: "ready", have: 0, total: null },
        { space: "ws_vault", state: "downloading", have: 412, total: 1530 },
      ],
    },
  }),
  "view.note.meta": view({
    name: "note.meta",
    description: "A note in a folder, inside a parent page, starred.",
    args: { id: "doc_00003" },
    value: {
      id: "doc_00003",
      found: true,
      title: "Reading list",
      icon: null,
      kind: "document",
      space: "personal",
      folder: { id: "fld_reading", name: "Reading", color: "plum" },
      breadcrumbs: [{ id: "doc_00009", title: "Books", icon: "📚" }],
      starred: true,
      access: "full",
      canEdit: true,
      encrypted: false,
      archived: false,
      inTrash: false,
      cover: { kind: "theme", value: "art-27" },
      style: STYLE,
      sync: "saved",
    },
  }),
  "view.note.meta.missing": view({
    name: "note.meta",
    description: "A note this device doesn't know yet (or no longer can open).",
    args: { id: "doc_99999" },
    value: {
      id: "doc_99999",
      found: false,
      title: "",
      icon: null,
      kind: "document",
      space: null,
      folder: null,
      breadcrumbs: [],
      starred: false,
      access: "read",
      canEdit: false,
      encrypted: false,
      archived: false,
      inTrash: false,
      cover: { kind: "none" },
      style: STYLE,
      sync: "saved",
    },
  }),

  // ---- list views
  "list.notes.initial": story("notes.list", "The first window of All notes: 10 of 25 rows.", { view: "all" }, [{ ids: twentyFive, window: { start: 0, count: 10 }, complete: true }]),
  "list.notes.edit-one": story("notes.list", "An edit to one note sends one row.", { view: "all", sort: "updated" }, [
    { ids: twentyFive, window: { start: 0, count: 10 }, complete: true },
    { ids: edited, window: { start: 0, count: 10 }, complete: true },
  ]),
  "list.notes.insert": story("notes.list", "A new note at the top: the new order, the new row, and the row pushed out of the window removed.", { view: "all" }, [
    { ids: twentyFive, window: { start: 0, count: 10 }, complete: true },
    { ids: withNew, window: { start: 0, count: 10 }, complete: true },
  ]),
  "list.notes.scroll": story("notes.list", "The window moves down: the new order, the rows new to native, and the ones that left.", { view: "folder", folderId: "fld_trips" }, [
    { ids: twentyFive, window: { start: 0, count: 10 }, complete: true },
    { ids: twentyFive, window: { start: 6, count: 10 }, complete: true },
  ]),
  "list.notes.paging": story("notes.list", "A long list still loading: `complete` false until the last page arrives.", { view: "all" }, [
    { ids: rows(200), window: { start: 0, count: 20 }, complete: false },
    { ids: rows(260), window: { start: 0, count: 20 }, complete: true },
  ]),
  "list.notes.offline-stale": story("notes.list", "Offline: the device's kept rows, marked stale, then the live answer.", { view: "unsorted" }, [
    { ids: rows(5), window: { start: 0, count: 50 }, complete: true, stale: true },
    { ids: [seedRow(0, { sync: "waiting" }), ...rows(4, 1)], window: { start: 0, count: 50 }, complete: true },
  ]),
  "list.notes.restart": story("notes.list", "A re-watch after a gap starts over with reset and rev 1.", { view: "starred" }, [
    { ids: rows(3), window: { start: 0, count: 10 }, complete: true },
    { ids: rows(4), window: { start: 0, count: 10 }, complete: true, restart: true },
  ]),
  "list.notes.error": story("notes.list", "A folder that isn't there any more: an error update with an empty list.", { view: "folder", folderId: "fld_gone" }, [
    { ids: [], window: { start: 0, count: 50 }, complete: true, error: { code: "not_found", message: "Folder not found." } },
  ]),
  "list.notes.5000": story("notes.list", "A 5,000-note list: one window of 200 rows with the total.", { view: "all" }, [{ ids: fiveThousand, window: { start: 0, count: 200 }, complete: true }]),


  // ---- revision 4
  "view.trash.summary": view({ name: "trash.summary", description: "Trash: 14 notes, 12 this person may delete for good.", args: {}, value: { total: 14, deletable: 12 } }),
  "view.templates.builtIn": view({
    name: "templates.builtIn",
    description: "The built-in templates.",
    args: {},
    value: {
      templates: [
        { key: "builtin:meeting", name: "Meeting notes", description: "Agenda, notes and action items.", icon: "users" },
        { key: "builtin:weekly", name: "Weekly review", description: "What went well, what's next.", icon: "calendar" },
      ],
    },
  }),
  "view.folders.cards": view({ name: "folders.cards", description: "A folder's subfolders as cards.", args: { parentId: "fld_trips" }, value: { folders: [folderCard(0, { id: "fld_japan", name: "Japan", parentId: "fld_trips", childCount: 1, noteCount: 5 })] } }),
  "view.shared.list": view({
    name: "shared.list",
    description: "Pages shared with this person.",
    args: {},
    value: {
      rows: [
        sharedRow({ id: "doc_s1", title: "Launch plan", icon: "🚀", role: "editor", sharedBy: "Maya", sharedAt: NOW - DAY, workspaceName: "Airly Studio", ownerName: null, updatedAt: NOW - 3_600_000, excerpt: "Dates and owners." }),
        sharedRow({ id: "doc_s2", title: "Recipes", icon: null, role: "viewer", sharedBy: "Sam", sharedAt: NOW - 5 * DAY, workspaceName: null, ownerName: "Sam", updatedAt: NOW - 4 * DAY, excerpt: "" }),
      ],
    },
  }),
  "view.changes": view({
    name: "changes",
    description: "A proposal from a connected app, and notes others changed.",
    args: {},
    value: changesValue(
      { notes: [{ id: "doc_00002", title: "Q4 planning", icon: null, at: NOW - 7_200_000, actors: ["p_maya", "ai"], added: 3, edited: 1, removed: 0, more: false }], people: { p_maya: { name: "Maya" }, ai: { name: "Foli AI" } } },
      [{ id: "prop_1", documentId: "doc_00001", title: "Kyoto in November", sourceName: "Claude", summary: "Add a packing list", createdAt: NOW - 600_000, problem: null }],
    ),
  }),
  "view.notifications.list": view({
    name: "notifications.list",
    description: "The bell: a comment, a workspace invitation and a page invitation.",
    args: {},
    value: {
      unread: 2,
      rows: [
        notificationRow({ id: "n1", kind: "comment", title: "Maya commented on Q4 planning", body: "Can we move this to Friday?", fileId: null, actorName: "Maya", actorAvatarUrl: null, documentId: "doc_00002", toChanges: false, documentTitle: "Q4 planning", threadId: "th_1", blockId: null, count: 1, inviteId: null, pageInviteId: null, createdAt: NOW - 1_800_000, read: false }),
        notificationRow({ id: "n2", kind: "invite", title: "Sam invited you to Airly Studio", body: null, fileId: null, actorName: "Sam", actorAvatarUrl: null, documentId: null, toChanges: false, documentTitle: null, threadId: null, blockId: null, count: 1, inviteId: "inv_1", pageInviteId: null, createdAt: NOW - DAY, read: false }),
        notificationRow({ id: "n3", kind: "share", title: "Lee shared Recipes with you", body: null, fileId: null, actorName: "Lee", actorAvatarUrl: null, documentId: null, toChanges: false, documentTitle: null, threadId: null, blockId: null, count: 1, inviteId: null, pageInviteId: "pinv_1", createdAt: NOW - 2 * DAY, read: true }),
      ],
    },
  }),
  "view.search": view({
    name: "search",
    description: "Search this space: a title match, a match in a PDF, and one by meaning.",
    args: { text: "kyoto", meaning: true },
    value: {
      text: "kyoto",
      meaningAvailable: true,
      hits: [
        ...searchHits(
          [
            { id: "doc_00001", title: "Kyoto in November", icon: "🗺️", kind: "document", updatedAt: NOW, snippet: "…the ryokan in Kyoto for three nights…", match: null, archived: false, homeFolder: { id: "fld_trips", name: "Trips", color: "moss" } },
            { id: "doc_00005", title: "Rail passes", icon: null, kind: "document", updatedAt: NOW - DAY, snippet: "Tokyo to Kyoto, 2h15", match: { blockId: "blk_pdf", page: 3 }, archived: false, homeFolder: null },
          ],
          () => ({ space: "personal", name: "Personal" }),
        ),
        { id: "doc_00009", title: "Temples to see", icon: null, snippet: "Fushimi Inari at dawn", folder: null, updatedAt: 0, archived: false, kind: "document", space: "personal", spaceName: "Personal", matchIn: "meaning", blockId: null, page: null },
      ],
    },
  }),
  "view.search.everywhere": view({
    name: "search",
    description: "Search every space of this place.",
    args: { text: "launch", scope: "everywhere" },
    value: {
      text: "launch",
      meaningAvailable: false,
      hits: searchHits([{ id: "doc_s1", title: "Launch plan", icon: "🚀", kind: "document", updatedAt: NOW, snippet: "Launch on the 12th", match: null, archived: false, homeFolder: null, place: { id: "ws_studio", name: "Airly Studio" } }], (p) => ({ space: p?.id ?? null, name: p?.name ?? null })),
    },
  }),
  "list.notes.filter": story("notes.list", "A filter over the whole list: only matching notes, from every page.", { view: "all", filter: "plan" }, [
    { ids: rows(40).filter((r) => r.title.toLowerCase().includes("plan")), window: { start: 0, count: 50 }, complete: true },
  ]),
  "list.notes.trash": story("notes.list", "Trash, with when each note went there.", { view: "trash" }, [{ ids: [seedRow(3, { inTrash: true, deletedAt: NOW - 2 * DAY }), seedRow(4, { inTrash: true, deletedAt: NOW - 5 * DAY })], window: { start: 0, count: 50 }, complete: true }]),
  "command.note.deleteForever": command({ name: "note.deleteForever", description: "Delete notes in Trash for good.", args: { ids: ["doc_00004"] }, result: { done: ["doc_00004"], skipped: 0, queued: false } }),
  "command.note.duplicate": command({ name: "note.duplicate", description: "Duplicate a note.", args: { id: "doc_00001" }, result: { id: "doc_00099" } }),
  "command.note.copyTo": command({ name: "note.copyTo", description: "Copy notes into a workspace's folder.", args: { ids: ["doc_00001"], space: "ws_studio", folderId: "fld_work" }, result: { done: ["doc_00100"], skipped: 0, queued: false } }),
  "command.note.reorder": command({ name: "note.reorder", description: "Manual sort: put a note right after another.", args: { id: "doc_00003", afterId: "doc_00001", view: "folder", folderId: "fld_trips" }, result: { ok: true } }),
  "command.note.showInRecent": command({ name: "note.showInRecent", description: "Undo of removing from recents.", args: { ids: ["doc_00002"] }, result: { hidden: 1 } }),
  "command.template.create": command({ name: "template.create", description: "A new template of your own.", args: { title: "Trip plan", open: true }, result: { id: "01JB7ZA1B2C3D4E5F6G7H8J9K0" } }),
  "command.trash.empty": command({ name: "trash.empty", description: "Empty Trash.", args: {}, result: { deleted: 12, skipped: 2, continuing: false } }),
  "command.folder.rename": command({ name: "folder.rename", description: "Rename a folder.", args: { id: "fld_trips", name: "Travel" }, result: { ok: true } }),
  "command.folder.setColor": command({ name: "folder.setColor", description: "A folder's colour back to the default.", args: { id: "fld_trips", color: null }, result: { ok: true } }),
  "command.folder.move": command({ name: "folder.move", description: "Nest a folder, first among its new siblings.", args: { id: "fld_iceland", parentId: "fld_japan", afterId: null }, result: { ok: true } }),
  "command.folder.move.descendant": command({ name: "folder.move", description: "A folder can't go inside its own subfolder.", args: { id: "fld_trips", parentId: "fld_kyoto", afterId: null }, error: { code: "folder_descendant", message: "A folder can't go inside one of its subfolders." } }),
  "command.folder.delete": command({ name: "folder.delete", description: "Delete a folder (its notes go to Drafts, subfolders up a level).", args: { id: "fld_work" }, result: { ok: true } }),
  "command.changes.markSeen": command({ name: "changes.markSeen", description: "Seen these changes.", args: { ids: ["doc_00002"] }, result: { ok: true } }),
  "command.proposal.accept": command({ name: "proposal.accept", description: "Accept a proposed change.", args: { id: "prop_1" }, result: { ok: true } }),
  "command.proposal.reject": command({ name: "proposal.reject", description: "Reject a proposed change.", args: { id: "prop_1" }, result: { ok: true } }),
  "command.notification.markRead": command({ name: "notification.markRead", description: "Mark as unread.", args: { ids: ["n1"], read: false }, result: { ok: true } }),
  "command.notification.markAllRead": command({ name: "notification.markAllRead", description: "Mark all as read.", args: {}, result: { ok: true } }),
  "command.notification.remove": command({ name: "notification.remove", description: "Remove a notification.", args: { ids: ["n3"] }, result: { ok: true } }),
  "command.invite.accept": command({ name: "invite.accept", description: "Join a workspace.", args: { inviteId: "inv_1" }, result: { ok: true } }),
  "command.pageInvite.accept": command({ name: "pageInvite.accept", description: "Accept a shared page and open it.", args: { inviteId: "pinv_1" }, result: { noteId: "doc_s2" } }),
  // ---- commands
  "command.space.switch": command({ name: "space.switch", description: "Show the team workspace.", args: { space: "ws_studio" }, result: { space: "ws_studio" } }),
  "command.note.create": command({ name: "note.create", description: "A new note in a folder (works offline).", args: { folderId: "fld_trips", title: "" }, result: { id: "01JB7Z8K3Q4ABCDEF0123456789" } }),
  "command.note.create.template": command({ name: "note.create", description: "A new note from a built-in template, opened in the page at once.", args: { templateId: "builtin:meeting", open: true }, result: { id: "01JB7Z8K3Q4ABCDEF0123456790" } }),
  "command.note.star": command({ name: "note.star", description: "Star two notes.", args: { ids: ["doc_00001", "doc_00002"], starred: true }, result: { done: ["doc_00001", "doc_00002"], skipped: 0, queued: false } }),
  "command.note.move": command({ name: "note.move", description: "Move a note to Drafts while offline: queued.", args: { ids: ["doc_00001"], folderId: null }, result: { done: ["doc_00001"], skipped: 0, queued: true } }),
  "command.note.move.not-found": command({ name: "note.move", description: "A move into a folder that's gone.", args: { ids: ["doc_00001"], folderId: "fld_gone" }, error: { code: "not_found", message: "Folder not found." } }),
  "command.note.archive": command({ name: "note.archive", description: "Archive one note, one skipped (no permission).", args: { ids: ["doc_00001", "doc_00002"], archived: true }, result: { done: ["doc_00001"], skipped: 1, queued: false } }),
  "command.note.trash": command({ name: "note.trash", description: "Move a note to Trash.", args: { ids: ["doc_00004"] }, result: { done: ["doc_00004"], skipped: 0, queued: false } }),
  "command.note.restore": command({ name: "note.restore", description: "Restore a note from Trash.", args: { ids: ["doc_00004"] }, result: { done: ["doc_00004"], skipped: 0, queued: false } }),
  "command.note.hideFromRecent": command({ name: "note.hideFromRecent", description: "Remove a card from Home's recents.", args: { ids: ["doc_00002"] }, result: { hidden: 1 } }),
  "command.folder.create": command({ name: "folder.create", description: "A subfolder (queued in the outbox, works offline).", args: { name: "Kyoto", parentId: "fld_japan", color: null }, result: { id: "01JB7Z9M2W8ABCDEF0123456789" } }),
  "command.catchUp.run": command({ name: "catchUp.run", description: "Make the Catch me up brief.", args: {}, result: CATCH_UP_READY }),
  "command.catchUp.run.no-credits": command({
    name: "catchUp.run",
    description: "Out of AI credits: the server's own code and words.",
    args: { space: "personal" },
    error: { code: "ai_credits_exhausted", message: "You've used this month's AI credits. They reset on November 1." },
  }),
  "command.catchUp.clear": command({ name: "catchUp.clear", description: "Close the brief.", args: {}, result: { ok: true } }),
  "command.gate.act": command({ name: "gate.act", description: "Unlock with the passphrase typed into the gate's field.", args: { action: "passphrase", values: { passphrase: "correct horse battery staple" } }, result: { ok: true } }),
  "command.gate.act.wrong": command({ name: "gate.act", description: "A wrong passphrase (the gate also shows it in its error).", args: { action: "passphrase", values: { passphrase: "nope" } }, error: { code: "wrong_secret", message: "That passphrase isn't right." } }),
  "command.toast.action": command({ name: "toast.action", description: "The toast's button was tapped.", args: { id: "t7" }, result: { ok: true } }),
  "command.engine.refresh": command({ name: "engine.refresh", description: "Pull to refresh: send what waits and pull now.", args: {}, result: { ok: true } }),

  // ---- editor commands
  "editor.note.prepare": editor({ name: "note.prepare", description: "Touch-down on a card: render the note hidden.", args: { id: "doc_00001" }, result: { id: "doc_00001", ready: false } }),
  "editor.note.show": editor({ name: "note.show", description: "Show a new note ready to type in.", args: { id: "doc_00001", focus: true }, result: { id: "doc_00001", ready: true } }),
  "editor.note.close": editor({ name: "note.close", description: "Back on a list screen: the page goes idle.", args: {}, result: { ok: true } }),
  "editor.format.mark": editor({ name: "format", description: "Bold.", args: { mark: "bold" }, result: { ok: true } }),
  "editor.format.block": editor({ name: "format", description: "Turn the line into a to-do (or back into a paragraph).", args: { block: "todo" }, result: { ok: true } }),
  "editor.format.read-only": editor({ name: "format", description: "A note this person can only read.", args: { mark: "italic" }, error: { code: "read_only", message: "You can only read this note." } }),
  "editor.insert": editor({ name: "insert", description: "Insert an image (the editor's photo picker).", args: { kind: "image" }, result: { ok: true } }),
  "editor.link": editor({ name: "link", description: "Link the selection.", args: { href: "https://folevi.com" }, result: { ok: true } }),
  "editor.undo": editor({ name: "undo", description: "Undo.", args: {}, result: { ok: true } }),
  "editor.redo": editor({ name: "redo", description: "Redo.", args: {}, result: { ok: true } }),
  "editor.indent": editor({ name: "indent", description: "Indent the line.", args: {}, result: { ok: true } }),
  "editor.outdent": editor({ name: "outdent", description: "Outdent the line.", args: {}, result: { ok: true } }),
  "editor.focus": editor({ name: "focus", description: "Put the caret back in the note.", args: {}, result: { ok: true } }),
  "editor.dismissKeyboard": editor({ name: "dismissKeyboard", description: "Put the keyboard away.", args: {}, result: { ok: true } }),
  "editor.panel.open": editor({ name: "panel.open", description: "Open the Style panel.", args: { panel: "style" }, result: { ok: true } }),
  "editor.panel.close": editor({ name: "panel.close", description: "Close the open panel.", args: {}, result: { ok: true } }),
  "editor.ai": editor({ name: "ai", description: "Ask Foli AI about this note.", args: { action: "ask", prompt: "Summarize this note" }, result: { ok: true } }),
  "editor.note.menu": editor({ name: "note.menu", description: "Version history from the note's menu.", args: { action: "history" }, result: { ok: true } }),
  "editor.note.menu.no-note": editor({ name: "note.menu", description: "No note is open.", args: { action: "share" }, error: { code: "no_note", message: "No note is open." } }),
  "editor.scrollToTop": editor({ name: "scrollToTop", description: "A tap on the status bar.", args: {}, result: { ok: true } }),
  "editor.insets": editor({ name: "insets", description: "The native bars' sizes.", args: { top: 96, bottom: 44 }, result: { ok: true } }),
  "editor.state": editor({
    name: "state",
    description: "The editor's state now (also sent as editor.state events).",
    args: {},
    result: { noteId: "doc_00001", focused: true, canEdit: true, block: "todo", marks: ["bold"], link: false, undo: true, redo: false },
  }),

  // ---- events
  "event.engine.ready": event({ name: "engine.ready", description: "The data layer is up.", data: { place: "acct:user_1", protocol: PROTOCOL_VERSION, revision: CONTRACT_REVISION } }),
  "event.gate.changed": event({ name: "gate.changed", description: "Signed in and ready: no gate.", data: gateEvent({ gate: null }) }),
  "event.gate.changed.loading": event({ name: "gate.changed", description: "Starting: checking the session.", data: gateEvent({ gate: "loading", title: "Opening your folio…", busy: true }) }),
  "event.gate.changed.mode-choice": event({
    name: "gate.changed",
    description: "First launch: where should the notes live?",
    data: gateEvent({
      gate: "modeChoice",
      title: "Where should your notes live?",
      actions: [
        { id: "account", label: "Sign in to Folevi", style: "primary", enabled: true },
        { id: "local", label: "Keep notes on my devices", style: "secondary", enabled: true },
      ],
    }),
  }),
  "event.gate.changed.signed-out": event({ name: "gate.changed", description: "No session: native signs in.", data: gateEvent({ gate: "signedOut" }) }),
  "event.gate.changed.device-limit": event({
    name: "gate.changed",
    description: "Too many devices on this plan.",
    data: gateEvent({ gate: "deviceLimit", title: "This plan works on 3 devices", deviceLimit: { limit: 3, devices: [{ id: "sess_a", label: "MacBook Air", lastSeenAt: NOW - DAY }] }, actions: [{ id: "signOut:sess_a", label: "Sign out MacBook Air", style: "secondary", enabled: true }] }),
  }),
  "event.gate.changed.onboarding": event({ name: "gate.changed", description: "Onboarding isn't finished.", data: gateEvent({ gate: "onboarding", onboarding: { step: "useCases" } }) }),
  "event.gate.changed.migration": event({
    name: "gate.changed",
    description: "Signed in from a library: move the notes into the account, or keep them separate.",
    data: gateEvent({
      gate: "migration",
      title: "Move your notes to Folevi",
      message: "Your library folder stays as it is either way.",
      migration: { direction: "upload", phase: "ready", notes: 412, folders: 9, tags: 4, files: 37, fileBytes: 182_000_000, availableBytes: 10_000_000_000, fits: true, existingNotes: 0, writable: true, versions: true },
      actions: [
        { id: "move", label: "Move my notes into this account", style: "primary", enabled: true },
        { id: "keep", label: "Keep them separate on this iPhone", style: "secondary", enabled: true },
        { id: "back", label: "Back to my library", style: "quiet", enabled: true },
      ],
    }),
  }),
  "event.gate.changed.migration-moving": event({
    name: "gate.changed",
    description: "The move is running.",
    data: gateEvent({
      gate: "migration",
      title: "Moving your notes to Folevi",
      busy: true,
      progress: { done: 120, total: 412, label: "Moving notes" },
      migration: { direction: "upload", phase: "moving", notes: 412, folders: 9, tags: 4, files: 37, fileBytes: 182_000_000, availableBytes: 10_000_000_000, fits: true, existingNotes: 0, writable: true, versions: true },
      actions: [{ id: "stop", label: "Stop", style: "secondary", enabled: true }],
    }),
  }),
  "event.gate.changed.locked": event({
    name: "gate.changed",
    description: "The encrypted space needs unlocking: with the passphrase or the recovery key.",
    data: gateEvent({
      gate: "e2eeLocked",
      title: "Unlock your encrypted notes",
      e2ee: { space: "ws_vault", spaceName: "Vault", view: "choose", methods: ["device", "passphrase", "recovery"] },
      fields: [
        { id: "passphrase", kind: "secret", label: "Passphrase", placeholder: "" },
        { id: "recoveryKey", kind: "recoveryKey", label: "Recovery key", placeholder: "XXXX-XXXX-XXXX-XXXX" },
      ],
      actions: [
        { id: "passphrase", label: "Unlock with passphrase", style: "primary", enabled: true },
        { id: "recovery", label: "Use recovery key", style: "secondary", enabled: true },
        { id: "personal", label: "Switch to Personal", style: "quiet", enabled: true },
      ],
    }),
  }),
  "event.gate.changed.wrong-passphrase": event({
    name: "gate.changed",
    description: "After a wrong passphrase: the same screen with the error.",
    data: gateEvent({
      gate: "e2eeLocked",
      title: "Unlock your encrypted notes",
      e2ee: { space: "personal", spaceName: "Personal", view: "passphrase", methods: ["passphrase", "recovery"] },
      fields: [{ id: "passphrase", kind: "secret", label: "Passphrase", placeholder: "" }],
      actions: [{ id: "passphrase", label: "Unlock", style: "primary", enabled: true }],
      error: { code: "wrong_secret", message: "That passphrase isn't right." },
    }),
  }),
  "event.sync.status": event({ name: "sync.status", description: "Saving.", data: { ...SYNC_SAVED, state: "saving", label: "Saving…", pending: 1 } }),
  "event.place.changed": event({ name: "place.changed", description: "The space changed.", data: { place: "acct:user_1", space: "ws_studio" } }),
  "event.toast": event({ name: "toast", description: "A toast with Undo.", data: { message: "Moved to Trips", tone: "info", undo: { command: "note.move", args: { ids: ["doc_00001"], folderId: null } }, action: null } }),
  "event.toast.action": event({ name: "toast", description: "A toast from the note page with its own button (revision 2).", data: { message: "Link copied", tone: "success", undo: null, action: { id: "t7", label: "Open" } } }),
  "event.toast.error": event({ name: "toast", description: "An error toast.", data: { message: "1 note couldn’t be changed. You may not have permission.", tone: "error", undo: null, action: null } }),
  "event.navigate.request": event({ name: "navigate.request", description: "A page link inside a note.", data: { route: "/d/doc_00002", noteId: "doc_00002", external: false, newTab: false } }),
  "event.navigate.request.new-tab": event({ name: "navigate.request", description: "A page link opened in a new tab (revision 3).", data: { route: "/d/doc_00002", noteId: "doc_00002", external: false, newTab: true } }),
  "event.navigate.request.external": event({ name: "navigate.request", description: "A web link inside a note.", data: { route: "https://example.com/article", noteId: null, external: true, newTab: true } }),
  "event.note.ready": event({ name: "note.ready", description: "The note's first frame is drawn.", data: { id: "doc_00001", title: "Kyoto in November" } }),
  "event.note.meta": event({
    name: "note.meta",
    description: "The open note's title changed.",
    data: {
      id: "doc_00001",
      found: true,
      title: "Kyoto in late November",
      icon: "🗺️",
      kind: "document",
      space: "personal",
      folder: { id: "fld_trips", name: "Trips", color: "moss" },
      breadcrumbs: [],
      starred: false,
      access: "full",
      canEdit: true,
      encrypted: false,
      archived: false,
      inTrash: false,
      cover: { kind: "theme", value: "art-03" },
      style: STYLE,
      sync: "waiting",
    },
  }),
  "event.editor.state": event({ name: "editor.state", description: "The caret moved into a heading.", data: { noteId: "doc_00001", focused: true, canEdit: true, block: "heading2", marks: [], link: false, undo: true, redo: true } }),
  "event.editor.panel": event({ name: "editor.panel", description: "The Format panel opened.", data: { panel: "format" } }),
  "event.editor.panel.closed": event({ name: "editor.panel", description: "The panel closed.", data: { panel: null } }),
  "event.memory.relieved": event({ name: "memory.relieved", description: "Memory was short: the editor and caches were dropped.", data: { dropped: ["editor", "caches"] } }),
};
