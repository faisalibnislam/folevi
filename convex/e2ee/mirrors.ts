// Readable copies a feature switch asked for (docs/E2EE_DESIGN.md §7.2 to §7.4, §5.3). WP5.
//
// In an encrypted space the server can't read notes. When the space turns on Search everywhere, Background
// Foli AI or Apps and integrations, a member's unlocked device keeps a readable copy of every sealed,
// unlocked note for that purpose (`e2eeMirrors`, written by apps/web features/mirror.ts):
//
//   search: the title, and the note's searchText plus its found text (what the server's search index holds
//           for Standard notes);
//   ai:     the title and the note as Markdown, for embeddings, related notes, suggestions, digests, routines;
//   apps:   the title, the note as Markdown (mcp.ts noteDetail's shape), folder path, tag names and tasks,
//           for MCP, the REST API, webhooks and calendar feeds.
//
//   put:     writes one note's copy (refused when the switch is off or the note is locked);
//   remove:  deletes one note's copy (the note was locked, trashed, or left the space);
//   hashes:  the content hashes stored, a page at a time, so devices upload only what changed;
//   purge:   deletes every copy of a purpose in a space, and for "ai" every AI row built from them
//            (scheduled by e2ee.spaces.setSwitches when the switch goes off).
//
// Copies are what the switch's description in Settings > Privacy says is readable by Folevi, and nothing
// more. Locked notes never have one.
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { accessAtLeast, assertWritable, documentAccess, getDocumentByPublicId, requireProfile, resolveScope } from "../lib/auth";
import { fail } from "../lib/errors";
import { inScope, insertScoped, scopeOfRow, vScope, vScopeArg, type Scope } from "../lib/scope";
import { failE2ee, isLocked, isSealed, spaceE2ee, switchesOf } from "../lib/e2ee/state";
import { vMirrorPurpose, vMirrorTask, type MirrorPurpose, type MirrorTask, type SwitchName } from "../lib/e2ee/validators";
import { queueIndex } from "../lib/ai/indexing";
import { emitWebhook } from "../lib/webhooks";

/** The switch each purpose needs. */
export const SWITCH_OF: Record<MirrorPurpose, SwitchName> = { search: "searchEverywhere", ai: "backgroundAi", apps: "apps" };

export const MIRROR_LIMITS = {
  /** A copy's text (a Convex document holds at most 1 MiB in all). */
  textBytes: 900 * 1024,
  titleChars: 500,
  folderPathChars: 1_000,
  tags: 100,
  tagChars: 200,
  tasks: 1_000,
  taskChars: 2_000,
  hashChars: 128,
  /** Rows per page of `hashes`. */
  page: 100,
  /** Rows deleted per purge step. */
  purgeBatch: 50,
} as const;

const bytesOf = (s: string) => new TextEncoder().encode(s).byteLength;

/** One indexed read: a note's copy for a purpose. */
export async function mirrorOf(ctx: QueryCtx, documentId: Id<"documents">, purpose: MirrorPurpose): Promise<Doc<"e2eeMirrors"> | null> {
  return await ctx.db
    .query("e2eeMirrors")
    .withIndex("by_document_purpose", (q) => q.eq("documentId", documentId).eq("purpose", purpose))
    .unique();
}

/** A scope's copies of a purpose, through the scope index. */
export function scopeMirrors(ctx: QueryCtx, scope: Scope, purpose: MirrorPurpose) {
  return ctx.db
    .query("e2eeMirrors")
    .withIndex("by_scope_purpose", (q) =>
      scope.kind === "personal"
        ? q.eq("workspaceId", undefined).eq("ownerProfileId", scope.profileId).eq("purpose", purpose)
        : q.eq("workspaceId", scope.workspaceId).eq("ownerProfileId", undefined).eq("purpose", purpose),
    );
}

/** Whether the space's switch for a purpose is on (Standard spaces have no copies: their notes are readable). */
export async function mirrorSwitchOn(ctx: QueryCtx, scope: Scope, purpose: MirrorPurpose): Promise<boolean> {
  const space = await spaceE2ee(ctx, scope);
  return Boolean(switchesOf(space)[SWITCH_OF[purpose]]);
}

/**
 * Notes whose copy of `purpose` matches a search, in a scope (title matches first, then text), for the
 * features that search sealed notes through their copies (MCP's search_notes with Apps on). The caller
 * checks each note's access; the switch is checked here.
 */
export async function searchMirrors(ctx: QueryCtx, scope: Scope, purpose: MirrorPurpose, text: string, limit: number): Promise<Doc<"e2eeMirrors">[]> {
  const q = text.trim().slice(0, 200);
  if (!q || !(await mirrorSwitchOn(ctx, scope, purpose))) return [];
  const filter = <S extends { eq: (f: "workspaceId" | "ownerProfileId" | "purpose", v: unknown) => S }>(s: S) =>
    (scope.kind === "personal" ? s.eq("ownerProfileId", scope.profileId) : s.eq("workspaceId", scope.workspaceId)).eq("purpose", purpose);
  const byTitle = await ctx.db
    .query("e2eeMirrors")
    .withSearchIndex("search_title", (s) => filter(s.search("title", q) as never) as never)
    .take(limit);
  const byText = await ctx.db
    .query("e2eeMirrors")
    .withSearchIndex("search_text", (s) => filter(s.search("text", q) as never) as never)
    .take(limit);
  const out = new Map<string, Doc<"e2eeMirrors">>();
  for (const m of [...byTitle, ...byText]) if (!out.has(m.documentId)) out.set(m.documentId, m);
  return [...out.values()].slice(0, limit);
}

/** Deletes the AI rows built from a note's copy (embeddings, the knowledge graph), up to `n` per table. */
export async function dropAiRows(ctx: MutationCtx, documentId: Id<"documents">, n = 200): Promise<number> {
  let dropped = 0;
  const take = async <T extends { _id: Id<any> }>(rows: Promise<T[]>) => {
    for (const r of await rows) {
      await ctx.db.delete(r._id);
      dropped++;
    }
  };
  await take(ctx.db.query("aiChunks").withIndex("by_document", (q) => q.eq("documentId", documentId)).take(n));
  await take(ctx.db.query("aiIndexState").withIndex("by_document", (q) => q.eq("documentId", documentId)).take(n));
  await take(ctx.db.query("aiGraphState").withIndex("by_document", (q) => q.eq("documentId", documentId)).take(n));
  await take(ctx.db.query("aiRelations").withIndex("by_source", (q) => q.eq("sourceDocumentId", documentId)).take(n));
  await take(ctx.db.query("aiRelations").withIndex("by_to_document", (q) => q.eq("toDocumentId", documentId)).take(n));
  const mentions = await ctx.db
    .query("aiMentions")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .take(n);
  for (const m of mentions) {
    await ctx.db.delete(m._id);
    dropped++;
    // An entity named only by sealed notes goes with its last mention (its name came from their text).
    const other = await ctx.db
      .query("aiMentions")
      .withIndex("by_entity", (q) => q.eq("entityId", m.entityId))
      .first();
    if (!other && (await ctx.db.get(m.entityId))) {
      await ctx.db.delete(m.entityId);
      dropped++;
    }
  }
  return dropped;
}

/** A sealed note of the scope the caller can edit, for writing its copy. */
async function writableSealed(ctx: QueryCtx, profile: Doc<"profiles">, scope: Scope | null, documentId: string): Promise<Doc<"documents">> {
  const doc = await getDocumentByPublicId(ctx, documentId);
  if (!doc || doc.deletedAt !== undefined || (scope && !inScope(doc, scope))) fail("not_found", "Note not found.");
  if (!accessAtLeast(await documentAccess(ctx, profile, doc), "write")) fail("forbidden", "You can't change this note.");
  return doc;
}

const vTasks = v.array(vMirrorTask);

/** Writes one sealed note's readable copy for a purpose (the device's features/mirror.ts). */
export const put = mutation({
  args: {
    scope: vScopeArg,
    purpose: vMirrorPurpose,
    documentId: v.string(),
    title: v.string(),
    text: v.string(),
    folderPath: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    tasks: v.optional(vTasks),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const doc = await writableSealed(ctx, profile, scope, args.documentId);
    if (!isSealed(doc)) fail("invalid_argument", "This note isn't encrypted, so it needs no readable copy.");
    if (await isLocked(ctx, doc)) failE2ee("e2ee_locked");
    if (doc.inTrash) fail("invalid_argument", "Notes in Trash have no readable copy.");
    if (!(await mirrorSwitchOn(ctx, scope, args.purpose))) failE2ee("e2ee_switch_off", undefined, { switch: SWITCH_OF[args.purpose] });
    if (bytesOf(args.text) > MIRROR_LIMITS.textBytes) fail("limit_exceeded", "This note is too long for a readable copy.");
    if (args.title.length > MIRROR_LIMITS.titleChars || (args.folderPath?.length ?? 0) > MIRROR_LIMITS.folderPathChars || args.contentHash.length > MIRROR_LIMITS.hashChars || !args.contentHash) {
      fail("invalid_argument", "That readable copy isn't valid.");
    }
    if ((args.tags?.length ?? 0) > MIRROR_LIMITS.tags || args.tags?.some((t) => t.length > MIRROR_LIMITS.tagChars)) fail("invalid_argument", "Too many or too long tags.");
    if ((args.tasks?.length ?? 0) > MIRROR_LIMITS.tasks || args.tasks?.some((t) => t.text.length > MIRROR_LIMITS.taskChars)) fail("invalid_argument", "Too many or too long tasks.");
    // Only the purpose's own fields are kept: search and ai copies have no folders, tags or tasks.
    const extra = args.purpose === "apps" ? { folderPath: args.folderPath, tags: args.tags, tasks: args.tasks } : { folderPath: undefined, tags: undefined, tasks: undefined };
    const existing = await mirrorOf(ctx, doc._id, args.purpose);
    const now = Date.now();
    if (existing && existing.contentHash === args.contentHash) return { changed: false };
    if (existing) await ctx.db.patch(existing._id, { title: args.title, text: args.text, ...extra, contentHash: args.contentHash, updatedAt: now });
    else {
      await insertScoped(ctx, "e2eeMirrors", scope, {
        purpose: args.purpose,
        documentId: doc._id,
        title: args.title,
        text: args.text,
        ...(extra.folderPath !== undefined ? { folderPath: extra.folderPath } : {}),
        ...(extra.tags ? { tags: extra.tags } : {}),
        ...(extra.tasks ? { tasks: extra.tasks } : {}),
        contentHash: args.contentHash,
        updatedAt: now,
      });
    }
    // What the switch feeds follows the copy: embeddings and the graph (ai), webhooks (apps).
    if (args.purpose === "ai") await queueIndex(ctx, doc);
    if (args.purpose === "apps") await appsEvents(ctx, doc, existing, args.tasks ?? []);
    return { changed: true };
  },
});

/** Webhook events a new apps copy stands for: the note appeared or changed, tasks were added or done. */
async function appsEvents(ctx: MutationCtx, doc: Doc<"documents">, before: Doc<"e2eeMirrors"> | null, tasks: MirrorTask[]): Promise<void> {
  await emitWebhook(ctx, before ? "note.updated" : "note.created", doc);
  const old = new Map((before?.tasks ?? []).map((t) => [t.blockId, t]));
  for (const t of tasks.slice(0, 20)) {
    const was = old.get(t.blockId);
    if (!was && before) await emitWebhook(ctx, "task.created", doc, { taskBlockId: t.blockId });
    if (t.done && was && !was.done) await emitWebhook(ctx, "task.completed", doc, { taskBlockId: t.blockId });
  }
}

/** Deletes one note's copy of a purpose (and for "ai", what was built from it). */
export const remove = mutation({
  args: { purpose: vMirrorPurpose, documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await writableSealed(ctx, profile, null, args.documentId);
    const row = await mirrorOf(ctx, doc._id, args.purpose);
    if (row) await ctx.db.delete(row._id);
    if (args.purpose === "ai" && (await dropAiRows(ctx, doc._id)) >= 200) await ctx.scheduler.runAfter(0, internal.e2ee.mirrors.dropAi, { documentId: doc._id });
    return { removed: row !== null };
  },
});

/** The rest of a note's AI rows (a note with a very large graph). */
export const dropAi = internalMutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    if ((await dropAiRows(ctx, args.documentId)) >= 200) await ctx.scheduler.runAfter(0, internal.e2ee.mirrors.dropAi, { documentId: args.documentId });
    return null;
  },
});

/**
 * The content hashes of a scope's copies of a purpose, a page at a time, so a device uploads only the notes
 * whose copy changed. Only notes the caller can read are listed.
 */
export const hashes = query({
  args: { scope: vScopeArg, purpose: vMirrorPurpose, cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args): Promise<{ items: { documentId: string; contentHash: string }[]; cursor: string | null }> => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const page = await scopeMirrors(ctx, scope, args.purpose).paginate({ cursor: args.cursor ?? null, numItems: MIRROR_LIMITS.page });
    const items: { documentId: string; contentHash: string }[] = [];
    for (const m of page.page) {
      const doc = await ctx.db.get(m.documentId);
      if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) continue;
      items.push({ documentId: doc.publicId, contentHash: m.contentHash });
    }
    return { items, cursor: page.isDone ? null : page.continueCursor };
  },
});

/**
 * Deletes every copy of a purpose in a space, a batch at a time; for "ai" also the embeddings and graph
 * rows built from them. Scheduled by e2ee.spaces.setSwitches when the switch goes off (and by lowering to
 * Fully encrypted). Safe to run again: it ends when nothing is left.
 */
export const purge = internalMutation({
  args: { scope: vScope, purpose: vMirrorPurpose },
  handler: async (ctx, args) => {
    const scope = args.scope as Scope;
    // Turned on again meanwhile: the copies are wanted after all.
    if (await mirrorSwitchOn(ctx, scope, args.purpose)) return { deleted: 0, done: true };
    const rows = await scopeMirrors(ctx, scope, args.purpose).take(MIRROR_LIMITS.purgeBatch);
    let more = rows.length === MIRROR_LIMITS.purgeBatch;
    for (const m of rows) {
      if (args.purpose === "ai" && (await dropAiRows(ctx, m.documentId)) >= 200) {
        // A large graph: this note's copy stays until its rows are gone (the next step continues).
        more = true;
        continue;
      }
      await ctx.db.delete(m._id);
    }
    if (more) await ctx.scheduler.runAfter(0, internal.e2ee.mirrors.purge, { scope: args.scope, purpose: args.purpose });
    return { deleted: rows.length, done: !more };
  },
});

/** Removes a note's copies of every purpose (it was locked, or is being deleted). For other modules. */
export async function removeMirrors(ctx: MutationCtx, documentId: Id<"documents">): Promise<void> {
  for (const purpose of ["search", "ai", "apps"] as const) {
    const row = await mirrorOf(ctx, documentId, purpose);
    if (row) await ctx.db.delete(row._id);
  }
  if ((await dropAiRows(ctx, documentId)) >= 200) await ctx.scheduler.runAfter(0, internal.e2ee.mirrors.dropAi, { documentId });
}

/** The scope of a copy, for callers that hold a row. */
export const mirrorScope = (m: Doc<"e2eeMirrors">) => scopeOfRow(m);
