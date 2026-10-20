import { v } from "convex/values";
import { action, internalMutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { hybridSearch } from "./aiIndex";
import { indexEligible } from "./lib/ai/indexing";
import { consume } from "./lib/rateLimit";
import type { Doc, Id } from "./_generated/dataModel";
import { highlightRanges, normalizeForSearch, searchSnippet, type FileTextSource } from "@folevi/editor-schema";
import { fileTextHits } from "./fileText";
import { accessAtLeast, documentAccess, requireIdentity, requireProfile, resolveScope } from "./lib/auth";
import { HomeFolders } from "./lib/documents";
import { inScope, personalScope, vScopeArg, workspaceScope, type Scope } from "./lib/scope";

/**
 * Full-text search of one scope (your Personal, or a workspace you're in) over titles, text blocks (incl.
 * code, captions, table cells), attachment names, tag names and the words found in the notes' PDFs, images
 * and handwriting (fileText.ts; such a result carries `match`: where, and the block to open), with filters. Only notes the person can
 * read are returned. Results carry a short snippet; the client highlights matches.
 */
export const documents = query({
  args: {
    scope: vScopeArg,
    query: v.string(),
    folderId: v.optional(v.string()),
    tagId: v.optional(v.string()),
    creatorId: v.optional(v.string()),
    updatedAfter: v.optional(v.number()),
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    return await searchDocuments(ctx, profile, scope, args);
  },
});

export interface SearchArgs {
  query: string;
  folderId?: string;
  tagId?: string;
  creatorId?: string;
  updatedAfter?: number;
  includeArchived?: boolean;
  limit?: number;
}

/** The search itself, for a person in a scope they're in (also used by the MCP server, convex/mcp.ts). */
export async function searchDocuments(ctx: QueryCtx, profile: Doc<"profiles">, scope: Scope, args: SearchArgs) {
  const q = args.query.trim().slice(0, 200);
  if (!q) return [];
  const limit = Math.min(args.limit ?? 30, 50);
  let folderId: Id<"folders"> | undefined;
  if (args.folderId) {
    const f = await ctx.db
      .query("folders")
      .withIndex("by_public_id", (x) => x.eq("publicId", args.folderId!))
      .unique();
    if (!f || !inScope(f, scope)) return [];
    folderId = f._id;
  }
  const creator = args.creatorId ? ctx.db.normalizeId("profiles", args.creatorId) : null;
  let tagDocs: Set<string> | null = null;
  if (args.tagId) {
    const tag = await ctx.db
      .query("tags")
      .withIndex("by_public_id", (x) => x.eq("publicId", args.tagId!))
      .unique();
    if (!tag || !inScope(tag, scope)) return [];
    const links = await ctx.db
      .query("documentTags")
      .withIndex("by_tag", (x) => x.eq("tagId", tag._id))
      .take(2000);
    tagDocs = new Set(links.map((l) => l.documentId as string));
  }

  const byText = await ctx.db
    .query("documents")
    .withSearchIndex("search_text", (s) => {
      const text = s.search("searchText", q);
      let b = (scope.kind === "personal" ? text.eq("ownerProfileId", scope.profileId) : text.eq("workspaceId", scope.workspaceId)).eq("inTrash", false);
      if (folderId) b = b.eq("folderId", folderId);
      if (creator) b = b.eq("createdBy", creator);
      return b;
    })
    .take(100);
  const byTitle = await ctx.db
    .query("documents")
    .withSearchIndex("search_title", (s) => {
      const title = s.search("title", q);
      return (scope.kind === "personal" ? title.eq("ownerProfileId", scope.profileId) : title.eq("workspaceId", scope.workspaceId)).eq("inTrash", false);
    })
    .take(30);

  // Tag-name matches: documents carrying a tag whose name matches the query.
  const tagMatches: Doc<"documents">[] = [];
  const nq = normalizeForSearch(q);
  const tagBase = ctx.db.query("tags");
  const tags = await (
    scope.kind === "personal" ? tagBase.withIndex("by_owner", (x) => x.eq("ownerProfileId", scope.profileId)) : tagBase.withIndex("by_workspace", (x) => x.eq("workspaceId", scope.workspaceId))
  ).take(500);
  for (const t of tags.filter((t) => t.normalizedName.includes(nq)).slice(0, 5)) {
    const links = await ctx.db
      .query("documentTags")
      .withIndex("by_tag", (x) => x.eq("tagId", t._id))
      .take(20);
    for (const l of links) {
      const d = await ctx.db.get(l.documentId);
      if (d && !d.inTrash && inScope(d, scope)) tagMatches.push(d);
    }
  }

  // Words in the notes' PDFs, images and handwriting (fileText.ts): kept beside the files, with their own index.
  const inFiles = await fileTextHits(ctx, scope, q);
  const fileMatches: Doc<"documents">[] = [];
  for (const id of inFiles.keys()) {
    const d = await ctx.db.get(id);
    if (d && !d.inTrash && inScope(d, scope)) fileMatches.push(d);
  }

  const seen = new Set<string>();
  const ordered: Doc<"documents">[] = [];
  for (const d of [...byTitle, ...byText, ...tagMatches, ...fileMatches]) {
    if (seen.has(d._id)) continue;
    seen.add(d._id);
    ordered.push(d);
  }
  const out = [];
  const homes = new HomeFolders(ctx);
  for (const d of ordered) {
    if (folderId && d.folderId !== folderId) continue;
    if (creator && d.createdBy !== creator) continue;
    if (tagDocs && !tagDocs.has(d._id)) continue;
    if (args.updatedAfter && d.updatedAt < args.updatedAfter) continue;
    if (!args.includeArchived && d.archivedAt) continue;
    if (!accessAtLeast(await documentAccess(ctx, profile, d), "read")) continue;
    const body = d.searchText.slice(d.title.length + 1);
    // Found only in a file or drawing (not in the note's own text): the result says where, and opens there.
    const file = inFiles.get(d._id);
    const inFile = file && !highlightRanges(body, q).length ? file : null;
    const match: { source: FileTextSource; page: number | null; blockId: string } | null = inFile ? { source: inFile.source, page: inFile.page, blockId: inFile.blockId } : null;
    out.push({
      id: d.publicId,
      title: d.title,
      icon: d.icon ?? null,
      kind: d.kind,
      updatedAt: d.updatedAt,
      snippet: inFile ? inFile.snippet : searchSnippet(body, q, 70),
      match,
      archived: Boolean(d.archivedAt),
      homeFolder: await homes.of(d),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** At most this many places are searched at once ("All places"). */
const MAX_PLACES = 8;

/**
 * Search every place the person is in at once (⌘K, "All places"): their Personal and each workspace,
 * a few results from each, labelled with the place.
 */
export const everywhere = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const q = args.query.trim();
    if (!q) return [];
    const limit = Math.min(args.limit ?? 20, 40);
    const places: { id: string; name: string; scope: Scope }[] = [{ id: "personal", name: "Personal", scope: personalScope(profile._id) }];
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_profile", (x) => x.eq("profileId", profile._id))
      .take(MAX_PLACES);
    for (const m of memberships) {
      const w = await ctx.db.get(m.workspaceId);
      if (w && w.status !== "deleting" && places.length < MAX_PLACES) places.push({ id: w.publicId, name: w.name, scope: workspaceScope(w._id) });
    }
    const perPlace = Math.max(4, Math.ceil(limit / places.length) + 2);
    const out = [];
    for (const p of places) {
      for (const r of await searchDocuments(ctx, profile, p.scope, { query: q, limit: perPlace })) out.push({ ...r, place: { id: p.id, name: p.name } });
    }
    // Title matches first (as within one place), then the most recently edited.
    const lower = q.toLowerCase();
    out.sort((a, b) => Number(b.title.toLowerCase().includes(lower)) - Number(a.title.toLowerCase().includes(lower)) || b.updatedAt - a.updatedAt);
    return out.slice(0, limit);
  },
});

/** Whether this place has search by meaning (the plan includes the notes index). */
export const meaningAvailable = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    return await indexEligible(ctx, scope);
  },
});

export const limitMeaning = internalMutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    await consume(ctx, "searchMeaning", profile._id);
    return null;
  },
});

/**
 * Search by meaning (⌘K, Pro plans): notes about what was typed even when they don't use those words,
 * from the same index Foli AI answers with. Keyword matches come from `documents`; these are extra.
 */
export const byMeaning = action({
  args: { scope: vScopeArg, query: v.string() },
  handler: async (ctx, args): Promise<{ id: string; title: string; snippet: string }[]> => {
    // Signed in (checked here), then the person and their rate limit (limitMeaning), then scope access (hybridSearch).
    await requireIdentity(ctx);
    const q = args.query.trim().slice(0, 200);
    if (q.length < 3) return [];
    await ctx.runMutation(internal.search.limitMeaning, {});
    const notes = await hybridSearch(ctx, { scope: args.scope, question: q, queries: [q], limit: 8 });
    return notes.filter((n) => !n.recent).map((n) => ({ id: n.id, title: n.title, snippet: n.text.replace(/\s+/g, " ").trim().slice(0, 160) }));
  },
});
