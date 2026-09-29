import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { normalizeForSearch, searchSnippet } from "@folevi/editor-schema";
import { accessAtLeast, documentAccess, requireProfile, resolveScope } from "./lib/auth";
import { HomeFolders } from "./lib/documents";
import { inScope, vScopeArg } from "./lib/scope";

/**
 * Full-text search of one scope (your Personal, or a workspace you're in) over titles, text blocks (incl.
 * code, captions, table cells), attachment names and tag names, with filters. Only notes the person can
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

    const seen = new Set<string>();
    const ordered: Doc<"documents">[] = [];
    for (const d of [...byTitle, ...byText, ...tagMatches]) {
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
      out.push({
        id: d.publicId,
        title: d.title,
        icon: d.icon ?? null,
        kind: d.kind,
        updatedAt: d.updatedAt,
        snippet: searchSnippet(body, q, 70),
        archived: Boolean(d.archivedAt),
        homeFolder: await homes.of(d),
      });
      if (out.length >= limit) break;
    }
    return out;
  },
});
