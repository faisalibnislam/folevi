// The engine's views (docs/NATIVE_APP_PLAN.md sections 3 and 5): each turns args into a live computation over the
// page's data layer (live queries through whichever client the page uses, the outbox and sync engine laid over
// them, the device's kept answers while offline) and computes the protocol's view model. The host subscribes to a
// view's signals and recomputes it at most once a frame.
import type { FunctionReference } from "convex/server";
import type { WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { overlayFolderIndex, overlaySidebar, pendingNoteFolders, type FolderIndexData, type SidebarData } from "@/lib/sync/overlays";
import type { OutboxEntry } from "@/lib/sync/outbox";
import type { EngineDeps, EngineSpace, ViewContext } from "./context";
import { spaceOf } from "./context";
import { Emitter, QuerySource, signalOf, type Signal, type Snapshot } from "./live";
import { folderCardOf, folderTree, markOf, noteRowOf, pendingCreates, syncMarksOf, tagRows, type SummaryLike, type SyncMarks } from "./rows";
import { catchUpCard, catchUpSignal } from "./catchUp";
import { BridgeError, argsOf, id, oneOf, only, optionalId } from "./validate";
import {
  NOTES_LIST_VIEWS,
  NOTES_SORTS,
  type EngineError,
  type FolderChip,
  type FoldersTreeValue,
  type HomeRow,
  type HomeValue,
  type ListViewName,
  type NoteMeta,
  type NoteRow,
  type NotesListArgs,
  type PlacesValue,
  type SessionValue,
  type SpaceInfo,
  type SyncState,
  type SyncStatusValue,
  type ViewName,
} from "./protocol";

export interface LiveValue {
  signals: Signal[];
  compute(): Snapshot<unknown>;
  dispose?(): void;
}

export interface ListSnapshot {
  ids: string[];
  rows: Map<string, NoteRow>;
  complete: boolean;
  stale: boolean;
  error: EngineError | null;
}

export interface LiveList {
  signals: Signal[];
  compute(): ListSnapshot;
  /** Make sure at least `rows` rows are loaded (or the list is complete). */
  ensure(rows: number): void;
  dispose?(): void;
}

type Args = Record<string, unknown>;

export interface ValueViewDef {
  kind: "value";
  parse(args: Args): Args;
  create(ctx: ViewContext, args: Args): LiveValue;
}

export interface ListViewDef {
  kind: "list";
  parse(args: Args): Args;
  create(ctx: ViewContext, args: Args): LiveList;
}

/** Whether a view follows the space the page shows (it named none), so a space switch restarts it. */
export function followsSpace(args: Args): boolean {
  return args.space === undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

/** A signal that follows whatever `pick` returns from the current deps (the outbox or engine may be replaced). */
export function dynamicSignal(ctx: ViewContext, pick: (deps: EngineDeps) => ((cb: () => void) => () => void) | null): Signal {
  return new Emitter((emit) => {
    let current: ((cb: () => void) => () => void) | null = null;
    let off: (() => void) | null = null;
    const bind = () => {
      const next = pick(ctx.deps());
      if (next === current) return;
      off?.();
      current = next;
      off = next ? next(emit) : null;
    };
    bind();
    const offApp = ctx.appSignal.subscribe(() => {
      bind();
      emit();
    });
    return () => {
      offApp();
      off?.();
    };
  });
}

const outboxSignal = (ctx: ViewContext) => dynamicSignal(ctx, (d) => (d.app.outbox ? (cb) => d.app.outbox!.subscribe(cb) : null));
const engineSignal = (ctx: ViewContext) => dynamicSignal(ctx, (d) => (d.app.engine ? (cb) => d.app.engine!.subscribe(() => cb()) : null));

const NO_ENTRIES: readonly OutboxEntry[] = [];
const entriesOf = (deps: EngineDeps) => deps.app.outbox?.entries ?? NO_ENTRIES;
const marksOf = (deps: EngineDeps): SyncMarks => syncMarksOf(deps.app.engine?.state ?? null, entriesOf(deps));

function requireSpace(deps: EngineDeps, space: string | undefined): EngineSpace {
  const s = spaceOf(deps.app, space);
  if (!s) throw new BridgeError("not_found", "That Personal or workspace isn't in this place.");
  return s;
}

function source<T>(ctx: ViewContext, ref: FunctionReference<"query">, args: Record<string, unknown>, scope: WireScope | null): QuerySource<T> {
  const deps = ctx.deps();
  return new QuerySource<T>(deps.client, ref, args, { kept: deps.kept, persist: () => (scope ? ctx.deps().persist(scope) : true) });
}

/** Folders by id, for rows that name their folder by id only (pending creates, moved notes). */
function folderChips(sidebar: SidebarData | undefined): Map<string, FolderChip> {
  return new Map((sidebar?.folders ?? []).map((f) => [f.id, { id: f.id, name: f.name, color: f.color ?? null }]));
}

function spaceKey(scope: WireScope): string {
  return scope.kind === "personal" ? "personal" : scope.workspaceId;
}

// ---------------------------------------------------------------------------------------------------------------
// session, places.list, sync.status
// ---------------------------------------------------------------------------------------------------------------

export function sessionValue(deps: EngineDeps): SessionValue {
  const { app } = deps;
  return {
    place: app.place,
    mode: app.mode,
    profile: app.profile,
    spaces: app.spaces.map((s): SpaceInfo => {
      const status = deps.spaceStatus(s.scope);
      return { id: s.id, kind: s.kind, name: s.name, role: s.role, canEdit: s.canEdit, canManage: s.canManage, encrypted: status.encrypted, locked: status.locked };
    }),
    space: app.space,
    online: app.online,
    today: app.today,
    timeZone: app.timeZone,
    appearance: app.appearance,
    capabilities: app.capabilities,
  };
}

const session: ValueViewDef = {
  kind: "value",
  parse: (args) => (only(args, []), {}),
  create: (ctx) => ({ signals: [ctx.appSignal, ctx.deps().e2eeSignal], compute: () => ({ value: sessionValue(ctx.deps()), stale: false, error: null }) }),
};

const placesList: ValueViewDef = {
  kind: "value",
  parse: (args) => (only(args, []), {}),
  create: (ctx) => ({ signals: [ctx.appSignal], compute: () => ({ value: ctx.deps().app.places satisfies PlacesValue, stale: false, error: null }) }),
};

const LABELS: Record<SyncState, string> = { saved: "Saved", saving: "Saving…", syncing: "Syncing…", offline: "Offline", conflict: "Conflict", error: "Not saved" };

/** The page's sync status (components/app/SyncStatus.tsx combinedStatus: the same rules, outside React). */
export function combinedSyncState(engine: SyncState, outbox: "idle" | "waiting" | "sending" | "failed", online: boolean): SyncState {
  if (engine === "conflict") return "conflict";
  if (engine === "error" || outbox === "failed") return "error";
  if (engine === "offline" || outbox === "idle") return engine;
  if (!online) return "offline";
  if (engine === "syncing" || outbox === "sending") return "syncing";
  return "saving";
}

export function syncStatusValue(deps: EngineDeps): SyncStatusValue {
  const { engine, outbox, online, spaces } = deps.app;
  const s = engine?.state;
  const state = combinedSyncState((engine?.status() ?? (online ? "saved" : "offline")) as SyncState, outbox?.status() ?? "idle", online);
  return {
    state,
    label: LABELS[state],
    pending: (s ? s.pending.length + s.inflight.length : 0) + (outbox?.entries.length ?? 0),
    conflicts: s?.conflicts.length ?? 0,
    online,
    authRequired: Boolean(s?.authRequired || outbox?.authRequired),
    spaces: spaces.map((sp) => {
      const st = deps.spaceStatus(sp.scope);
      return { space: sp.id, state: st.state, have: st.have, total: st.total };
    }),
  };
}

const syncStatus: ValueViewDef = {
  kind: "value",
  parse: (args) => (only(args, []), {}),
  create: (ctx) => ({
    signals: [ctx.appSignal, engineSignal(ctx), outboxSignal(ctx), ctx.deps().e2eeSignal],
    compute: () => ({ value: syncStatusValue(ctx.deps()), stale: false, error: null }),
  }),
};

// ---------------------------------------------------------------------------------------------------------------
// home
// ---------------------------------------------------------------------------------------------------------------

type ListPage = { page: SummaryLike[]; isDone: boolean; continueCursor: string };
type ChangesData = { notes: unknown[] };
type ReviewSummary = { due: number; new: number; hasCards: boolean };

export interface HomeInputs {
  space: EngineSpace;
  locked: boolean;
  recent: SummaryLike[] | undefined;
  starred: ListPage | undefined;
  drafts: number | undefined;
  changes: number | undefined;
  proposed: number | undefined;
  reviews: ReviewSummary | undefined;
  sidebar: SidebarData | undefined;
  index: FolderIndexData | undefined;
  entries: readonly OutboxEntry[];
  marks: SyncMarks;
  pending: SummaryLike[];
  capabilities: { sharing: boolean; changes: boolean };
  catchUp: HomeValue["catchUp"];
}

const RECENTS = 10;
const STARRED_SHOWN = 6;

/** Home's value from its inputs (pure; IphoneHome.tsx and HomeDashboard.tsx show the same things). */
export function homeValue(i: HomeInputs): HomeValue {
  const scope = i.space.scope;
  const sidebar = i.sidebar ? overlaySidebar(i.sidebar, i.entries, scope) : undefined;
  const chips = folderChips(sidebar);
  const moved = pendingNoteFolders(i.entries);
  const row = (d: SummaryLike) => noteRowOf(d, i.marks, moved.has(d.id) ? { folderId: moved.get(d.id) ?? null, folders: chips } : { folders: chips });
  if (i.locked) {
    return { space: i.space.id, spaceName: i.space.name, recents: [], recentsLoaded: false, catchUp: i.catchUp, rows: [{ id: "notes", title: "All notes", count: null, route: "/notes" }], starred: { rows: [], more: false }, folders: [], tags: [] };
  }
  const served = i.recent ?? [];
  const extra = i.pending.filter((p) => !served.some((d) => d.id === p.id));
  const recents = [...extra, ...served].slice(0, RECENTS).map(row);
  const rows: HomeRow[] = [
    { id: "notes", title: "All notes", count: null, route: "/notes" },
    { id: "drafts", title: "Drafts", count: i.drafts || null, route: "/drafts" },
  ];
  if (i.capabilities.sharing) rows.push({ id: "shared", title: "Shared with Me", count: null, route: "/shared" });
  if (i.capabilities.changes) rows.push({ id: "changes", title: "Changes", count: (i.changes ?? 0) + (i.proposed ?? 0) || null, route: "/changes" });
  if (i.reviews?.hasCards) rows.push({ id: "reviews", title: "Reviews", count: i.reviews.due + i.reviews.new || null, route: "/review" });
  const starredPage = i.starred?.page ?? [];
  const index = i.index ? overlayFolderIndex(i.index, i.entries, scope) : undefined;
  const byId = new Map((index?.folders ?? []).map((f) => [f.id, f]));
  const tree = sidebar?.folders ?? [];
  const childCount = (folderId: string) => tree.filter((f) => f.parentFolderId === folderId).length;
  const folders = tree
    .filter((f) => !f.parentFolderId)
    .map((f) => folderCardOf(byId.get(f.id) ?? { id: f.id, name: f.name, color: f.color ?? null, parentFolderId: null, updatedAt: 0, documentCount: 0, previews: [], sealedName: (f as { sealedName?: unknown }).sealedName }, childCount(f.id), i.marks));
  return {
    space: i.space.id,
    spaceName: i.space.name,
    recents,
    recentsLoaded: i.recent !== undefined,
    catchUp: i.catchUp,
    rows,
    starred: { rows: starredPage.slice(0, STARRED_SHOWN).map((d) => noteRowOf(d, i.marks, { starred: true, folders: chips })), more: starredPage.length > STARRED_SHOWN || i.starred?.isDone === false },
    folders,
    tags: tagRows(sidebar?.tags ?? []),
  };
}

const home: ValueViewDef = {
  kind: "value",
  parse: (args) => {
    only(args, ["space"]);
    const space = optionalId(args, "space");
    return space === undefined ? {} : { space };
  },
  create: (ctx, args) => {
    const deps = ctx.deps();
    const space = requireSpace(deps, args.space as string | undefined);
    const scope = space.scope;
    const caps = deps.app.capabilities;
    const minute = Math.floor(Date.now() / 60_000) * 60_000;
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const recent = source<SummaryLike[]>(ctx, api.documents.recentNotes, { scope, limit: RECENTS }, scope);
    const starred = source<ListPage>(ctx, api.documents.list, { scope, view: "starred", sort: "updated", paginationOpts: { numItems: STARRED_SHOWN + 1, cursor: null } }, scope);
    const drafts = source<number>(ctx, api.organization.draftCount, { scope }, scope);
    const changes = caps.changes ? source<ChangesData>(ctx, api.changes.list, {}, null) : null;
    const proposed = caps.changes ? source<number>(ctx, api.proposals.count, { now: minute }, null) : null;
    const reviews = deps.app.mode === "account" ? source<ReviewSummary>(ctx, api.study.summary, { now: Date.now() - (Date.now() % 300_000), dayStart: day.getTime(), dayEnd: day.getTime() + 86_400_000 }, null) : null;
    const sidebar = source<SidebarData>(ctx, api.organization.sidebar, { scope }, scope);
    const index = source<FolderIndexData>(ctx, api.organization.index, { scope, only: "folders" }, scope);
    const sources = [recent, starred, drafts, changes, proposed, reviews, sidebar, index].filter((s): s is QuerySource<never> => s !== null);
    return {
      signals: [...sources, outboxSignal(ctx), engineSignal(ctx), ctx.appSignal, deps.e2eeSignal, catchUpSignal],
      compute: () => {
        const d = ctx.deps();
        const snaps = sources.map((s) => s.snapshot());
        const val = <T,>(s: QuerySource<T> | null) => (s ? s.snapshot().value : undefined);
        const value = homeValue({
          space,
          locked: d.spaceStatus(scope).locked,
          recent: val(recent),
          starred: val(starred),
          drafts: val(drafts),
          changes: val(changes)?.notes.length,
          proposed: val(proposed),
          reviews: val(reviews),
          sidebar: val(sidebar),
          index: val(index),
          entries: entriesOf(d),
          marks: marksOf(d),
          pending: pendingCreates(d.app.engine?.state ?? null, { scopeKey: spaceKey(scope) }),
          capabilities: d.app.capabilities,
          catchUp: catchUpCard(spaceKey(scope), d.app.capabilities.ai),
        });
        // Stale while a part that has an answer only has the kept one.
        const stale = snaps.some((s) => s.stale && s.value !== undefined);
        return { value, stale, error: null };
      },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------------
// folders.tree
// ---------------------------------------------------------------------------------------------------------------

export function foldersTreeValue(space: EngineSpace, sidebar: SidebarData | undefined, index: FolderIndexData | undefined, entries: readonly OutboxEntry[], marks: SyncMarks, locked: boolean): FoldersTreeValue {
  if (locked || !sidebar) return { space: space.id, folders: [], tags: [] };
  const tree = overlaySidebar(sidebar, entries, space.scope);
  const counts = index ? new Map(overlayFolderIndex(index, entries, space.scope).folders.map((f) => [f.id, f.documentCount])) : null;
  return { space: space.id, folders: folderTree(tree.folders, counts, marks), tags: tagRows(tree.tags) };
}

const foldersTree: ValueViewDef = {
  kind: "value",
  parse: home.parse,
  create: (ctx, args) => {
    const deps = ctx.deps();
    const space = requireSpace(deps, args.space as string | undefined);
    const sidebar = source<SidebarData>(ctx, api.organization.sidebar, { scope: space.scope }, space.scope);
    const index = source<FolderIndexData>(ctx, api.organization.index, { scope: space.scope, only: "folders" }, space.scope);
    return {
      signals: [sidebar, index, outboxSignal(ctx), engineSignal(ctx), deps.e2eeSignal],
      compute: () => {
        const d = ctx.deps();
        const s = sidebar.snapshot();
        if (s.error && !s.value) return { value: undefined, stale: false, error: s.error };
        const i = index.snapshot();
        return { value: foldersTreeValue(space, s.value, i.value, entriesOf(d), marksOf(d), d.spaceStatus(space.scope).locked), stale: s.stale, error: null };
      },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------------
// note.meta
// ---------------------------------------------------------------------------------------------------------------

type DocumentGet = {
  document: SummaryLike & { workspaceId: string | null; ownerProfileId: string | null };
  access: string;
  folder: { id: string; name: string } | null;
  breadcrumbs: { id: string; title: string; icon: string | null }[];
  inTrash: boolean;
} | null;

const EDIT_ACCESS = new Set(["write", "manage"]);

export function noteMetaValue(noteId: string, got: DocumentGet | undefined, deps: EngineDeps, colors: ReadonlyMap<string, string | null> = new Map()): NoteMeta {
  const marks = marksOf(deps);
  if (!got) {
    const row = noteRowOf({ id: noteId, title: "", icon: null, kind: "document", excerpt: "", preview: null, cover: { kind: "none" }, style: undefined as never, createdAt: 0, updatedAt: 0, folderId: null }, marks);
    return { id: noteId, found: false, title: "", icon: null, kind: "document", space: null, folder: null, breadcrumbs: [], starred: false, access: "read", canEdit: false, encrypted: false, archived: false, inTrash: false, cover: row.cover, style: row.style, sync: markOf(noteId, marks) };
  }
  const d = got.document;
  const row = noteRowOf(d, marks, { inTrash: got.inTrash });
  const space = d.workspaceId ? (deps.app.spaces.find((s) => s.id === d.workspaceId)?.id ?? null) : d.ownerProfileId === deps.app.profile.id ? "personal" : null;
  return {
    id: d.id,
    found: true,
    title: row.title,
    icon: row.icon,
    kind: row.kind,
    space,
    folder: got.folder ? { id: got.folder.id, name: got.folder.name, color: colors.get(got.folder.id) ?? null } : null,
    breadcrumbs: got.breadcrumbs.map((b) => ({ id: b.id, title: b.title ?? "", icon: b.icon ?? null })),
    starred: row.starred,
    access: got.access,
    canEdit: EDIT_ACCESS.has(got.access) && !got.inTrash,
    encrypted: row.encrypted,
    archived: row.archived,
    inTrash: got.inTrash,
    cover: row.cover,
    style: row.style,
    sync: row.sync,
  };
}

const noteMeta: ValueViewDef = {
  kind: "value",
  parse: (args) => {
    only(args, ["id"]);
    return { id: id(args, "id") };
  },
  create: (ctx, args) => {
    const noteId = args.id as string;
    const got = source<DocumentGet>(ctx, api.documents.get, { documentId: noteId }, null);
    // (Its folder's colour, from the current space's tree: documents.get names the folder only.)
    const space = spaceOf(ctx.deps().app, undefined);
    const sidebar = space ? source<SidebarData>(ctx, api.organization.sidebar, { scope: space.scope }, space.scope) : null;
    return {
      signals: [got, ...(sidebar ? [sidebar] : []), engineSignal(ctx), outboxSignal(ctx)],
      compute: () => {
        const s = got.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (s.value === undefined && s.stale) return { value: noteMetaValue(noteId, undefined, ctx.deps()), stale: true, error: null };
        const colors = new Map((sidebar?.snapshot().value?.folders ?? []).map((f) => [f.id, f.color ?? null]));
        return { value: noteMetaValue(noteId, s.value ?? undefined, ctx.deps(), colors), stale: s.stale, error: null };
      },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------------
// notes.list (windowed)
// ---------------------------------------------------------------------------------------------------------------

/** Rows per page asked of documents.list. */
export const PAGE_ROWS = 200;

export function parseNotesListArgs(raw: Args): NotesListArgs {
  only(raw, ["space", "view", "folderId", "tagId", "sort"]);
  const view = oneOf(raw, "view", NOTES_LIST_VIEWS);
  const out: NotesListArgs = { view };
  const space = optionalId(raw, "space");
  if (space !== undefined) out.space = space;
  if (view === "folder") out.folderId = id(raw, "folderId");
  else if (raw.folderId !== undefined) throw new BridgeError("invalid_args", "folderId is only for view “folder”.");
  if (view === "tag") out.tagId = id(raw, "tagId");
  else if (raw.tagId !== undefined) throw new BridgeError("invalid_args", "tagId is only for view “tag”.");
  if (raw.sort !== undefined) out.sort = oneOf(raw, "sort", NOTES_SORTS);
  return out;
}

/**
 * A documents.list chain: page k asks from page k-1's continue cursor, as usePaginatedQuery does, so the pages stay
 * contiguous while each is live. More pages are added only when the window reaches past what's loaded.
 */
class PagedList implements Signal {
  readonly pages: QuerySource<ListPage>[] = [];
  private offs: (() => void)[] = [];
  private listening = false;
  private emitter: Emitter;

  constructor(
    private ctx: ViewContext,
    private args: Record<string, unknown>,
    private scope: WireScope,
  ) {
    this.emitter = new Emitter(() => this.start());
    this.add(null);
  }

  subscribe(cb: () => void): () => void {
    return this.emitter.subscribe(cb);
  }

  private add(cursor: string | null) {
    const page = source<ListPage>(this.ctx, api.documents.list, { ...this.args, paginationOpts: { numItems: PAGE_ROWS, cursor } }, this.scope);
    this.pages.push(page);
    if (this.listening) this.offs.push(page.subscribe(() => this.emitter.emit()));
  }

  private start(): () => void {
    this.listening = true;
    this.offs = this.pages.map((p) => p.subscribe(() => this.emitter.emit()));
    return () => {
      this.listening = false;
      for (const off of this.offs) off();
      this.offs = [];
    };
  }

  ensure(rows: number) {
    const last = this.pages[this.pages.length - 1]!.snapshot().value;
    if (!last || last.isDone) return;
    const loaded = this.pages.reduce((n, p) => n + (p.snapshot().value?.page.length ?? 0), 0);
    if (loaded >= rows) return;
    this.add(last.continueCursor);
    this.emitter.emit();
  }

  snapshot(): { docs: SummaryLike[]; complete: boolean; stale: boolean; error: EngineError | null; loading: boolean } {
    const docs: SummaryLike[] = [];
    const seen = new Set<string>();
    let stale = false;
    let complete = false;
    for (const p of this.pages) {
      const s = p.snapshot();
      if (s.error) return { docs, complete: false, stale: false, error: s.error, loading: false };
      if (!s.value) return { docs, complete: false, stale, error: null, loading: docs.length === 0 };
      stale ||= s.stale;
      for (const d of s.value.page) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        docs.push(d);
      }
      complete = s.value.isDone;
    }
    return { docs, complete, stale, error: null, loading: false };
  }
}

/** The list's rows with what waits on this device laid over them (pure). */
export function notesListRows(args: NotesListArgs, docs: readonly SummaryLike[], o: { entries: readonly OutboxEntry[]; marks: SyncMarks; pending: SummaryLike[]; folders: ReadonlyMap<string, FolderChip> }): NoteRow[] {
  const moved = pendingNoteFolders(o.entries);
  const inTrash = args.view === "trash";
  const out: NoteRow[] = [];
  const seen = new Set<string>();
  // Notes made on this device that the server doesn't have yet go first in the lists they belong to.
  if (args.view === "all" || args.view === "unsorted" || args.view === "folder") {
    for (const p of o.pending) {
      if (args.view === "unsorted" && p.folderId) continue;
      seen.add(p.id);
      out.push(noteRowOf(p, o.marks, { folders: o.folders }));
    }
  }
  for (const d of docs) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    const to = moved.has(d.id) ? (moved.get(d.id) ?? null) : undefined;
    // A note moved out of this folder (or out of Drafts) while offline leaves the list at once.
    if (to !== undefined && ((args.view === "folder" && to !== args.folderId) || (args.view === "unsorted" && to !== null))) continue;
    out.push(noteRowOf(d, o.marks, { inTrash, ...(args.view === "starred" ? { starred: true } : {}), ...(to !== undefined ? { folderId: to, folders: o.folders } : { folders: o.folders }) }));
  }
  return out;
}

const notesList: ListViewDef = {
  kind: "list",
  parse: (args) => parseNotesListArgs(args) as unknown as Args,
  create: (ctx, raw) => {
    const args = raw as unknown as NotesListArgs;
    const deps = ctx.deps();
    const space = requireSpace(deps, args.space);
    const scope = space.scope;
    const queryArgs: Record<string, unknown> = { scope, view: args.view, sort: args.sort ?? "updated" };
    if (args.folderId) queryArgs.folderId = args.folderId;
    if (args.tagId) queryArgs.tagId = args.tagId;
    const paged = new PagedList(ctx, queryArgs, scope);
    const sidebar = source<SidebarData>(ctx, api.organization.sidebar, { scope }, scope);
    return {
      signals: [paged, sidebar, outboxSignal(ctx), engineSignal(ctx), deps.e2eeSignal],
      ensure: (rows) => paged.ensure(rows),
      compute: () => {
        const d = ctx.deps();
        const entries = entriesOf(d);
        // A folder made on this device and not yet on the server has no notes there to ask for.
        const unsent = args.view === "folder" && entries.some((e) => e.creates?.includes(args.folderId!));
        const snap = unsent ? { docs: [], complete: true, stale: false, error: null, loading: false } : paged.snapshot();
        if (d.spaceStatus(scope).locked) return { ids: [], rows: new Map(), complete: true, stale: false, error: null };
        if (snap.error) return { ids: [], rows: new Map(), complete: true, stale: false, error: snap.error };
        const engineState = d.app.engine?.state ?? null;
        const pending = pendingCreates(engineState, { scopeKey: spaceKey(scope), ...(args.view === "folder" ? { folderId: args.folderId! } : {}) });
        const rows = notesListRows(args, snap.docs, { entries, marks: marksOf(d), pending: snap.loading && !pending.length ? [] : pending, folders: folderChips(sidebar.snapshot().value) });
        return { ids: rows.map((r) => r.id), rows: new Map(rows.map((r) => [r.id, r])), complete: snap.complete, stale: snap.stale || snap.loading, error: null };
      },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------------------------

export const VALUE_VIEWS: Record<ViewName, ValueViewDef> = {
  session,
  "places.list": placesList,
  home,
  "folders.tree": foldersTree,
  "sync.status": syncStatus,
  "note.meta": noteMeta,
};

export const LIST_VIEWS: Record<ListViewName, ListViewDef> = {
  "notes.list": notesList,
};

/** Parses a view's args: the message's args object, checked. */
export function parseViewArgs(def: ValueViewDef | ListViewDef, raw: unknown): Args {
  return def.parse(argsOf(raw));
}

export { signalOf };
