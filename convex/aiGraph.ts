// The knowledge graph (docs/AI_ASSISTANT.md, "Knowledge graph", milestone 7). Derived from notes, never a
// source of truth, and only for scopes whose plan includes semantic search (lib/ai/indexing.ts: paid Pro,
// Pro AI and team workspaces on them).
//
//   extract:            after a note's index job (convex/aiIndex.ts), reads the note again if its text
//                       changed: entities and relations from the fast model (JSON), "similar" notes from its
//                       chunks' embeddings. Platform-paid like embeddings: never charged to credits,
//                       rate-limited per account (`aiGraph`). A trashed, deleted or out-of-plan note loses
//                       its part of the graph instead.
//   sweep:              daily, reads notes that were indexed before the graph existed.
//   related, duplicates, contradictions, missingConnections, graph: what people see. Every note is checked
//                       with the person's own access (PageReader / documentAccess), whatever the rows say.
//
// Explicit links stay in `documentLinks` and are read from there; only inferred relations are stored. Note
// text is never logged; only counts are.
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { accessAtLeast, documentAccess, getDocumentByPublicId, PageReader, requireProfile, resolveScope } from "./lib/auth";
import { consume } from "./lib/rateLimit";
import { hasValidScope, inScope, scopeKey, scopeOfRow, vScope, vScopeArg, type Scope } from "./lib/scope";
import { indexable, indexEligible } from "./lib/ai/indexing";
import { capabilities, provider } from "./lib/ai/provider";
import {
  capLines,
  CONTEXT_CHARS,
  CONTEXT_LINES,
  CONTEXT_NOTES,
  ENTITY_KINDS,
  GRAPH_SYSTEM,
  graphHash,
  graphPrompt,
  likelyDuplicate,
  DUPLICATE_MIN,
  noteSimilarity,
  parseExtraction,
  RELATION_KINDS,
  sharedReason,
  SIMILAR_MIN,
  type ContextNote,
  type EntityKind,
  type GraphLine,
  type StoredRelationKind,
  textKey,
} from "./lib/ai/graph";
import { blockText, dropNoteGraph, graphStateOf, noteLines, writeNoteGraph } from "./lib/ai/graphStore";

/** Over the hourly extraction limit: try again after this. */
const RATE_RETRY_MS = 15 * 60_000;
/** Rows deleted per removal step. */
const REMOVE_BATCH = 200;
/** A note's chunks that look for similar notes, and the matches each one asks for. */
const QUERY_CHUNKS = 4;
const CHUNK_HITS = 16;
/** "Similar" relations kept per note. */
const SIMILAR_KEPT = 6;
/** Index rows the sweep reads per step, and the pause between steps (extractions are spread across it). */
const SWEEP_PAGE = 50;
const SWEEP_STEP_MS = 60_000;

/** What people see where the plan doesn't include the graph (explicit links still show). */
export const PRO_NOTE = "The full graph, with topics, people and similar notes, is part of Pro.";
export const AI_OFF_NOTE = "AI is off, so only links show here.";

const vEntityKind = v.union(...ENTITY_KINDS.map((k) => v.literal(k)));
const vRelationKind = v.union(...RELATION_KINDS.map((k) => v.literal(k)));

type Prepared =
  | { kind: "done" | "later" | "unchanged" }
  | { kind: "extract"; scope: Scope; title: string; hash: string; lines: GraphLine[]; vectors: number[][] };

/** Removes a note's part of the graph, a batch at a time. True when it's all gone. */
async function dropAll(ctx: Parameters<typeof dropNoteGraph>[0], documentId: Id<"documents">): Promise<boolean> {
  if ((await dropNoteGraph(ctx, documentId, REMOVE_BATCH)) < REMOVE_BATCH) return true;
  await ctx.scheduler.runAfter(0, internal.aiGraph.extract, { documentId });
  return false;
}

/**
 * The first half of an extraction: whether the note should be read at all (eligible, changed since it was
 * last read, under the account's limit), and what to read: its lines and a few of its chunks' embeddings.
 */
export const prepareExtract = internalMutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args): Promise<Prepared> => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc || !hasValidScope(doc)) return { kind: (await dropAll(ctx, args.documentId)) ? "done" : "later" };
    const scope = scopeOfRow(doc);
    if (!indexable(doc) || !(await indexEligible(ctx, scope))) return { kind: (await dropAll(ctx, doc._id)) ? "done" : "later" };
    // AI isn't set up on this server (or the fast model can't answer in JSON): nothing to read with.
    if (!process.env.GEMINI_API_KEY || !capabilities(true).json) return { kind: "done" };
    const title = doc.title || "Untitled";
    const lines = capLines(await noteLines(ctx, doc));
    const hash = await graphHash(title, lines);
    if ((await graphStateOf(ctx, doc._id))?.contentHash === hash) return { kind: "unchanged" };
    if (!lines.length) {
      await writeNoteGraph(ctx, doc, { entities: [], relations: [], links: [], similar: [] }, hash);
      return { kind: "done" };
    }
    try {
      await consume(ctx, "aiGraph", scopeKey(scope));
    } catch {
      await ctx.scheduler.runAfter(RATE_RETRY_MS, internal.aiGraph.extract, { documentId: doc._id });
      return { kind: "later" };
    }
    const chunks = await ctx.db
      .query("aiChunks")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .take(QUERY_CHUNKS);
    return { kind: "extract", scope, title, hash, lines, vectors: chunks.map((c) => c.embedding) };
  },
});

/**
 * The notes closest to one note, from its chunks' vector matches: "similar" ones (note-level score at least
 * SIMILAR_MIN), and the closest few with the lines that matched, shown to the model as context.
 */
export const neighbours = internalQuery({
  args: { documentId: v.id("documents"), scope: vScope, queries: v.number(), hits: v.array(v.object({ query: v.number(), chunkId: v.id("aiChunks"), score: v.number() })) },
  handler: async (ctx, args): Promise<{ similar: { documentId: Id<"documents">; score: number }[]; context: ContextNote[] }> => {
    const scope = args.scope as Scope;
    const chunks = new Map<string, Doc<"aiChunks"> | null>();
    const hits: { query: number; documentId: string; score: number; chunkId: Id<"aiChunks"> }[] = [];
    for (const h of args.hits) {
      if (!chunks.has(h.chunkId)) chunks.set(h.chunkId, await ctx.db.get(h.chunkId));
      const c = chunks.get(h.chunkId);
      if (c && inScope(c, scope)) hits.push({ query: h.query, documentId: c.documentId, score: h.score, chunkId: c._id });
    }
    const similar: { documentId: Id<"documents">; score: number }[] = [];
    const context: ContextNote[] = [];
    for (const s of noteSimilarity(hits, args.queries, args.documentId)) {
      if (s.score < SIMILAR_MIN || similar.length >= SIMILAR_KEPT) break;
      const doc = await ctx.db.get(s.documentId as Id<"documents">);
      if (!doc || !indexable(doc) || !inScope(doc, scope)) continue;
      similar.push({ documentId: doc._id, score: s.score });
      if (context.length >= CONTEXT_NOTES) continue;
      // The lines of its best-matching chunk.
      const best = hits.filter((h) => h.documentId === doc._id).sort((a, b) => b.score - a.score)[0];
      const chunk = best ? chunks.get(best.chunkId) : null;
      const lines: GraphLine[] = [];
      let used = 0;
      for (const blockId of chunk?.blockIds ?? []) {
        if (lines.length >= CONTEXT_LINES || used >= CONTEXT_CHARS) break;
        const whole = await blockText(ctx, doc._id, blockId);
        if (!whole) continue;
        const text = whole.slice(0, CONTEXT_CHARS - used);
        lines.push({ blockId, text, key: textKey(whole) });
        used += text.length;
      }
      if (lines.length) context.push({ documentId: doc._id, title: doc.title || "Untitled", lines });
    }
    return { similar, context };
  },
});

/** The second half: writes what was found (unless the note was trashed or left the plan meanwhile). */
export const storeExtract = internalMutation({
  args: {
    documentId: v.id("documents"),
    hash: v.string(),
    entities: v.array(v.object({ name: v.string(), normalized: v.string(), kind: vEntityKind, blockIds: v.array(v.string()) })),
    relations: v.array(v.object({ kind: vRelationKind, from: v.string(), to: v.string(), blockId: v.optional(v.string()) })),
    links: v.array(v.object({ kind: vRelationKind, toDocumentId: v.string(), blockId: v.string(), targetBlockId: v.string(), sourceKey: v.string(), targetKey: v.string(), reason: v.optional(v.string()) })),
    similar: v.array(v.object({ documentId: v.id("documents"), score: v.number() })),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc || !hasValidScope(doc) || !indexable(doc) || !(await indexEligible(ctx, scopeOfRow(doc)))) return null;
    await writeNoteGraph(ctx, doc, { entities: args.entities, relations: args.relations, links: args.links, similar: args.similar }, args.hash);
    return null;
  },
});

/** Reads one note into the graph (scheduled after its index job, by the sweep, or a retry). */
export const extract = internalAction({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args): Promise<string> => {
    const job = await ctx.runMutation(internal.aiGraph.prepareExtract, { documentId: args.documentId });
    if (job.kind !== "extract") return job.kind;
    let near: { similar: { documentId: Id<"documents">; score: number }[]; context: ContextNote[] } = { similar: [], context: [] };
    if (job.vectors.length) {
      const s = job.scope;
      const hits: { query: number; chunkId: Id<"aiChunks">; score: number }[] = [];
      for (const [i, vector] of job.vectors.entries()) {
        const found = await ctx.vectorSearch("aiChunks", "by_embedding", {
          vector,
          limit: CHUNK_HITS,
          filter: (q) => (s.kind === "personal" ? q.eq("ownerProfileId", s.profileId) : q.eq("workspaceId", s.workspaceId)),
        });
        hits.push(...found.map((r) => ({ query: i, chunkId: r._id, score: r._score })));
      }
      near = await ctx.runQuery(internal.aiGraph.neighbours, { documentId: args.documentId, scope: s, queries: job.vectors.length, hits });
    }
    let raw: string;
    try {
      // Platform-paid: the usage is logged by the adapter and never charged to anyone's credits.
      raw = (await provider().generate({ system: GRAPH_SYSTEM, prompt: graphPrompt(job.title, job.lines, near.context), fast: true, json: true, temperature: 0.1, maxOutputTokens: 4_096 }, [])).text;
    } catch {
      // Left for the next edit (or the sweep): the hash isn't stored, so it's read again then.
      console.warn(JSON.stringify({ event: "ai.graph_failed", lines: job.lines.length }));
      return "failed";
    }
    const found = parseExtraction(raw, job.lines, near.context);
    await ctx.runMutation(internal.aiGraph.storeExtract, { documentId: args.documentId, hash: job.hash, ...found, similar: near.similar });
    console.log(JSON.stringify({ event: "ai.graph", entities: found.entities.length, relations: found.relations.length + found.links.length, similar: near.similar.length }));
    return "extracted";
  },
});

/**
 * Daily, in steps: notes that are indexed but were never read into the graph (indexed before it existed,
 * or a read that failed) are read now, spread over the next minute. Each extraction checks the plan again.
 */
export const sweep = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("aiIndexState").paginate({ cursor: args.cursor ?? null, numItems: SWEEP_PAGE });
    let queued = 0;
    for (const row of page.page) {
      if (row.chunks <= 0 || row.dueAt !== undefined) continue;
      if (await graphStateOf(ctx, row.documentId)) continue;
      await ctx.scheduler.runAfter(Math.round((queued++ * SWEEP_STEP_MS) / SWEEP_PAGE), internal.aiGraph.extract, { documentId: row.documentId });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(queued ? SWEEP_STEP_MS : 0, internal.aiGraph.sweep, { cursor: page.continueCursor });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------------
// What people see
// ---------------------------------------------------------------------------------------------------

/** Whether the inferred graph shows for this person in `scope`: the plan includes it and their AI is on. */
async function fullGraph(ctx: QueryCtx, profile: Doc<"profiles">, scope: Scope): Promise<{ full: boolean; note: string | null }> {
  if (!(await indexEligible(ctx, scope))) return { full: false, note: PRO_NOTE };
  if (profile.aiEnabled === false) return { full: false, note: AI_OFF_NOTE };
  return { full: true, note: null };
}

/** A note that may be shown: live, not a template, and one the person can open. */
async function openable(reader: PageReader, doc: Doc<"documents">): Promise<boolean> {
  return !doc.inTrash && doc.deletedAt === undefined && doc.kind !== "template" && (await reader.canOpen(doc));
}

/** The note asked about, when the person can read it, with a reader for the notes around it. */
async function noteFor(ctx: QueryCtx, profile: Doc<"profiles">, documentId: string) {
  const doc = await getDocumentByPublicId(ctx, documentId);
  if (!doc || !hasValidScope(doc) || doc.deletedAt !== undefined) return null;
  if (!accessAtLeast(await documentAccess(ctx, profile, doc), "read")) return null;
  const scope = scopeOfRow(doc);
  const reader = await PageReader.forScope(ctx, profile, scope);
  return { profile, doc, scope, reader, ...(await fullGraph(ctx, profile, scope)) };
}

type NoteRef = { id: string; title: string; icon: string | null };
const refOf = (d: Doc<"documents">): NoteRef => ({ id: d.publicId, title: d.title, icon: d.icon ?? null });

/** The notes this one links to and the ones linking here (explicit `[[` links). */
async function linkedNotes(ctx: QueryCtx, doc: Doc<"documents">): Promise<Map<Id<"documents">, { out: boolean; in: boolean; doc: Doc<"documents"> }>> {
  const out = new Map<Id<"documents">, { out: boolean; in: boolean; doc: Doc<"documents"> }>();
  const targets = new Set<string>();
  for (const l of await ctx.db
    .query("documentLinks")
    .withIndex("by_source", (q) => q.eq("sourceDocumentId", doc._id))
    .take(200))
    targets.add(l.targetPublicId);
  for (const publicId of [...targets].slice(0, 100)) {
    const t = await getDocumentByPublicId(ctx, publicId);
    if (t && t._id !== doc._id) out.set(t._id, { out: true, in: false, doc: t });
  }
  for (const l of await ctx.db
    .query("documentLinks")
    .withIndex("by_target", (q) => q.eq("targetPublicId", doc.publicId))
    .take(200)) {
    if (l.sourceDocumentId === doc._id) continue;
    const known = out.get(l.sourceDocumentId);
    if (known) known.in = true;
    else {
      const s = await ctx.db.get(l.sourceDocumentId);
      if (s) out.set(s._id, { out: false, in: true, doc: s });
    }
  }
  return out;
}

/** Other notes that mention this note's entities, with the names they share. */
async function sharedEntityNotes(ctx: QueryCtx, doc: Doc<"documents">): Promise<Map<Id<"documents">, string[]>> {
  const out = new Map<Id<"documents">, string[]>();
  const mentions = await ctx.db
    .query("aiMentions")
    .withIndex("by_document", (q) => q.eq("documentId", doc._id))
    .take(40);
  for (const m of mentions) {
    const entity = await ctx.db.get(m.entityId);
    if (!entity) continue;
    for (const o of await ctx.db
      .query("aiMentions")
      .withIndex("by_entity", (q) => q.eq("entityId", m.entityId))
      .take(60)) {
      if (o.documentId === doc._id) continue;
      out.set(o.documentId, [...(out.get(o.documentId) ?? []), entity.name]);
    }
  }
  return out;
}

/** Relations found in this note or pointing at it, note to note. */
async function noteRelations(ctx: QueryCtx, doc: Doc<"documents">): Promise<Doc<"aiRelations">[]> {
  const from = await ctx.db
    .query("aiRelations")
    .withIndex("by_source", (q) => q.eq("sourceDocumentId", doc._id))
    .take(150);
  const to = await ctx.db
    .query("aiRelations")
    .withIndex("by_to_document", (q) => q.eq("toDocumentId", doc._id))
    .take(150);
  return [...from, ...to].filter((r) => r.toDocumentId !== undefined);
}

const otherEnd = (r: Doc<"aiRelations">, self: Id<"documents">) => (r.sourceDocumentId === self ? r.toDocumentId! : r.sourceDocumentId);

/** Related notes shown per note, at most. */
const RELATED_LIMIT = 12;

/**
 * Notes related to one note, best first, each with its reasons ("Links here", "Both mention Project
 * Atlas", "Similar content"): explicit links for everyone, shared entities, similar content and inferred
 * relations where the plan includes the graph. Only notes the person can open.
 */
export const related = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const at = await noteFor(ctx, await requireProfile(ctx), args.documentId);
    if (!at) return { full: false, note: null, items: [] };
    const { doc, reader } = at;
    const found = new Map<Id<"documents">, { score: number; reasons: string[]; linked: boolean }>();
    const add = (id: Id<"documents">, score: number, reason: string, linked = false) => {
      const cur = found.get(id) ?? { score: 0, reasons: [], linked: false };
      cur.score += score;
      if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
      cur.linked ||= linked;
      found.set(id, cur);
    };
    for (const [id, l] of await linkedNotes(ctx, doc)) add(id, 3, l.out && l.in ? "Linked both ways" : l.out ? "Linked in this note" : "Links here", true);
    if (at.full) {
      for (const [id, names] of await sharedEntityNotes(ctx, doc)) add(id, Math.min(3, names.length), sharedReason([...new Set(names)]));
      for (const r of await noteRelations(ctx, doc)) {
        const other = otherEnd(r, doc._id);
        if (r.kind === "similar") add(other, 2 * (r.score ?? 0), "Similar content");
        else if (r.kind === "references" || r.kind === "related") add(other, 1, r.reason ?? (r.kind === "references" ? "Refers to the same thing" : "On the same subject"));
      }
    }
    const ranked = [...found.entries()].sort(([, a], [, b]) => b.score - a.score);
    const items: (NoteRef & { reasons: string[]; linked: boolean })[] = [];
    for (const [id, f] of ranked) {
      if (items.length >= RELATED_LIMIT) break;
      if (id === doc._id) continue;
      const d = await ctx.db.get(id);
      if (!d || !(await openable(reader, d))) continue;
      items.push({ ...refOf(d), reasons: f.reasons.slice(0, 3), linked: f.linked });
    }
    return { full: at.full, note: at.note, items };
  },
});

/** Duplicate pairs shown at most. */
const DUPLICATES_LIMIT = 50;

/**
 * Likely duplicates: notes whose content is nearly the same (embeddings) and whose titles are alike. For
 * one note (`documentId`) or a whole scope. Both notes of a pair must be ones the person can open.
 */
export const duplicates = query({
  args: { documentId: v.optional(v.string()), scope: v.optional(vScopeArg) },
  handler: async (ctx, args) => {
    let rows: Doc<"aiRelations">[];
    let reader: PageReader;
    let state: { full: boolean; note: string | null };
    if (args.documentId) {
      const at = await noteFor(ctx, await requireProfile(ctx), args.documentId);
      if (!at) return { full: false, note: null, items: [] };
      if (!at.full) return { full: false, note: at.note, items: [] };
      reader = at.reader;
      state = at;
      rows = (await noteRelations(ctx, at.doc)).filter((r) => r.kind === "similar");
    } else if (args.scope) {
      const profile = await requireProfile(ctx);
      const { scope } = await resolveScope(ctx, profile, args.scope);
      state = await fullGraph(ctx, profile, scope);
      if (!state.full) return { ...state, items: [] };
      reader = await PageReader.forScope(ctx, profile, scope);
      rows = await (
        scope.kind === "personal"
          ? ctx.db.query("aiRelations").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId).eq("kind", "similar").gte("score", DUPLICATE_MIN))
          : ctx.db.query("aiRelations").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId).eq("kind", "similar").gte("score", DUPLICATE_MIN))
      )
        .order("desc")
        .take(400);
    } else return { full: false, note: null, items: [] };
    const seen = new Set<string>();
    const items: { a: NoteRef; b: NoteRef; score: number }[] = [];
    for (const r of rows.sort((x, y) => (y.score ?? 0) - (x.score ?? 0))) {
      if (items.length >= DUPLICATES_LIMIT) break;
      const score = r.score ?? 0;
      if (score < DUPLICATE_MIN || !r.toDocumentId) continue;
      const key = [r.sourceDocumentId, r.toDocumentId].sort().join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      const [a, b] = [await ctx.db.get(r.sourceDocumentId), await ctx.db.get(r.toDocumentId)];
      if (!a || !b || !(await openable(reader, a)) || !(await openable(reader, b))) continue;
      if (!likelyDuplicate(score, a.title, b.title)) continue;
      // For one note, it comes first.
      const first = args.documentId && b.publicId === args.documentId ? [b, a] : [a, b];
      items.push({ a: refOf(first[0]!), b: refOf(first[1]!), score: Math.round(score * 100) / 100 });
    }
    return { full: state.full, note: state.note, items };
  },
});

/** Contradictions shown at most, and the length of each quote. */
const QUOTE_CHARS = 280;
const CONTRADICTIONS_LIMIT = 50;

/**
 * Lines that contradict (or supersede) lines in other notes, each side quoted as it reads now. For one note
 * or a whole scope. A relation whose block is gone, or whose other note the person can't open, isn't shown.
 */
export const contradictions = query({
  args: { documentId: v.optional(v.string()), scope: v.optional(vScopeArg) },
  handler: async (ctx, args) => {
    let rows: Doc<"aiRelations">[];
    let reader: PageReader;
    let state: { full: boolean; note: string | null };
    if (args.documentId) {
      const at = await noteFor(ctx, await requireProfile(ctx), args.documentId);
      if (!at) return { full: false, note: null, items: [] };
      if (!at.full) return { full: false, note: at.note, items: [] };
      reader = at.reader;
      state = at;
      rows = await noteRelations(ctx, at.doc);
    } else if (args.scope) {
      const profile = await requireProfile(ctx);
      const { scope } = await resolveScope(ctx, profile, args.scope);
      state = await fullGraph(ctx, profile, scope);
      if (!state.full) return { ...state, items: [] };
      reader = await PageReader.forScope(ctx, profile, scope);
      rows = [];
      for (const kind of ["contradicts", "supersedes"] as const) {
        rows.push(
          ...(await (
            scope.kind === "personal"
              ? ctx.db.query("aiRelations").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId).eq("kind", kind))
              : ctx.db.query("aiRelations").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId).eq("kind", kind))
          ).take(200)),
        );
      }
    } else return { full: false, note: null, items: [] };
    const seen = new Set<string>();
    const items: { kind: "contradicts" | "supersedes"; from: NoteRef & { blockId: string; quote: string }; to: NoteRef & { blockId: string; quote: string }; reason: string | null }[] = [];
    for (const r of rows) {
      if (items.length >= CONTRADICTIONS_LIMIT) break;
      if ((r.kind !== "contradicts" && r.kind !== "supersedes") || !r.toDocumentId || !r.sourceBlockId || !r.targetBlockId) continue;
      const key = r.kind === "contradicts" ? `c:${[`${r.sourceDocumentId}/${r.sourceBlockId}`, `${r.toDocumentId}/${r.targetBlockId}`].sort().join(":")}` : `s:${r.sourceDocumentId}/${r.sourceBlockId}:${r.toDocumentId}/${r.targetBlockId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [a, b] = [await ctx.db.get(r.sourceDocumentId), await ctx.db.get(r.toDocumentId)];
      if (!a || !b || !(await openable(reader, a)) || !(await openable(reader, b))) continue;
      const [qa, qb] = [await blockText(ctx, a._id, r.sourceBlockId), await blockText(ctx, b._id, r.targetBlockId)];
      // Either line was edited (or deleted) since: it may not hold any more.
      if (!qa || !qb || (r.sourceKey && textKey(qa) !== r.sourceKey) || (r.targetKey && textKey(qb) !== r.targetKey)) continue;
      items.push({ kind: r.kind, from: { ...refOf(a), blockId: r.sourceBlockId, quote: qa.slice(0, QUOTE_CHARS) }, to: { ...refOf(b), blockId: r.targetBlockId, quote: qb.slice(0, QUOTE_CHARS) }, reason: r.reason ?? null });
    }
    return { full: state.full, note: state.note, items };
  },
});

/** Notes that mention the same people, projects or topics as this one but aren't linked to it either way. */
export const missingConnections = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const at = await noteFor(ctx, await requireProfile(ctx), args.documentId);
    if (!at) return { full: false, note: null, items: [] };
    if (!at.full) return { full: false, note: at.note, items: [] };
    const linked = await linkedNotes(ctx, at.doc);
    const shared = [...(await sharedEntityNotes(ctx, at.doc)).entries()]
      .filter(([id]) => !linked.has(id) && id !== at.doc._id)
      .map(([id, names]) => [id, [...new Set(names)]] as const)
      .sort(([, a], [, b]) => b.length - a.length);
    const items: (NoteRef & { entities: string[]; reason: string })[] = [];
    for (const [id, names] of shared) {
      if (items.length >= 10) break;
      const d = await ctx.db.get(id);
      if (!d || !(await openable(at.reader, d))) continue;
      items.push({ ...refOf(d), entities: names.slice(0, 5), reason: sharedReason(names) });
    }
    return { full: true, note: null, items };
  },
});

// ---------------------------------------------------------------------------------------------------
// The graph view
// ---------------------------------------------------------------------------------------------------

/** What the graph view gets at most (the view stays readable and the payload small). */
export const GRAPH_LIMITS = { notes: 300, entities: 150, edges: 1_500, noteScan: 600, linkScan: 2_000, mentionScan: 3_000, relationScan: 2_000 } as const;

export type GraphNodeKind = "note" | EntityKind;
export type GraphEdgeKind = "link" | "mention" | StoredRelationKind;

/**
 * The scope's graph for the graph view: notes the person can open (most recently edited first), the
 * explicit links between them, and where the plan includes it, the entities those notes mention (filtered
 * by `kinds`) and inferred relations. Capped (GRAPH_LIMITS); `truncated` says something was left out.
 */
export const graph = query({
  args: { scope: vScopeArg, kinds: v.optional(v.array(vEntityKind)) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const reader = await PageReader.forScope(ctx, profile, scope);
    const { full, note } = await fullGraph(ctx, profile, scope);
    let truncated = false;

    const nodes: { id: string; kind: GraphNodeKind; label: string; icon: string | null }[] = [];
    const edges: { source: string; target: string; kind: GraphEdgeKind; inferred: boolean }[] = [];
    const edgeKeys = new Set<string>();
    const addEdge = (source: string, target: string, kind: GraphEdgeKind, inferred: boolean) => {
      if (source === target) return;
      const key = kind === "mention" || kind === "supersedes" ? `${kind}:${source}:${target}` : `${kind}:${[source, target].sort().join(":")}`;
      if (edgeKeys.has(key)) return;
      if (edges.length >= GRAPH_LIMITS.edges) {
        truncated = true;
        return;
      }
      edgeKeys.add(key);
      edges.push({ source, target, kind, inferred });
    };

    // Notes.
    const recent = await (
      scope.kind === "personal"
        ? ctx.db.query("documents").withIndex("by_owner_trash", (q) => q.eq("ownerProfileId", scope.profileId).eq("inTrash", false))
        : ctx.db.query("documents").withIndex("by_workspace_trash", (q) => q.eq("workspaceId", scope.workspaceId).eq("inTrash", false))
    )
      .order("desc")
      .take(GRAPH_LIMITS.noteScan);
    if (recent.length === GRAPH_LIMITS.noteScan) truncated = true;
    const byId = new Map<Id<"documents">, Doc<"documents">>();
    const byPublic = new Map<string, Doc<"documents">>();
    for (const d of recent) {
      if (d.kind === "collectionRow" || !(await openable(reader, d))) continue;
      if (byId.size >= GRAPH_LIMITS.notes) {
        truncated = true;
        break;
      }
      byId.set(d._id, d);
      byPublic.set(d.publicId, d);
      nodes.push({ id: d.publicId, kind: "note", label: d.title || "Untitled", icon: d.icon ?? null });
    }

    // Explicit links (never stored twice: read from documentLinks).
    const links = await (
      scope.kind === "personal"
        ? ctx.db.query("documentLinks").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
        : ctx.db.query("documentLinks").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
    ).take(GRAPH_LIMITS.linkScan);
    for (const l of links) {
      const s = byId.get(l.sourceDocumentId);
      const t = byPublic.get(l.targetPublicId);
      if (s && t) addEdge(s.publicId, t.publicId, "link", false);
    }

    if (full) {
      const kinds = new Set<string>(args.kinds ?? ENTITY_KINDS);
      // Entities mentioned in the notes shown, most mentioned first.
      const mentions = await (
        scope.kind === "personal"
          ? ctx.db.query("aiMentions").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
          : ctx.db.query("aiMentions").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
      ).take(GRAPH_LIMITS.mentionScan);
      if (mentions.length === GRAPH_LIMITS.mentionScan) truncated = true;
      const notesOf = new Map<Id<"aiEntities">, Id<"documents">[]>();
      for (const m of mentions) if (byId.has(m.documentId)) notesOf.set(m.entityId, [...(notesOf.get(m.entityId) ?? []), m.documentId]);
      const entityKey = new Map<Id<"aiEntities">, string>();
      for (const [entityId, docs] of [...notesOf.entries()].sort(([, a], [, b]) => b.length - a.length)) {
        const e = await ctx.db.get(entityId);
        if (!e || !inScope(e, scope) || !kinds.has(e.kind)) continue;
        if (entityKey.size >= GRAPH_LIMITS.entities) {
          truncated = true;
          break;
        }
        const id = `e:${e.normalized}`;
        entityKey.set(entityId, id);
        nodes.push({ id, kind: e.kind, label: e.name, icon: null });
        for (const d of docs) addEdge(id, byId.get(d)!.publicId, "mention", true);
      }
      // Inferred relations between notes shown, and between entities shown.
      const relations = await (
        scope.kind === "personal"
          ? ctx.db.query("aiRelations").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
          : ctx.db.query("aiRelations").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
      ).take(GRAPH_LIMITS.relationScan);
      for (const r of relations) {
        if (r.toDocumentId) {
          const s = byId.get(r.sourceDocumentId);
          const t = byId.get(r.toDocumentId);
          if (s && t && (r.kind !== "similar" || (r.score ?? 0) >= SIMILAR_MIN)) addEdge(s.publicId, t.publicId, r.kind, true);
        } else if (r.fromEntityId && r.toEntityId) {
          const s = entityKey.get(r.fromEntityId);
          const t = entityKey.get(r.toEntityId);
          // Only from a note the person can open (the relation was read there).
          if (s && t && byId.has(r.sourceDocumentId)) addEdge(s, t, r.kind, true);
        }
      }
    }
    // `upgrade`: the plan is why (not the person's AI switch), so the view can point at plans.
    return { full, note, upgrade: note === PRO_NOTE, nodes, edges, truncated };
  },
});

/** For tests and admins: a note's part of the graph (names, kinds, blocks; no note text). */
export const inspect = internalQuery({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const state = await graphStateOf(ctx, args.documentId);
    const mentions = await ctx.db
      .query("aiMentions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    const entities = [];
    for (const m of mentions) {
      const e = await ctx.db.get(m.entityId);
      if (e) entities.push({ name: e.name, kind: e.kind, blockIds: m.blockIds });
    }
    const relations = await ctx.db
      .query("aiRelations")
      .withIndex("by_source", (q) => q.eq("sourceDocumentId", args.documentId))
      .collect();
    return {
      state: state ? { contentHash: state.contentHash, entities: state.entities } : null,
      entities,
      relations: relations.map((r) => ({ kind: r.kind, inferred: r.inferred, sourceBlockId: r.sourceBlockId ?? null, toDocumentId: r.toDocumentId ?? null, targetBlockId: r.targetBlockId ?? null, score: r.score ?? null, entityRelation: Boolean(r.fromEntityId) })),
    };
  },
});
