// Revision 4's views (docs/NATIVE_APP_PLAN.md sections 5.4 to 5.7): Trash's summary, built-in templates, a
// folder's subfolders as cards, Shared with Me, Changes, the notifications bell and search. Each is a live view
// over the page's own queries, like lib/engine/views.ts.
import type { WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { overlayFolderIndex, overlaySidebar, type FolderIndexData, type SidebarData } from "@/lib/sync/overlays";
import { changeCounts, whoChanged } from "@/lib/history/changeWords";
import type { ViewContext } from "./context";
import { QuerySource, type Signal, type Snapshot } from "./live";
import { folderCardOf } from "./rows";
import { entriesOf, engineSignal, marksOf, outboxSignal, requireSpace, source, type LiveValue, type ValueViewDef } from "./views";
import { bool, nullableId, num, oneOf, only, optionalId, text } from "./validate";
import { fnv1a, type ChangesValue, type FolderChip, type NotificationRow, type SearchArgs, type SearchHit, type SearchValue, type SharedRow, type ViewName } from "./protocol";

type Args = Record<string, unknown>;

const spaceArgs = (args: Args) => {
  only(args, ["space"]);
  const space = optionalId(args, "space");
  return space === undefined ? {} : { space };
};
const noArgs = (args: Args) => (only(args, []), {});

/** A view over one query, its value mapped. */
function single<T, V>(ctx: ViewContext, src: QuerySource<T>, map: (value: T) => V, extra: Signal[] = []): LiveValue {
  return {
    signals: [src, ...extra],
    compute: (): Snapshot<unknown> => {
      const s = src.snapshot();
      if (s.error) return { value: undefined, stale: false, error: s.error };
      return { value: s.value === undefined ? undefined : map(s.value), stale: s.stale, error: null };
    },
  };
}

// ---- trash.summary

const trashSummary: ValueViewDef = {
  kind: "value",
  parse: spaceArgs,
  create: (ctx, args) => {
    const space = requireSpace(ctx.deps(), args.space as string | undefined);
    return single(ctx, source<{ total: number; deletable: number }>(ctx, api.documents.trashSummary, { scope: space.scope }, space.scope), (v) => ({ total: v.total, deletable: v.deletable }));
  },
};

// ---- templates.builtIn

const templatesBuiltIn: ValueViewDef = {
  kind: "value",
  parse: noArgs,
  create: (ctx) =>
    single(ctx, source<{ key: string; name: string; description: string; icon: string }[]>(ctx, api.settings.builtInTemplates, {}, null), (v) => ({
      templates: v.map((t) => ({ key: t.key, name: t.name, description: t.description, icon: t.icon })),
    })),
};

// ---- folders.cards

const foldersCards: ValueViewDef = {
  kind: "value",
  parse: (args) => {
    only(args, ["space", "parentId"]);
    const out: Args = {};
    const space = optionalId(args, "space");
    if (space !== undefined) out.space = space;
    const parentId = nullableId(args, "parentId");
    if (parentId !== undefined) out.parentId = parentId;
    return out;
  },
  create: (ctx, args) => {
    const space = requireSpace(ctx.deps(), args.space as string | undefined);
    const parentId = (args.parentId as string | null | undefined) ?? null;
    const sidebar = source<SidebarData>(ctx, api.organization.sidebar, { scope: space.scope }, space.scope);
    const index = source<FolderIndexData>(ctx, api.organization.index, { scope: space.scope, only: "folders" }, space.scope);
    return {
      signals: [sidebar, index, outboxSignal(ctx), engineSignal(ctx)],
      compute: () => {
        const d = ctx.deps();
        const s = sidebar.snapshot();
        const i = index.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (d.spaceStatus(space.scope).locked) return { value: { folders: [] }, stale: false, error: null };
        if (!s.value) return { value: undefined, stale: true, error: null };
        const entries = entriesOf(d);
        const tree = overlaySidebar(s.value, entries, space.scope).folders;
        const byId = new Map((i.value ? overlayFolderIndex(i.value, entries, space.scope).folders : []).map((f) => [f.id, f]));
        const marks = marksOf(d);
        const folders = tree
          .filter((f) => (f.parentFolderId ?? null) === parentId)
          .map((f) => folderCardOf(byId.get(f.id) ?? { id: f.id, name: f.name, color: f.color ?? null, parentFolderId: f.parentFolderId ?? null, updatedAt: 0, documentCount: 0, previews: [] }, tree.filter((c) => c.parentFolderId === f.id).length, marks));
        return { value: { folders }, stale: s.stale || i.stale, error: null };
      },
    };
  },
};

// ---- shared.list

type SharedData = { id: string; title: string; icon: string | null; role: string; sharedBy: string; sharedAt: number; workspaceName: string | null; ownerName: string | null; updatedAt: number; excerpt: string; sealed?: unknown }[];

export function sharedRow(r: SharedData[number]): SharedRow {
  const row = { id: r.id, title: r.title ?? "", excerpt: r.excerpt ?? "", icon: r.icon ?? null, sharedBy: r.sharedBy, workspaceName: r.workspaceName ?? null, ownerName: r.ownerName ?? null, role: r.role, sharedAt: r.sharedAt, updatedAt: r.updatedAt, encrypted: Boolean(r.sealed) };
  return { ...row, h: fnv1a(JSON.stringify(row)) };
}

const sharedList: ValueViewDef = {
  kind: "value",
  parse: noArgs,
  create: (ctx) => single(ctx, source<SharedData>(ctx, api.sharing.sharedWithMe, {}, null), (v) => ({ rows: v.map(sharedRow) })),
};

// ---- changes

type ChangesData = { notes: { id: string; title: string; icon: string | null; at: number; actors: string[]; added: number; edited: number; removed: number; more: boolean }[]; people: Record<string, { name: string } | undefined> };
type ProposalsData = { id: string; documentId: string | null; title: string; sourceName: string; summary: string; createdAt: number; problem: string | null }[];

export function changesValue(changes: ChangesData | undefined, proposals: ProposalsData | undefined): ChangesValue {
  return {
    proposals: (proposals ?? []).map((p) => ({ id: p.id, noteId: p.documentId, title: p.title, sourceName: p.sourceName, summary: p.summary ?? "", createdAt: p.createdAt, problem: p.problem ?? null })),
    notes: (changes?.notes ?? []).map((n) => ({
      id: n.id,
      title: n.title ?? "",
      icon: n.icon ?? null,
      who: whoChanged(n.actors.map((a) => changes?.people[a]?.name ?? "Someone")),
      counts: changeCounts(n),
      changedAt: n.at,
    })),
  };
}

const changes: ValueViewDef = {
  kind: "value",
  parse: noArgs,
  create: (ctx) => {
    const list = source<ChangesData>(ctx, api.changes.list, {}, null);
    const props = source<ProposalsData>(ctx, api.proposals.list, { now: Math.floor(Date.now() / 60_000) * 60_000 }, null);
    return {
      signals: [list, props],
      compute: () => {
        const a = list.snapshot();
        const b = props.snapshot();
        if (a.error) return { value: undefined, stale: false, error: a.error };
        if (b.error) return { value: undefined, stale: false, error: b.error };
        if (a.value === undefined || b.value === undefined) return { value: undefined, stale: true, error: null };
        return { value: changesValue(a.value, b.value), stale: a.stale || b.stale, error: null };
      },
    };
  },
};

// ---- notifications.list

type NotificationData = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  fileId: string | null;
  actorName: string | null;
  actorAvatarUrl: string | null;
  documentId: string | null;
  toChanges: boolean;
  documentTitle: string | null;
  threadId: string | null;
  blockId: string | null;
  count: number;
  inviteId: string | null;
  pageInviteId: string | null;
  createdAt: number;
  read: boolean;
};

/** Where tapping a notification goes (components/app/NotificationsButton.tsx notificationHref, the same rule). */
export function notificationRoute(n: Pick<NotificationData, "documentId" | "threadId" | "blockId" | "toChanges">): string | null {
  if (n.toChanges) return "/changes";
  if (!n.documentId) return null;
  const hash = n.threadId ? `#comment-${n.threadId}` : n.blockId ? `#block-${n.blockId}` : "";
  return `/d/${n.documentId}${hash}`;
}

export function notificationRow(n: NotificationData): NotificationRow {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body ?? "",
    at: n.createdAt,
    read: n.read,
    route: notificationRoute(n),
    actorName: n.actorName ?? null,
    actorAvatarUrl: n.actorAvatarUrl ?? null,
    noteId: n.documentId ?? null,
    noteTitle: n.documentTitle ?? null,
    count: n.count ?? 1,
    inviteId: n.inviteId ?? null,
    pageInviteId: n.pageInviteId ?? null,
    fileId: n.fileId ?? null,
  };
}

const notificationsList: ValueViewDef = {
  kind: "value",
  parse: noArgs,
  create: (ctx) => {
    if (ctx.deps().app.mode === "local") {
      // Local mode has no bell (reminders are the system's notifications there).
      return { signals: [], compute: () => ({ value: { unread: 0, rows: [] }, stale: false, error: null }) };
    }
    const list = source<NotificationData[]>(ctx, api.notifications.list, { limit: 50, now: Math.floor(Date.now() / 60_000) * 60_000 }, null);
    const unread = source<number>(ctx, api.notifications.unreadCount, {}, null);
    return {
      signals: [list, unread],
      compute: () => {
        const a = list.snapshot();
        const b = unread.snapshot();
        if (a.error) return { value: undefined, stale: false, error: a.error };
        if (a.value === undefined) return { value: undefined, stale: true, error: null };
        return { value: { unread: b.value ?? a.value.filter((n) => !n.read).length, rows: a.value.map(notificationRow) }, stale: a.stale || b.stale, error: null };
      },
    };
  },
};

// ---- search

type SearchData = { id: string; title: string; icon: string | null; kind: string; updatedAt: number; snippet: string; match: { blockId: string; page: number | null } | null; archived: boolean; homeFolder: { id: string; name: string; color: string | null } | null; place?: { id: string; name: string } }[];

export function parseSearchArgs(args: Args): SearchArgs {
  only(args, ["text", "scope", "space", "folderId", "tagId", "updatedAfter", "includeArchived", "meaning", "limit"]);
  const out: SearchArgs = { text: text(args, "text", { max: 500, allowEmpty: true }) as string };
  if (args.scope !== undefined) out.scope = oneOf(args, "scope", ["place", "everywhere"] as const);
  const space = optionalId(args, "space");
  if (space !== undefined) out.space = space;
  const folderId = optionalId(args, "folderId");
  if (folderId !== undefined) out.folderId = folderId;
  const tagId = optionalId(args, "tagId");
  if (tagId !== undefined) out.tagId = tagId;
  if (args.updatedAfter !== undefined) out.updatedAfter = num(args, "updatedAfter", { min: 0 });
  if (args.includeArchived !== undefined) out.includeArchived = bool(args, "includeArchived");
  if (args.meaning !== undefined) out.meaning = bool(args, "meaning");
  if (args.limit !== undefined) out.limit = num(args, "limit", { min: 1, max: 40 });
  return out;
}

export function searchHits(data: SearchData, spaceOf: (place: { id: string; name: string } | undefined) => { space: string | null; name: string | null }): SearchHit[] {
  return data.map((r) => {
    const where = spaceOf(r.place);
    const folder: FolderChip | null = r.homeFolder ? { id: r.homeFolder.id, name: r.homeFolder.name, color: r.homeFolder.color ?? null } : null;
    return {
      id: r.id,
      title: r.title ?? "",
      icon: r.icon ?? null,
      snippet: r.snippet ?? "",
      folder,
      updatedAt: r.updatedAt,
      archived: Boolean(r.archived),
      kind: r.kind,
      space: where.space,
      spaceName: where.name,
      matchIn: r.match ? "file" : "text",
      blockId: r.match?.blockId ?? null,
      page: r.match?.page ?? null,
    };
  });
}

const search: ValueViewDef = {
  kind: "value",
  parse: (args) => parseSearchArgs(args) as unknown as Args,
  create: (ctx, raw) => {
    const args = raw as unknown as SearchArgs;
    const deps = ctx.deps();
    const space = requireSpace(deps, args.space);
    const q = args.text.trim();
    const limit = args.limit ?? 20;
    const everywhere = args.scope === "everywhere";
    const query = q
      ? everywhere
        ? source<SearchData>(ctx, api.search.everywhere, { query: q, limit }, null)
        : source<SearchData>(ctx, api.search.documents, { scope: space.scope, query: q, limit, ...(args.folderId ? { folderId: args.folderId } : {}), ...(args.tagId ? { tagId: args.tagId } : {}), ...(args.updatedAfter ? { updatedAfter: args.updatedAfter } : {}), ...(args.includeArchived ? { includeArchived: true } : {}) }, space.scope)
      : null;
    const meaningOk = deps.app.mode === "account" ? source<boolean>(ctx, api.search.meaningAvailable, { scope: space.scope }, null) : null;
    // Search by meaning is an action: asked once, then laid after the keyword matches.
    let meaning: { id: string; title: string; snippet: string }[] | null = null;
    const meaningSignal = { listeners: new Set<() => void>(), subscribe(cb: () => void) { this.listeners.add(cb); return () => void this.listeners.delete(cb); } };
    if (q && args.meaning && deps.app.mode === "account") {
      void (deps.client.action(api.search.byMeaning, { scope: space.scope as WireScope, query: q }) as Promise<{ id: string; title: string; snippet: string }[]>).then(
        (r) => {
          meaning = r;
          for (const l of meaningSignal.listeners) l();
        },
        () => undefined,
      );
    }
    const names = (place: { id: string; name: string } | undefined) => (place ? { space: place.id, name: place.name } : { space: space.id, name: space.name });
    return {
      signals: [...(query ? [query] : []), ...(meaningOk ? [meaningOk] : []), meaningSignal],
      compute: () => {
        const available = Boolean(meaningOk?.snapshot().value);
        if (!query) return { value: { text: q, hits: [], meaningAvailable: available } satisfies SearchValue, stale: false, error: null };
        const s = query.snapshot();
        if (s.error) return { value: undefined, stale: false, error: s.error };
        if (s.value === undefined) return { value: undefined, stale: true, error: null };
        const hits = searchHits(s.value, names);
        for (const m of (meaning ?? []) as { id: string; title: string; snippet: string }[]) {
          if (hits.some((h) => h.id === m.id)) continue;
          hits.push({ id: m.id, title: m.title, icon: null, snippet: m.snippet, folder: null, updatedAt: 0, archived: false, kind: "document", space: space.id, spaceName: space.name, matchIn: "meaning", blockId: null, page: null });
        }
        return { value: { text: q, hits, meaningAvailable: available } satisfies SearchValue, stale: s.stale, error: null };
      },
    };
  },
};

export const MORE_VALUE_VIEWS = {
  "trash.summary": trashSummary,
  "templates.builtIn": templatesBuiltIn,
  "folders.cards": foldersCards,
  "shared.list": sharedList,
  changes,
  "notifications.list": notificationsList,
  search,
} satisfies Partial<Record<ViewName, ValueViewDef>>;

