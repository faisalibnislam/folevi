// search.* in local mode (convex/search.ts) over the library's own index (lib/local/search): titles, the
// notes' text (code, captions, table cells, synced content shown in them), tag names and the words found in
// their PDFs, images and handwriting (functions/fileText.ts). Results come in the server's order: title
// matches, then text matches (each best first, by BM25 with prefix matching), then notes with a matching tag,
// then notes found only in a file, which say where (`match`: "In PDF, page 3", "In image", "In handwriting").
// Snippets and highlights use the server's helpers (packages/editor-schema search.ts).
//
// The library is one place (Personal), and its one person can read every note, so nothing is filtered by
// access. Search by meaning is a server feature (search.byMeaning is hidden; meaningAvailable says no).
import { highlightRanges, normalizeForSearch, searchSnippet, type FileTextSource } from "@folevi/editor-schema";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@/lib/convex/api";
import { defineLocal, type LocalQueryCtx } from "../registry";
import type { LocalDocument } from "../store";
import { fileTextHits } from "./fileText";
import { checkScope, HomeFolders, placeOf, requireProfile, type LocalProfile } from "./shared";

type SearchArgs = Omit<FunctionArgs<typeof api.search.documents>, "scope">;
type SearchResult = FunctionReturnType<typeof api.search.documents>[number];

/** Best first; equal scores in the order the notes were made (as the server's index returns them). */
function ranked(scores: Map<string, number>, byId: Map<string, LocalDocument>, take: number): LocalDocument[] {
  return [...scores]
    .flatMap(([id, score]) => {
      const d = byId.get(id);
      return d && !d.inTrash ? [{ d, score }] : [];
    })
    .sort((a, b) => b.score - a.score || a.d.createdAt - b.d.createdAt || a.d.ordinal - b.d.ordinal)
    .slice(0, take)
    .map((x) => x.d);
}

/** The search itself (convex/search.ts searchDocuments), for the library's one person. */
async function searchDocuments(ctx: LocalQueryCtx, profile: LocalProfile, args: SearchArgs): Promise<SearchResult[]> {
  const q = args.query.trim().slice(0, 200);
  if (!q) return [];
  const limit = Math.min(args.limit ?? 30, 50);
  if (args.folderId) {
    const f = await ctx.db.get("folders", args.folderId);
    if (!f || f.deletedAt !== null) return [];
  }
  let tagDocs: Set<string> | null = null;
  const docs = await ctx.db.list("documents");
  if (args.tagId) {
    const tag = (await ctx.db.list("tags")).find((t) => t.id === args.tagId);
    if (!tag) return [];
    tagDocs = new Set(docs.filter((d) => d.tagIds.includes(tag.id)).map((d) => d.id));
  }
  const index = await ctx.searchIndex();
  index.syncNotes(docs);
  const byId = new Map(docs.map((d) => [d.id, d]));

  const byText = ranked(index.notes.search(q, ["text"]), byId, 100);
  const byTitle = ranked(index.notes.search(q, ["title"]), byId, 30);

  // Tag-name matches: notes carrying a tag whose name contains the query (the first five tags, made first).
  const tagMatches: LocalDocument[] = [];
  const nq = normalizeForSearch(q);
  const tags = (await ctx.db.list("tags")).sort((a, b) => a.createdAt - b.createdAt || (a.ordinal ?? 0) - (b.ordinal ?? 0)).slice(0, 500);
  const inCreationOrder = [...docs].sort((a, b) => a.createdAt - b.createdAt || a.ordinal - b.ordinal);
  for (const t of tags.filter((t) => t.normalizedName.includes(nq)).slice(0, 5)) {
    for (const d of inCreationOrder.filter((d) => d.tagIds.includes(t.id)).slice(0, 20)) if (!d.inTrash) tagMatches.push(d);
  }

  // Words in the notes' PDFs, images and handwriting, with their own index.
  const inFiles = await fileTextHits(ctx, q);
  const fileMatches: LocalDocument[] = [];
  for (const id of inFiles.keys()) {
    const d = byId.get(id);
    if (d && !d.inTrash) fileMatches.push(d);
  }

  const seen = new Set<string>();
  const ordered: LocalDocument[] = [];
  for (const d of [...byTitle, ...byText, ...tagMatches, ...fileMatches]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    ordered.push(d);
  }
  // A creator filter names a person: here there's one, so it keeps everything or nothing.
  if (args.creatorId && args.creatorId !== profile.id) return [];
  const out: SearchResult[] = [];
  const homes = new HomeFolders(ctx.db);
  for (const d of ordered) {
    if (args.folderId && d.folderId !== args.folderId) continue;
    if (tagDocs && !tagDocs.has(d.id)) continue;
    if (args.updatedAfter && d.updatedAt < args.updatedAfter) continue;
    if (!args.includeArchived && d.archivedAt) continue;
    const body = d.searchText.slice(d.title.length + 1);
    // Found only in a file or drawing (not in the note's own text): the result says where, and opens there.
    const file = inFiles.get(d.id);
    const inFile = file && !highlightRanges(body, q).length ? file : null;
    const match: { source: FileTextSource; page: number | null; blockId: string } | null = inFile ? { source: inFile.source, page: inFile.page, blockId: inFile.blockId } : null;
    out.push({
      id: d.id,
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

defineLocal(api.search.documents, "query", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  checkScope(args.scope);
  const { scope: _scope, ...rest } = args;
  void _scope;
  return await searchDocuments(ctx, profile, rest);
});

/** ⌘K's "All places": the library is one place, Personal. */
defineLocal(api.search.everywhere, "query", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  const q = args.query.trim();
  if (!q) return [];
  const limit = Math.min(args.limit ?? 20, 40);
  const perPlace = Math.max(4, limit + 2);
  const { id, name } = await placeOf(ctx.db);
  const place = { id, name };
  const out = (await searchDocuments(ctx, profile, { query: q, limit: perPlace })).map((r) => ({ ...r, place }));
  // Title matches first (as within one place), then the most recently edited.
  const lower = q.toLowerCase();
  out.sort((a, b) => Number(b.title.toLowerCase().includes(lower)) - Number(a.title.toLowerCase().includes(lower)) || b.updatedAt - a.updatedAt);
  return out.slice(0, limit);
});

/** Search by meaning needs the server's index of the notes: never in local mode. */
defineLocal(api.search.meaningAvailable, "query", async (ctx, args) => {
  await requireProfile(ctx);
  checkScope(args.scope);
  return false;
});
