// Semantic search's index (docs/AI_ASSISTANT.md, "Retrieval"): notes in eligible scopes (lib/ai/indexing.ts:
// paid Pro and Pro AI Personals and team workspaces) are split into chunks (lib/ai/retrieval.ts), embedded
// with Gemini, and kept in `aiChunks` for vector search.
//
//   indexDocument: one note, a little after it changed (lib/ai/indexing.ts queueIndex is the hook). Chunks
//                  whose hash didn't change keep their embedding; only new text is embedded. A trashed,
//                  deleted or out-of-plan note loses its chunks instead.
//   backfill:      every note of a scope that just became eligible, a page at a time.
//   removeScope:   every chunk of a scope that is no longer eligible.
//   sweep:         daily: starts backfills for paid plans the hook hasn't seen yet, and removes the chunks
//                  of scopes whose plan lapsed (or whose owner turned AI off).
//   hybridSearch:  keyword search plus vector search, merged and checked note by note (ai.gather).
//
// Embeddings are platform-paid: never charged to credits, rate-limited per account (`aiIndex`). Note text
// is never logged; only counts are.
import { v } from "convex/values";
import { flattenTree } from "@folevi/editor-schema";
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireProfile, resolveScope } from "./lib/auth";
import { liveBlocks, toWireBlock } from "./lib/documents";
import { sharedLabels } from "./lib/linkLabels";
import { consume } from "./lib/rateLimit";
import { personalEntitlementsOf, type WorkspacePlanId } from "./lib/plans";
import { insertScoped, personalScope, sameScope, scopeKey, scopeOfRow, vScope, vScopeArg, workspaceScope, type Scope, type ScopeArg } from "./lib/scope";
import { indexable, indexEligible, indexScopeRow, indexStateOf, planIndexes, queueIndex, startBackfill } from "./lib/ai/indexing";
import { chunkHash, chunkLines, embeddingText, lineOf, type ChunkLine } from "./lib/ai/retrieval";
import { provider } from "./lib/ai/provider";

/** An index job waits for this much quiet after the last edit… */
const QUIET_MS = 10_000;
/** …but never longer than this after the first. */
const MAX_WAIT_MS = 2 * 60_000;
/** Over the hourly embedding limit: try again after this. */
const RATE_RETRY_MS = 15 * 60_000;
/** A failed embedding call is retried this many times (backing off), then left for the next edit. */
const MAX_FAILURES = 3;
/** Notes looked at per backfill step, and the pause between steps (index jobs are spread across it). */
const BACKFILL_PAGE = 25;
const BACKFILL_STEP_MS = 60_000;
/** Rows deleted per removal step. */
const REMOVE_BATCH = 200;
/** Subscriptions or scopes the sweep reads per step. */
const SWEEP_PAGE = 100;

/** Removes up to `n` of a note's chunks. Returns how many were removed. */
async function dropChunks(ctx: MutationCtx, documentId: Id<"documents">, n = REMOVE_BATCH): Promise<number> {
  const rows = await ctx.db
    .query("aiChunks")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .take(n);
  for (const r of rows) await ctx.db.delete(r._id);
  return rows.length;
}

/** A note's chunks as they would be now: its live blocks in reading order, links labelled as everyone may see them. */
async function chunksOf(ctx: MutationCtx, doc: Doc<"documents">) {
  // The same labels as the note's search text: anyone who can open the note may see them.
  const blocks = await sharedLabels(ctx, doc, (await liveBlocks(ctx, doc._id)).map(toWireBlock));
  const lines = flattenTree(blocks)
    .map((e) => lineOf(e.block, e.depth))
    .filter((l): l is ChunkLine => l !== null);
  return chunkLines(lines);
}

const vChunk = v.object({ index: v.number(), text: v.string(), blockIds: v.array(v.string()), hash: v.string() });
type ChunkRow = { index: number; text: string; blockIds: string[]; hash: string };

/**
 * Writes a note's chunks: rows whose hash is still there keep their embedding (moved to their new place),
 * new ones get the embedding from `vectors` (or from an identical chunk), and the rest are deleted.
 */
async function writeChunks(ctx: MutationCtx, doc: Doc<"documents">, model: string, chunks: ChunkRow[], vectors: Map<string, number[]>): Promise<void> {
  const scope = scopeOfRow(doc);
  const now = Date.now();
  const existing = await ctx.db
    .query("aiChunks")
    .withIndex("by_document", (q) => q.eq("documentId", doc._id))
    .collect();
  const byHash = new Map<string, Doc<"aiChunks">[]>();
  for (const r of existing) {
    if (r.embeddingModel !== model || !sameScope(scopeOfRow(r), scope)) continue;
    byHash.set(r.contentHash, [...(byHash.get(r.contentHash) ?? []), r]);
    if (!vectors.has(r.contentHash)) vectors.set(r.contentHash, r.embedding);
  }
  const kept = new Set<Id<"aiChunks">>();
  for (const c of chunks) {
    const row = byHash.get(c.hash)?.shift();
    if (row) {
      kept.add(row._id);
      const moved = row.chunkIndex !== c.index || row.text !== c.text || row.blockIds.join(" ") !== c.blockIds.join(" ");
      if (moved) await ctx.db.patch(row._id, { chunkIndex: c.index, text: c.text, blockIds: c.blockIds });
      continue;
    }
    const embedding = vectors.get(c.hash);
    // Embedded for an older version that has since changed again: the next job fills it in.
    if (!embedding) continue;
    await insertScoped(ctx, "aiChunks", scope, { documentId: doc._id, chunkIndex: c.index, text: c.text, blockIds: c.blockIds, contentHash: c.hash, embedding, embeddingModel: model, indexedAt: now });
  }
  for (const r of existing) if (!kept.has(r._id)) await ctx.db.delete(r._id);
}

type Prepared =
  | { kind: "done" | "later" }
  | { kind: "embed"; contentSeq: number; model: string; chunks: ChunkRow[]; embed: { hash: string; text: string }[] };

/**
 * The first half of an index job: whether there's anything to do, and which chunks need embedding (after
 * the per-account embedding limit). Chunks needing no new embedding are written here and then.
 */
export const prepare = internalMutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args): Promise<Prepared> => {
    const now = Date.now();
    const doc = await ctx.db.get(args.documentId);
    const state = await indexStateOf(ctx, args.documentId);
    if (!doc) {
      if ((await dropChunks(ctx, args.documentId)) === REMOVE_BATCH) {
        await ctx.scheduler.runAfter(0, internal.aiIndex.indexDocument, { documentId: args.documentId });
        return { kind: "later" };
      }
      if (state) await ctx.db.delete(state._id);
      return { kind: "done" };
    }
    // Still being edited: wait for a pause (up to a limit), so a typing burst is embedded once.
    if (state?.queuedAt !== undefined && doc.updatedAt > now - QUIET_MS && state.queuedAt > now - MAX_WAIT_MS) {
      await ctx.db.patch(state._id, { dueAt: now + QUIET_MS });
      await ctx.scheduler.runAfter(QUIET_MS, internal.aiIndex.indexDocument, { documentId: doc._id });
      return { kind: "later" };
    }
    const scope = scopeOfRow(doc);
    const model = provider().embeddingModel();
    const settled = { dueAt: undefined, queuedAt: undefined };
    // Trashed, a template, or the plan no longer includes it: its chunks go.
    if (!indexable(doc) || !(await indexEligible(ctx, scope, now))) {
      if ((await dropChunks(ctx, doc._id)) === REMOVE_BATCH) {
        await ctx.scheduler.runAfter(0, internal.aiIndex.indexDocument, { documentId: doc._id });
        return { kind: "later" };
      }
      if (state) await ctx.db.patch(state._id, { ...settled, indexedContentSeq: -1, chunks: 0, failures: undefined });
      return { kind: "done" };
    }
    // AI isn't set up on this server: nothing can be embedded (the next edit after it is will index).
    if (!process.env.GEMINI_API_KEY) {
      if (state) await ctx.db.patch(state._id, settled);
      return { kind: "done" };
    }
    if (state && state.indexedContentSeq === doc.contentSeq && state.embeddingModel === model) {
      await ctx.db.patch(state._id, settled);
      return { kind: "done" };
    }
    const title = doc.title || "Untitled";
    const chunks: ChunkRow[] = [];
    for (const c of await chunksOf(ctx, doc)) chunks.push({ ...c, hash: await chunkHash(title, c, model) });
    const known = new Set<string>();
    for (const r of await ctx.db
      .query("aiChunks")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .collect()) {
      if (r.embeddingModel === model) known.add(r.contentHash);
    }
    const embed: { hash: string; text: string }[] = [];
    for (const c of chunks) {
      if (known.has(c.hash)) continue;
      known.add(c.hash);
      embed.push({ hash: c.hash, text: embeddingText(title, c) });
    }
    const stateId = state?._id ?? (await insertScoped(ctx, "aiIndexState", scope, { documentId: doc._id, indexedContentSeq: -1, chunks: 0 }));
    if (!embed.length) {
      await writeChunks(ctx, doc, model, chunks, new Map());
      await ctx.db.patch(stateId, { ...settled, indexedContentSeq: doc.contentSeq, chunks: chunks.length, embeddingModel: model, indexedAt: now, failures: undefined });
      return { kind: "done" };
    }
    try {
      await consume(ctx, "aiIndex", scopeKey(scope), embed.length);
    } catch {
      // Over this account's hourly embedding limit: later (the job stays the waiting one).
      await ctx.db.patch(stateId, { dueAt: now + RATE_RETRY_MS, queuedAt: undefined });
      await ctx.scheduler.runAfter(RATE_RETRY_MS, internal.aiIndex.indexDocument, { documentId: doc._id });
      return { kind: "later" };
    }
    // Edits from now on schedule a new job; this one finishes with what it read.
    await ctx.db.patch(stateId, settled);
    return { kind: "embed", contentSeq: doc.contentSeq, model, chunks, embed };
  },
});

/** The second half: writes the chunks with their new embeddings (unless the note was trashed meanwhile). */
export const store = internalMutation({
  args: { documentId: v.id("documents"), contentSeq: v.number(), model: v.string(), chunks: v.array(vChunk), vectors: v.array(v.object({ hash: v.string(), embedding: v.array(v.float64()) })) },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc || !indexable(doc)) return null;
    await writeChunks(ctx, doc, args.model, args.chunks, new Map(args.vectors.map((x) => [x.hash, x.embedding])));
    const state = await indexStateOf(ctx, doc._id);
    const done = { indexedContentSeq: args.contentSeq, chunks: args.chunks.length, embeddingModel: args.model, indexedAt: Date.now(), failures: undefined };
    if (state) await ctx.db.patch(state._id, done);
    else await insertScoped(ctx, "aiIndexState", scopeOfRow(doc), { documentId: doc._id, ...done });
    return null;
  },
});

/** An embedding call failed: retried a few times with growing pauses, then left for the next edit. */
export const failed = internalMutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const state = await indexStateOf(ctx, args.documentId);
    if (!state || state.dueAt !== undefined) return null;
    const failures = (state.failures ?? 0) + 1;
    if (failures > MAX_FAILURES) {
      await ctx.db.patch(state._id, { failures: 0 });
      return null;
    }
    const delay = 5 * 60_000 * 2 ** (failures - 1);
    await ctx.db.patch(state._id, { failures, dueAt: Date.now() + delay });
    await ctx.scheduler.runAfter(delay, internal.aiIndex.indexDocument, { documentId: args.documentId });
    return null;
  },
});

/** Indexes one note (scheduled by queueIndex, a backfill, or a retry). */
export const indexDocument = internalAction({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args): Promise<string> => {
    const job = await ctx.runMutation(internal.aiIndex.prepare, { documentId: args.documentId });
    if (job.kind !== "embed") {
      // The knowledge graph follows the index (convex/aiGraph.ts reads the note only if its text changed,
      // and removes its part of the graph when the chunks went).
      if (job.kind === "done") await ctx.scheduler.runAfter(0, internal.aiGraph.extract, { documentId: args.documentId });
      return job.kind;
    }
    let vectors: number[][];
    try {
      vectors = (await provider().embed(job.embed.map((e) => e.text), "document")).vectors;
    } catch {
      console.warn(JSON.stringify({ event: "ai.index_failed", chunks: job.embed.length }));
      await ctx.runMutation(internal.aiIndex.failed, { documentId: args.documentId });
      return "failed";
    }
    await ctx.runMutation(internal.aiIndex.store, {
      documentId: args.documentId,
      contentSeq: job.contentSeq,
      model: job.model,
      chunks: job.chunks,
      vectors: job.embed.map((e, i) => ({ hash: e.hash, embedding: vectors[i]! })),
    });
    console.log(JSON.stringify({ event: "ai.indexed", chunks: job.chunks.length, embedded: job.embed.length }));
    await ctx.scheduler.runAfter(0, internal.aiGraph.extract, { documentId: args.documentId });
    return "indexed";
  },
});

/** One step of a scope's backfill: queues index jobs for a page of its notes, spread over the next minute. */
export const backfill = internalMutation({
  args: { scope: vScope },
  handler: async (ctx, args) => {
    const scope = args.scope as Scope;
    const row = await indexScopeRow(ctx, scope);
    if (!row || row.status !== "backfilling") return null;
    const now = Date.now();
    if (!(await indexEligible(ctx, scope, now))) {
      await ctx.db.patch(row._id, { status: "off", cursor: null, updatedAt: now });
      return null;
    }
    const page = await (
      scope.kind === "personal"
        ? ctx.db.query("documents").withIndex("by_owner_created", (q) => q.eq("ownerProfileId", scope.profileId))
        : ctx.db.query("documents").withIndex("by_workspace_created", (q) => q.eq("workspaceId", scope.workspaceId))
    ).paginate({ cursor: row.cursor ?? null, numItems: BACKFILL_PAGE });
    let queued = 0;
    for (const doc of page.page) {
      if (!indexable(doc)) continue;
      const state = await indexStateOf(ctx, doc._id);
      if (state && state.indexedContentSeq === doc.contentSeq) continue;
      await queueIndex(ctx, doc, { eligible: true, delayMs: Math.round((queued++ * BACKFILL_STEP_MS) / BACKFILL_PAGE) });
    }
    if (page.isDone) {
      await ctx.db.patch(row._id, { status: "ready", cursor: null, updatedAt: now });
      return null;
    }
    await ctx.db.patch(row._id, { cursor: page.continueCursor, updatedAt: now });
    await ctx.scheduler.runAfter(queued ? BACKFILL_STEP_MS : 0, internal.aiIndex.backfill, { scope });
    return null;
  },
});

/** Internal entry point: (re)indexes every note of one scope, if its plan includes semantic search. */
export const backfillScope = internalMutation({
  args: { scope: vScope },
  handler: async (ctx, args): Promise<boolean> => {
    const scope = args.scope as Scope;
    if (!(await indexEligible(ctx, scope))) return false;
    await startBackfill(ctx, scope, true);
    return true;
  },
});

/** One step of removing a scope's chunks (its plan no longer includes semantic search). */
export const removeScope = internalMutation({
  args: { scope: vScope },
  handler: async (ctx, args) => {
    const scope = args.scope as Scope;
    const row = await indexScopeRow(ctx, scope);
    if (!row || row.status !== "removing") return null;
    // The knowledge graph (convex/aiGraph.ts) follows the same plan rule, so it goes too.
    for (const table of ["aiChunks", "aiIndexState", "aiEntities", "aiMentions", "aiRelations", "aiGraphState"] as const) {
      const rows = await (
        scope.kind === "personal"
          ? ctx.db.query(table).withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
          : ctx.db.query(table).withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
      ).take(REMOVE_BATCH);
      for (const r of rows) await ctx.db.delete(r._id);
      if (rows.length) {
        await ctx.scheduler.runAfter(0, internal.aiIndex.removeScope, { scope });
        return null;
      }
    }
    await ctx.db.patch(row._id, { status: "off", cursor: null, updatedAt: Date.now() });
    return null;
  },
});

/** Starts removing a scope's chunks. */
async function startRemoval(ctx: MutationCtx, row: Doc<"aiIndexScopes">): Promise<void> {
  await ctx.db.patch(row._id, { status: "removing", cursor: null, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.aiIndex.removeScope, { scope: scopeOfRow(row) });
}

/** The plans whose subscriptions the sweep reads (Pro and Pro AI, Personal and workspace). */
const SWEEP_BUCKETS: ({ personal: "pro" | "pro_ai" } | { workspace: WorkspacePlanId })[] = [
  { personal: "pro" },
  { personal: "pro_ai" },
  ...(["workspace_pro_monthly", "workspace_pro_yearly", "workspace_pro_ai_monthly", "workspace_pro_ai_yearly"] as const).map((id) => ({ workspace: id })),
];

/**
 * Daily, in steps: first every Pro and Pro AI subscription (a scope whose plan includes semantic search
 * but hasn't been backfilled starts now), then every indexed scope (one whose plan lapsed, or whose owner
 * turned AI off, loses its chunks; a backfill that stalled starts again).
 */
export const sweep = internalMutation({
  args: { bucket: v.optional(v.number()), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const bucket = args.bucket ?? 0;
    const next = async (b: number, cursor: string | null) => void (await ctx.scheduler.runAfter(0, internal.aiIndex.sweep, { bucket: b, cursor }));
    const which = SWEEP_BUCKETS[bucket];
    if (which) {
      const page = await ("personal" in which
        ? ctx.db.query("subscriptions").withIndex("by_plan", (q) => q.eq("plan", which.personal))
        : ctx.db.query("subscriptions").withIndex("by_owner_type_plan_provider_period", (q) => q.eq("ownerType", "workspace").eq("planId", which.workspace))
      ).paginate({ cursor: args.cursor ?? null, numItems: SWEEP_PAGE });
      for (const sub of page.page) {
        const scope = sub.profileId && sub.ownerType !== "workspace" ? personalScope(sub.profileId) : sub.workspaceId ? workspaceScope(sub.workspaceId) : null;
        if (!scope) continue;
        // A Personal plan in effect is checked from the row in hand first (most lapsed ones stop here).
        if (scope.kind === "personal" && !(sub.plan && planIndexes(personalEntitlementsOf({ ...sub, plan: sub.plan }, now)))) continue;
        const row = await indexScopeRow(ctx, scope);
        if (row && row.status !== "off") continue;
        if (await indexEligible(ctx, scope, now)) await startBackfill(ctx, scope);
      }
      await next(page.isDone ? bucket + 1 : bucket, page.isDone ? null : page.continueCursor);
      return null;
    }
    // Then the scopes that are indexed (or being indexed), least recently checked first.
    const status = bucket === SWEEP_BUCKETS.length ? "ready" : "backfilling";
    const rows = await ctx.db
      .query("aiIndexScopes")
      .withIndex("by_status", (q) => q.eq("status", status).lt("checkedAt", now - 60 * 60_000))
      .take(SWEEP_PAGE);
    for (const row of rows) {
      const scope = scopeOfRow(row);
      if (!(await indexEligible(ctx, scope, now))) {
        await startRemoval(ctx, row);
        continue;
      }
      await ctx.db.patch(row._id, { checkedAt: now });
      // A backfill that hasn't moved for an hour lost its next step: pick it up again.
      if (row.status === "backfilling" && row.updatedAt < now - 60 * 60_000) await ctx.scheduler.runAfter(0, internal.aiIndex.backfill, { scope });
    }
    if (rows.length === SWEEP_PAGE) await next(bucket, null);
    else if (status === "ready") await next(bucket + 1, null);
    return null;
  },
});

/**
 * Where vector search may look for this person in `scope`: the scope itself when its plan includes
 * semantic search, otherwise null (keyword search only). `start` says the scope was never indexed.
 */
export const searchScope = internalQuery({
  args: { scope: vScopeArg },
  handler: async (ctx, args): Promise<{ scope: Scope; start: boolean } | null> => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    if (!(await indexEligible(ctx, scope))) return null;
    const row = await indexScopeRow(ctx, scope);
    return { scope, start: !row || row.status === "off" || row.status === "removing" };
  },
});

/** Starts indexing a scope the person searches in, when its plan includes it and it never was. */
export const ensureIndexed = internalMutation({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    if (await indexEligible(ctx, scope)) await startBackfill(ctx, scope);
    return null;
  },
});

/** Vector matches asked for per search (they're merged with keyword matches and checked note by note). */
const VECTOR_LIMIT = 40;

export interface SearchInput {
  scope: ScopeArg;
  /** The question as asked (embedded for vector search). */
  question: string;
  /** Keyword queries for the full-text index. */
  queries: string[];
  exclude?: string;
  limit: number;
  folderId?: string;
}

/**
 * Hybrid search over the person's notes in `scope`: the full-text index plus, where the plan includes it,
 * vector search over chunks, merged with reciprocal rank fusion and checked note by note in ai.gather
 * (access, Trash, folder). If embedding the question fails, keyword search answers alone.
 */
export async function hybridSearch(ctx: ActionCtx, input: SearchInput) {
  const target = await ctx.runQuery(internal.aiIndex.searchScope, { scope: input.scope });
  let hits: { chunkId: Id<"aiChunks">; score: number }[] = [];
  if (target) {
    if (target.start) await ctx.runMutation(internal.aiIndex.ensureIndexed, { scope: input.scope });
    try {
      // The keyword queries carry what the conversation was about, which a short follow-up may not.
      const text = `${input.question}\n${input.queries.join(", ")}`.slice(0, 2_000);
      const [vector] = (await provider().embed([text], "query")).vectors;
      const s = target.scope;
      const found = await ctx.vectorSearch("aiChunks", "by_embedding", {
        vector: vector!,
        limit: VECTOR_LIMIT,
        filter: (q) => (s.kind === "personal" ? q.eq("ownerProfileId", s.profileId) : q.eq("workspaceId", s.workspaceId)),
      });
      hits = found.map((r) => ({ chunkId: r._id, score: r._score }));
    } catch {
      console.warn(JSON.stringify({ event: "ai.vector_search_failed" }));
    }
  }
  return await ctx.runQuery(internal.ai.gather, { scope: input.scope, queries: input.queries, exclude: input.exclude, limit: input.limit, folderId: input.folderId, hits });
}

/** For tests and admins: a note's index state and chunks (no embeddings). */
export const inspect = internalQuery({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const state = await indexStateOf(ctx, args.documentId);
    const chunks = await ctx.db
      .query("aiChunks")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    return {
      state: state ? { indexedContentSeq: state.indexedContentSeq, chunks: state.chunks, queued: state.dueAt !== undefined } : null,
      chunks: chunks.map((c) => ({ id: c._id, chunkIndex: c.chunkIndex, text: c.text, blockIds: c.blockIds, contentHash: c.contentHash, indexedAt: c.indexedAt })),
    };
  },
});
