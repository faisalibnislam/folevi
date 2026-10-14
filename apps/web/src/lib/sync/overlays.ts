// What the outbox's waiting changes look like on top of the last answer from the server: the folder made
// offline in the sidebar, the comment written on the train in its thread, the row added in the table.
// Pure functions of (server answer, queued changes), so a change shows the same way online and offline,
// survives a reload, and disappears into the server's answer once it lands (it's matched by id).
import type { FunctionReturnType } from "convex/server";
import { DEFAULT_COVER, folderMoveProblem, scopeIdKey, type WireScope } from "@folevi/editor-schema";
import type { api } from "@/lib/convex/api";
import type { OutboxArgs, OutboxEntry, OutboxName } from "./outbox";

/** A change still on this device: waiting for a connection (or being sent), or refused by the server. */
export type Waiting = "queued" | "failed";

const waitingOf = (e: OutboxEntry): Waiting => (e.failed ? "failed" : "queued");

/** The entries for one mutation, typed. */
function is<N extends OutboxName>(e: OutboxEntry, name: N): e is OutboxEntry<N> {
  return e.name === name;
}

const sameScope = (a: WireScope | undefined, b: WireScope) => a !== undefined && scopeIdKey(a) === scopeIdKey(b);

// ------------------------------------------------------------------ folders

export type SidebarData = FunctionReturnType<typeof api.organization.sidebar>;
type SidebarFolder = SidebarData["folders"][number];

/** The sidebar's folders with the waiting folder changes of `scope` applied. */
export function overlaySidebar(data: SidebarData, entries: readonly OutboxEntry[], scope: WireScope): SidebarData {
  const folders = overlayFolders(data.folders, entries, scope, (f) => f);
  return folders === data.folders ? data : { ...data, folders };
}

export type FolderIndexData = FunctionReturnType<typeof api.organization.index>;

/** The All folders view's rows with the waiting folder changes of `scope` applied (a new one is empty). */
export function overlayFolderIndex(data: FolderIndexData, entries: readonly OutboxEntry[], scope: WireScope): FolderIndexData {
  const folders = overlayFolders(data.folders, entries, scope, (f, at) => ({ ...f, createdAt: at, updatedAt: at, documentCount: 0, previews: [] }));
  return folders === data.folders ? data : { ...data, folders };
}

/** Folders (of any shape with the sidebar's fields) with the waiting folder changes of `scope` applied. */
function overlayFolders<T extends SidebarFolder>(list: T[], entries: readonly OutboxEntry[], scope: WireScope, make: (f: SidebarFolder, at: number) => T): T[] {
  let folders = list;
  for (const e of entries) {
    if (is(e, "organization.createFolder")) {
      const a = e.args;
      if (!a.id || !sameScope(a.scope as WireScope, scope) || folders.some((f) => f.id === a.id)) continue;
      // New folders go last, as the server puts them.
      folders = [...folders, make({ id: a.id, name: a.name.trim() || "Folder", color: null, parentFolderId: a.parentFolderId ?? null, rank: `~${e.id}` }, e.createdAt)];
    } else if (is(e, "organization.renameFolder")) {
      folders = folders.map((f) => (f.id === e.args.folderId ? { ...f, name: e.args.name.trim() || f.name } : f));
    } else if (is(e, "organization.setFolderColor")) {
      folders = folders.map((f) => (f.id === e.args.folderId ? { ...f, color: e.args.color } : f));
    } else if (is(e, "organization.moveFolder")) {
      const { folderId, parentFolderId } = e.args;
      if (!folders.some((f) => f.id === folderId) || (parentFolderId !== null && !folders.some((f) => f.id === parentFolderId))) continue;
      if (folderMoveProblem(folders, folderId, parentFolderId)) continue;
      folders = folders.map((f) => (f.id === folderId ? { ...f, parentFolderId } : f));
    } else if (is(e, "organization.deleteFolder")) {
      const gone = folders.find((f) => f.id === e.args.folderId);
      if (!gone) continue;
      // Its subfolders move up a level, as on the server.
      folders = folders.filter((f) => f.id !== gone.id).map((f) => (f.parentFolderId === gone.id ? { ...f, parentFolderId: gone.parentFolderId } : f));
    }
  }
  return folders;
}

/** The folder each note is in once the waiting moves land (only the notes they move). */
export function pendingNoteFolders(entries: readonly OutboxEntry[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const e of entries) {
    if (is(e, "documents.bulkUpdate")) {
      const action = e.args.action;
      if (action.kind === "move") for (const id of e.args.documentIds) out.set(id, action.folderId);
    } else if (is(e, "documents.move") && e.args.folderId !== undefined) {
      out.set(e.args.documentId, e.args.folderId);
    }
  }
  return out;
}

// ------------------------------------------------------------------ comments

export type ThreadsData = FunctionReturnType<typeof api.comments.threads>;
type ServerThread = ThreadsData["threads"][number];
type ServerComment = ServerThread["comments"][number];
/** `waiting`: the comment (or its latest edit) is still on this device; `entryId` is that outbox entry. */
export type OverlayComment = ServerComment & { waiting?: Waiting; entryId?: string };
export type OverlayThread = Omit<ServerThread, "comments"> & { comments: OverlayComment[]; waiting?: Waiting };
export type OverlayThreads = Omit<ThreadsData, "threads"> & { threads: OverlayThread[] };

export interface Me {
  id: string;
  name: string;
  avatarUrl: string | null;
}

type ReactionGroup = ServerComment["reactions"][number];
const REACTION_ORDER = ["thumbsUp", "heart", "check", "eyes", "laugh", "idea"];

/** The comment's reactions with the caller's reaction of `kind` on or off. */
export function setReaction(reactions: ReactionGroup[], kind: ReactionGroup["kind"], on: boolean): ReactionGroup[] {
  const found = reactions.find((r) => r.kind === kind);
  if (Boolean(found?.mine) === on) return reactions;
  const next = on
    ? found
      ? reactions.map((r) => (r.kind === kind ? { ...r, count: r.count + 1, mine: true } : r))
      : [...reactions, { kind, count: 1, mine: true, names: [] }]
    : reactions.flatMap((r) => (r.kind !== kind ? [r] : r.count > 1 ? [{ ...r, count: r.count - 1, mine: false }] : []));
  return next.sort((a, b) => REACTION_ORDER.indexOf(a.kind) - REACTION_ORDER.indexOf(b.kind));
}

function bumpBlock(blocks: ThreadsData["blocks"], blockId: string, at: number, me: Me, newThread: boolean): ThreadsData["blocks"] {
  const found = blocks.find((b) => b.blockId === blockId);
  if (!found) return [...blocks, { blockId, threads: 1, comments: 1, lastActivityAt: at, unread: false, authors: [{ name: me.name, avatarUrl: me.avatarUrl }] }];
  return blocks.map((b) =>
    b.blockId === blockId
      ? { ...b, threads: b.threads + (newThread ? 1 : 0), comments: b.comments + 1, lastActivityAt: at, authors: [{ name: me.name, avatarUrl: me.avatarUrl }, ...b.authors.filter((x) => x.name !== me.name)].slice(0, 3) }
      : b,
  );
}

/** The per-block summary without one (open) thread. */
function dropThread(blocks: ThreadsData["blocks"], t: OverlayThread | undefined): ThreadsData["blocks"] {
  if (!t || !t.blockId || t.status !== "open") return blocks;
  const live = t.comments.filter((c) => !c.deleted).length;
  return blocks.flatMap((b) => (b.blockId !== t.blockId ? [b] : b.threads <= 1 ? [] : [{ ...b, threads: b.threads - 1, comments: Math.max(0, b.comments - live) }]));
}

function newComment(id: string, body: unknown[], at: number, me: Me, e: OutboxEntry): OverlayComment {
  return {
    id,
    authorId: me.id,
    authorName: me.name,
    authorAvatarUrl: me.avatarUrl,
    body: body as ServerComment["body"],
    deleted: false,
    createdAt: at,
    editedAt: null,
    mine: true,
    canEdit: true,
    canDelete: true,
    reactions: [],
    waiting: waitingOf(e),
    entryId: e.id,
  };
}

/** A note's threads with the waiting comment changes applied (only its own: `documentId`). */
export function overlayThreads(data: ThreadsData, entries: readonly OutboxEntry[], documentId: string, me: Me): OverlayThreads {
  let threads: OverlayThread[] = data.threads;
  let blocks = data.blocks;
  const editComment = (commentId: string, fn: (c: OverlayComment) => OverlayComment) => {
    threads = threads.map((t) => (t.comments.some((c) => c.id === commentId) ? { ...t, comments: t.comments.map((c) => (c.id === commentId ? fn(c) : c)) } : t));
  };
  const hasComment = (id: string) => threads.some((t) => t.comments.some((c) => c.id === id));
  for (const e of entries) {
    if (is(e, "comments.create")) {
      const a = e.args;
      if (a.documentId !== documentId || !a.threadId || threads.some((t) => t.id === a.threadId)) continue;
      const at = e.createdAt;
      const thread: OverlayThread = {
        id: a.threadId,
        blockId: a.blockId ?? null,
        blockExists: a.blockId ? true : null,
        blockText: null,
        status: "open",
        createdAt: at,
        lastActivityAt: at,
        resolvedBy: null,
        resolvedAt: null,
        unread: false,
        canResolve: true,
        canDelete: true,
        comments: [newComment(a.commentId ?? `${e.id}-comment`, a.body, at, me, e)],
        waiting: waitingOf(e),
      };
      threads = [thread, ...threads];
      if (a.blockId) blocks = bumpBlock(blocks, a.blockId, at, me, true);
    } else if (is(e, "comments.reply")) {
      const a = e.args;
      const target = threads.find((t) => t.id === a.threadId);
      if (!target || !a.commentId || hasComment(a.commentId)) continue;
      if (target.blockId && target.status === "open") blocks = bumpBlock(blocks, target.blockId, e.createdAt, me, false);
      threads = threads.map((t) =>
        t.id === a.threadId ? { ...t, status: "open", resolvedBy: null, resolvedAt: null, lastActivityAt: e.createdAt, comments: [...t.comments, newComment(a.commentId!, a.body, e.createdAt, me, e)] } : t,
      );
    } else if (is(e, "comments.edit")) {
      // An edit refused by the server marks the comment, so its text can be retried or let go.
      editComment(e.args.commentId, (c) => ({ ...c, body: e.args.body as ServerComment["body"], editedAt: e.createdAt, ...(c.waiting !== "failed" ? { waiting: waitingOf(e), entryId: e.id } : {}) }));
    } else if (is(e, "comments.remove")) {
      editComment(e.args.commentId, (c) => ({ ...c, deleted: true, body: [], reactions: [] }));
      const emptied = threads.find((t) => t.comments.length && t.comments.every((c) => c.deleted));
      if (emptied) {
        blocks = dropThread(blocks, emptied);
        threads = threads.filter((t) => t !== emptied);
      }
    } else if (is(e, "comments.setResolved")) {
      const t = threads.find((x) => x.id === e.args.threadId);
      if (!t) continue;
      if (e.args.resolved) blocks = dropThread(blocks, t);
      threads = threads.map((x) =>
        x.id === e.args.threadId ? { ...x, status: e.args.resolved ? "resolved" : "open", resolvedBy: e.args.resolved ? me.name : null, resolvedAt: e.args.resolved ? e.createdAt : null } : x,
      );
    } else if (is(e, "comments.deleteThread")) {
      blocks = dropThread(blocks, threads.find((t) => t.id === e.args.threadId));
      threads = threads.filter((t) => t.id !== e.args.threadId);
    } else if (is(e, "comments.react")) {
      const on = e.args.on;
      if (on === undefined) continue;
      editComment(e.args.commentId, (c) => ({ ...c, reactions: setReaction(c.reactions, e.args.kind, on) }));
    }
  }
  return threads === data.threads && blocks === data.blocks ? data : { ...data, threads, blocks };
}

// ------------------------------------------------------------------ collections

export type CollectionData = FunctionReturnType<typeof api.collections.get>;
type ServerRow = CollectionData["rows"][number];
export type OverlayRow = ServerRow & { waiting?: Waiting };
export type OverlayCollection = Omit<CollectionData, "rows"> & { rows: OverlayRow[] };

const emptyValue = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

function withValue(values: Record<string, unknown>, propertyId: string, value: unknown): Record<string, unknown> {
  const next = { ...values };
  if (emptyValue(value)) delete next[propertyId];
  else next[propertyId] = value;
  return next;
}

/** A collection with the waiting changes to it applied. */
export function overlayCollection(data: CollectionData, entries: readonly OutboxEntry[], collectionId: string): OverlayCollection {
  let out: OverlayCollection = data;
  const rows = (fn: (rows: OverlayRow[]) => OverlayRow[]) => {
    out = { ...out, rows: fn(out.rows) };
  };
  for (const e of entries) {
    if ((e.args as { collectionId?: string }).collectionId !== collectionId) continue;
    if (is(e, "collections.rename")) {
      out = { ...out, name: e.args.name.trim() || out.name };
    } else if (is(e, "collections.addRow")) {
      const a = e.args as OutboxArgs<"collections.addRow">;
      if (!a.id || out.rows.some((r) => r.id === a.id)) continue;
      let values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a.values ?? {})) values = withValue(values, k, v);
      const row: OverlayRow = {
        id: a.id,
        documentId: a.documentId ?? a.id,
        title: (a.title ?? "").slice(0, 300),
        icon: null,
        cover: DEFAULT_COVER as ServerRow["cover"],
        excerpt: "",
        rank: `~${e.id}`,
        values,
        updatedAt: e.createdAt,
        waiting: waitingOf(e),
      };
      rows((list) => {
        const at = a.afterRowId ? list.findIndex((r) => r.id === a.afterRowId) : -1;
        return at >= 0 ? [...list.slice(0, at + 1), row, ...list.slice(at + 1)] : [...list, row];
      });
    } else if (is(e, "collections.setValue")) {
      const { rowId, propertyId, value } = e.args;
      rows((list) => list.map((r) => (r.id === rowId ? { ...r, values: withValue(r.values, propertyId, value) } : r)));
    } else if (is(e, "collections.renameRow")) {
      rows((list) => list.map((r) => (r.id === e.args.rowId ? { ...r, title: e.args.title.slice(0, 300) } : r)));
    } else if (is(e, "collections.moveRow")) {
      const a = e.args;
      rows((list) => {
        const moving = list.find((r) => r.id === a.rowId);
        if (!moving) return list;
        const moved = a.groupPropertyId !== undefined ? { ...moving, values: withValue(moving.values, a.groupPropertyId, a.groupValue ?? null) } : moving;
        const rest = list.filter((r) => r.id !== a.rowId);
        const at = a.afterRowId === null ? -1 : rest.findIndex((r) => r.id === a.afterRowId);
        return [...rest.slice(0, at + 1), moved, ...rest.slice(at + 1)];
      });
    } else if (is(e, "collections.deleteRow")) {
      rows((list) => list.filter((r) => r.id !== e.args.rowId));
    } else if (is(e, "collections.updateView")) {
      const a = e.args;
      out = { ...out, views: out.views.map((v) => (v.id === a.viewId ? { ...v, name: a.name?.trim() || v.name, config: a.config ?? v.config } : v)) };
    }
  }
  return out;
}
