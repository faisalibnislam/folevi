// Retrieval (convex/aiIndex.ts, convex/lib/ai/retrieval.ts, docs/AI_ASSISTANT.md milestone 2): chunking,
// indexing on edit with hash reuse, plan eligibility, permission filtering, removal on Trash and on a lapsed
// plan, backfill, and hybrid ranking. Gemini (answers and embeddings) is a stubbed `fetch`; embeddings are a
// small fake: one dimension per topic word family, so "close" means "about the same topic".
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SCHEMA_VERSION, rankSequence, type WireBlock } from "@folevi/editor-schema";
import { chunkLines, dedupePassages, estimateTokens, fitToBudget, lineOf, reciprocalRankFusion, splitLong, type ChunkLine } from "../../convex/lib/ai/retrieval";
import { planIndexes } from "../../convex/lib/ai/indexing";
import { personalEntitlementsOf, workspaceEntitlementsOf } from "../../convex/lib/plans";
import { passageBlock } from "../../convex/lib/ai/chat";
import { inWorkspace, join, person, PERSONAL, setup, teamWorkspace, ulid, type ScopeArg, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.GEMINI_API_KEY;
});

// ---------------------------------------------------------------------------------------------------
// The fake provider
// ---------------------------------------------------------------------------------------------------

const TOPICS = [
  ["nebula", "quasar", "telescope", "galaxy", "orbit", "stars"],
  ["quokka", "wombat", "platypus", "echidna", "marsupial"],
  ["merger", "codename", "acquisition", "takeover"],
];

/** One dimension per topic, plus a small constant one so no vector is zero. */
function fakeVector(text: string): number[] {
  const v = new Array<number>(768).fill(0);
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  TOPICS.forEach((family, i) => {
    for (const w of words) if (family.includes(w)) v[i]! += 1;
  });
  v[767] = 0.2;
  return v;
}

const USAGE = { promptTokenCount: 2_000, candidatesTokenCount: 100 };
const reply = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: USAGE }), { status: 200 });
const streamed = (text: string) => new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: USAGE })}\r\n\r\n`, { status: 200 });

/** Stubs Gemini: embeddings (recorded), the search terms, the streamed answer and a chat title. */
function stubAi(o: { answer?: string; queries?: string[] } = {}) {
  process.env.GEMINI_API_KEY = "test-key";
  const log = { embedded: [] as string[], queries: [] as string[], prompts: [] as string[] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      if (url.includes(":batchEmbedContents")) {
        const body = JSON.parse(init.body) as { requests: { model: string; taskType: string; outputDimensionality: number; content: { parts: { text: string }[] } }[] };
        for (const r of body.requests) {
          expect(r.model).toBe("models/gemini-embedding-001");
          expect(r.outputDimensionality).toBe(768);
          (r.taskType === "RETRIEVAL_QUERY" ? log.queries : log.embedded).push(r.content.parts[0]!.text);
        }
        return new Response(JSON.stringify({ embeddings: body.requests.map((r) => ({ values: fakeVector(r.content.parts[0]!.text) })) }), { status: 200 });
      }
      if (init.body.includes("Answer questions using the person's notes")) {
        log.prompts.push(init.body);
        const answer = o.answer ?? "From your notes [1].";
        return url.includes("streamGenerateContent") ? streamed(answer) : reply(answer);
      }
      if (init.body.includes("full-text search queries")) return reply(JSON.stringify({ queries: o.queries ?? ["qqqqq"], act: false }));
      if (init.body.includes("You name conversations")) return reply("A title");
      return reply("{}");
    }),
  );
  return log;
}

// ---------------------------------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------------------------------

const block = (type: string, text: string, rank: string, props: Record<string, unknown> = {}): WireBlock => ({
  id: ulid(),
  type,
  parentId: null,
  rank,
  schemaVersion: SCHEMA_VERSION,
  text: [{ type: "text", text }],
  props,
});

/** Blocks from short specs: "# Heading" lines are headings, the rest paragraphs. */
function blocksOf(lines: string[]): WireBlock[] {
  const ranks = rankSequence(lines.length);
  return lines.map((l, i) => (l.startsWith("# ") ? block("heading", l.slice(2), ranks[i]!, { level: 2 }) : block("paragraph", l, ranks[i]!)));
}

const upsert = (documentId: string, b: WireBlock, baseRevision: number | null = null) => ({ opId: ulid(), kind: "block.upsert", documentId, block: b, baseRevision, fields: ["content", "position"] });

/** Writes a note through sync (the way the editor does). Returns its public id and blocks. */
async function writeNote(p: Person, scope: ScopeArg, title: string, lines: string[]) {
  const id = ulid();
  const blocks = blocksOf(lines);
  await p.as.mutation(api.sync.push, {
    scope,
    deviceId: "device-retrieval",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }, ...blocks.map((b) => upsert(id, b))] as never,
  });
  return { id, blocks };
}

async function docId(t: T, publicId: string): Promise<Id<"documents">> {
  return await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!._id);
}

const inspect = async (t: T, publicId: string) => await t.query(internal.aiIndex.inspect, { documentId: await docId(t, publicId) });

/** Runs every scheduled job (index jobs, backfills) to the end. */
const drain = async (t: T) => await t.finishAllScheduledFunctions(vi.runAllTimers);

const chunkCount = async (t: T) => await t.run(async (ctx) => (await ctx.db.query("aiChunks").collect()).length);

/** A paragraph of about `n` characters about a topic word. */
const filler = (word: string, n: number, salt = "") => `${salt}${`The ${word} entry continues here with plain words. `.repeat(Math.ceil(n / 50))}`.slice(0, n);

async function pro(t: T, email: string, plan: "pro" | "pro_ai" = "pro") {
  const p = await person(t, email);
  await p.as.mutation(api.billing.testPurchase, { plan, interval: "month" });
  return p;
}

// ---------------------------------------------------------------------------------------------------

describe("retrieval helpers", () => {
  const line = (blockId: string, text: string, type = "paragraph", level?: number): ChunkLine => ({ blockId, type, text, level, depth: 0 });

  test("chunks follow headings and blocks, keep their block ids, and carry their section's heading", () => {
    const lines = [line("h1", "Plans", "heading", 1), line("p1", "a".repeat(600)), line("p2", "b".repeat(600)), line("h2", "Budget", "heading", 2), line("p3", "c".repeat(300))];
    const chunks = chunkLines(lines);
    expect(chunks.map((c) => c.blockIds)).toEqual([["h1", "p1"], ["p2"], ["h2", "p3"]]);
    // A continuation starts with the heading it belongs to (for context), without claiming its block.
    expect(chunks[1]!.text.startsWith("# Plans\n")).toBe(true);
    expect(chunks[2]!.text).toMatch(/^## Budget\nc+$/);
    expect(chunks.every((c, i) => c.index === i && c.text.length <= 1_500)).toBe(true);
    // A tiny intro stays with the next section rather than being a chunk of its own.
    expect(chunkLines([line("p0", "Intro."), line("h1", "Plans", "heading", 1), line("p1", "Body.")]).map((c) => c.blockIds)).toEqual([["p0", "h1", "p1"]]);
  });

  test("a long block is split at sentences, every piece keeping the block's id", () => {
    const long = "This sentence is about forty characters. ".repeat(80);
    const pieces = splitLong(long);
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces.every((p) => p.length <= 1_500 && p.endsWith("."))).toBe(true);
    const chunks = chunkLines([line("big", long.trim())]);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.blockIds.length === 1 && c.blockIds[0] === "big")).toBe(true);
    // Blocks without text are skipped; lists and to-dos read as Markdown.
    expect(lineOf({ id: "x", type: "divider", text: [], props: {} }, 0)).toBeNull();
    const todo = lineOf({ id: "t", type: "todo", text: [{ type: "text", text: "Call Sam" }], props: { checked: false } }, 1)!;
    expect(chunkLines([todo])[0]!.text).toBe("  - [ ] Call Sam");
  });

  test("reciprocal rank fusion favours what both lists agree on, then the first list", () => {
    expect(reciprocalRankFusion([["a", "b", "c"], ["c", "d", "a"]])).toEqual(["a", "c", "b", "d"]);
    expect(reciprocalRankFusion([["k1", "k2"], []])).toEqual(["k1", "k2"]);
    expect(reciprocalRankFusion([[], ["v1"]])).toEqual(["v1"]);
    // Repeats in one list count once.
    expect(reciprocalRankFusion([["a", "a", "b"], ["b"]])).toEqual(["b", "a"]);
  });

  test("passages are deduplicated and fitted to a token budget, best first", () => {
    const items = [{ text: "x ".repeat(1000) }, { text: "Same words here" }, { text: "same, WORDS here!" }, { text: "y ".repeat(1000) }];
    expect(dedupePassages(items).length).toBe(3);
    const fitted = fitToBudget(dedupePassages(items), 700, 600);
    expect(fitted.length).toBe(3);
    expect(estimateTokens(fitted[0]!.text)).toBeLessThanOrEqual(601);
    expect(fitted.reduce((n, i) => n + estimateTokens(i.text), 0)).toBeLessThanOrEqual(702);
    expect(fitToBudget(items, 0)).toEqual([]);
  });

  test("only paid Pro and Pro AI plans are indexed (never Free, the trial or Core)", () => {
    const now = Date.now();
    const sub = (plan: "free" | "core" | "pro" | "pro_ai", extra = {}) => ({ plan, interval: "month" as const, status: "active" as const, ...extra });
    expect(planIndexes(personalEntitlementsOf(sub("pro"), now))).toBe(true);
    expect(planIndexes(personalEntitlementsOf(sub("pro_ai"), now))).toBe(true);
    expect(planIndexes(personalEntitlementsOf(sub("core"), now))).toBe(false);
    expect(planIndexes(personalEntitlementsOf(sub("free"), now))).toBe(false);
    expect(planIndexes(personalEntitlementsOf(sub("free", { trialEndsAt: now + 86_400_000 }), now))).toBe(false);
    expect(planIndexes(personalEntitlementsOf(null, now))).toBe(false);
    const ws = (tier: "core" | "pro" | "pro_ai") => workspaceEntitlementsOf({ tier, interval: "month", status: "active" }, {}, now);
    expect([planIndexes(ws("pro")), planIndexes(ws("pro_ai")), planIndexes(ws("core")), planIndexes(workspaceEntitlementsOf(null, {}, now))]).toEqual([true, true, false, false]);
  });

  test("a citation from passages points at one of their blocks", () => {
    const blocks = [
      { id: "b1", text: "Pack a rain jacket" },
      { id: "b2", text: "Book the ferry for Friday morning" },
      { id: "b3", text: "The ferry is cheaper on Friday" },
    ];
    // The overlap guess would pick b2; the passage only had b3.
    expect(passageBlock(blocks, ["b3"], "Book the ferry for Friday morning")!.blockId).toBe("b3");
    expect(passageBlock(blocks, ["b1", "b2"], "nothing alike")).toEqual({ blockId: "b1", quote: "Pack a rain jacket" });
    expect(passageBlock(blocks, ["gone"], "anything")).toBeNull();
  });
});

describe("indexing", () => {
  test("an edit indexes the note a little later; unchanged chunks keep their embedding", async () => {
    const t = setup();
    const log = stubAi();
    const a = await pro(t, "index-edit@example.com");
    const note = await writeNote(a, PERSONAL, "Observatory", ["# Telescope", filler("telescope", 900), "# Galaxy", filler("galaxy", 900)]);
    // Queued, not done yet: the job waits for a pause in the editing, and more edits don't queue more jobs.
    expect((await inspect(t, note.id)).state).toMatchObject({ queued: true, chunks: 0 });
    const retitled = { ...note.blocks[0]!, text: [{ type: "text" as const, text: "Telescopes" }] };
    await a.as.mutation(api.sync.push, { scope: PERSONAL, deviceId: "device-retrieval", ops: [upsert(note.id, retitled, 1)] as never });
    note.blocks[0] = { ...retitled, revision: 2 };
    const jobs = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((j) => j.name.includes("indexDocument") && j.state.kind === "pending").length);
    expect(jobs).toBe(1);
    await drain(t);
    const first = await inspect(t, note.id);
    expect(first.state).toMatchObject({ queued: false, chunks: 2 });
    expect(first.chunks.map((c) => c.blockIds)).toEqual([
      [note.blocks[0]!.id, note.blocks[1]!.id],
      [note.blocks[2]!.id, note.blocks[3]!.id],
    ]);
    // Embedded with the note's title (and the seeded notes too: the first edit started the backfill).
    expect(log.embedded.filter((x) => x.startsWith("Observatory\n"))).toHaveLength(2);
    const seeded = await t.run(async (ctx) => (await ctx.db.query("aiIndexScopes").collect()).map((r) => r.status));
    expect(seeded).toEqual(["ready"]);

    // Changing the second section re-embeds only its chunk; the first keeps its row and vector.
    const before = log.embedded.length;
    const changed = { ...note.blocks[3]!, text: [{ type: "text" as const, text: filler("galaxy", 900, "Updated: ") }] };
    await a.as.mutation(api.sync.push, { scope: PERSONAL, deviceId: "device-retrieval", ops: [upsert(note.id, changed, 1)] as never });
    await drain(t);
    const second = await inspect(t, note.id);
    expect(log.embedded.length - before).toBe(1);
    expect(second.chunks[0]!.id).toBe(first.chunks[0]!.id);
    expect(second.chunks[0]!.contentHash).toBe(first.chunks[0]!.contentHash);
    expect(second.chunks[1]!.contentHash).not.toBe(first.chunks[1]!.contentHash);
    expect(second.chunks[1]!.text).toContain("Updated:");
    // Nothing changed: nothing is embedded again.
    const n = log.embedded.length;
    await t.mutation(internal.aiIndex.backfillScope, { scope: { kind: "personal", profileId: a.profileId as Id<"profiles"> } });
    await drain(t);
    expect(log.embedded.length).toBe(n);
  });

  test("Free, the trial and Core are never indexed, and nothing is sent to embed", async () => {
    const t = setup();
    const log = stubAi();
    const trial = await person(t, "index-trial@example.com");
    const core = await person(t, "index-core@example.com");
    await core.as.mutation(api.billing.testPurchase, { plan: "core", interval: "month" });
    const free = await person(t, "index-free@example.com");
    await t.mutation(internal.testSupport.endTrial, { email: "index-free@example.com" });
    for (const p of [trial, core, free]) {
      const note = await writeNote(p, PERSONAL, "Stars", [filler("nebula", 400)]);
      expect((await inspect(t, note.id)).state).toBeNull();
      expect(await t.mutation(internal.aiIndex.backfillScope, { scope: { kind: "personal", profileId: p.profileId as Id<"profiles"> } })).toBe(false);
    }
    // A free workspace and a Core one aren't either.
    const freeTeam = await teamWorkspace(trial, "Free team");
    await writeNote(trial, freeTeam.scope, "Stars", [filler("nebula", 400)]);
    const coreTeam = await teamWorkspace(trial, "Core team");
    await trial.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: coreTeam.workspaceId, planId: "workspace_core_monthly" });
    await writeNote(trial, coreTeam.scope, "Stars", [filler("nebula", 400)]);
    await t.mutation(internal.aiIndex.sweep, {});
    await drain(t);
    expect(await chunkCount(t)).toBe(0);
    expect(log.embedded).toEqual([]);
    expect(await t.run(async (ctx) => (await ctx.db.query("aiIndexScopes").collect()).length)).toBe(0);
    // Asking there uses keyword search only: the question is never embedded.
    await trial.as.action(api.ai.ask, { scope: PERSONAL, question: "What about the nebula?" });
    expect(log.queries).toEqual([]);
  });

  test("a trashed note loses its chunks, a restored one gets them back, a deleted one never keeps them", async () => {
    const t = setup();
    stubAi();
    const a = await pro(t, "index-trash@example.com", "pro_ai");
    const note = await writeNote(a, PERSONAL, "Animals", [filler("wombat", 500)]);
    await drain(t);
    expect((await inspect(t, note.id)).chunks).toHaveLength(1);
    await a.as.mutation(api.documents.moveToTrash, { documentId: note.id });
    await drain(t);
    expect((await inspect(t, note.id)).chunks).toHaveLength(0);
    await a.as.mutation(api.documents.restoreFromTrash, { documentId: note.id });
    await drain(t);
    expect((await inspect(t, note.id)).chunks).toHaveLength(1);
    // Deleted for good: the purge removes chunks and bookkeeping with the note.
    await a.as.mutation(api.documents.moveToTrash, { documentId: note.id });
    const id = await docId(t, note.id);
    await t.run(async (ctx) => {
      // Back in Trash with chunks still there (as if the job hadn't run yet), then purged.
      await ctx.db.patch(id, { deletedAt: Date.now() - 40 * 86_400_000 });
    });
    await t.mutation(internal.maintenance.purgeExpiredTrash, {});
    await t.mutation(internal.maintenance.runDeletionJobs, {});
    await drain(t);
    expect(await t.run(async (ctx) => await ctx.db.get(id))).toBeNull();
    expect(await t.run(async (ctx) => (await ctx.db.query("aiChunks").withIndex("by_document", (q) => q.eq("documentId", id)).collect()).length)).toBe(0);
    expect(await t.run(async (ctx) => (await ctx.db.query("aiIndexState").withIndex("by_document", (q) => q.eq("documentId", id)).collect()).length)).toBe(0);
  });

  test("backfill indexes an account when it becomes eligible; a lapsed plan loses its chunks", async () => {
    const t = setup();
    const log = stubAi();
    const a = await person(t, "index-backfill@example.com");
    const space = await writeNote(a, PERSONAL, "Space", [filler("quasar", 400)]);
    await drain(t);
    expect(await chunkCount(t)).toBe(0);
    // They buy Pro: the daily sweep finds the plan and backfills every note (the seeded ones too).
    await a.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "year" });
    await t.mutation(internal.aiIndex.sweep, {});
    await drain(t);
    const notes = await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_owner_trash", (q) => q.eq("ownerProfileId", a.profileId as Id<"profiles">).eq("inTrash", false)).collect()).filter((d) => d.kind !== "template" && d.blockCount > 0));
    expect(notes.length).toBeGreaterThan(3);
    const indexed = new Set(await t.run(async (ctx) => (await ctx.db.query("aiChunks").collect()).map((c) => c.documentId)));
    for (const d of notes) expect(indexed.has(d._id)).toBe(true);
    expect((await inspect(t, space.id)).chunks).toHaveLength(1);
    expect(log.embedded.length).toBeGreaterThan(3);

    // The plan lapses: the sweep removes the chunks.
    await t.run(async (ctx) => {
      const sub = await ctx.db.query("subscriptions").withIndex("by_profile", (q) => q.eq("profileId", a.profileId as Id<"profiles">)).unique();
      await ctx.db.patch(sub!._id, { status: "canceled", currentPeriodEnd: Date.now() - 1 });
    });
    vi.advanceTimersByTime(2 * 60 * 60_000);
    await t.mutation(internal.aiIndex.sweep, {});
    await drain(t);
    expect(await chunkCount(t)).toBe(0);
    expect(await t.run(async (ctx) => (await ctx.db.query("aiIndexScopes").collect()).map((r) => r.status))).toEqual(["off"]);
  });
});

describe("hybrid search", () => {
  test("semantic matches are found without shared keywords, ranked with keyword ones, cited at their blocks", async () => {
    const t = setup();
    const a = await pro(t, "search-hybrid@example.com", "pro_ai");
    stubAi();
    const space = await writeNote(a, PERSONAL, "Night sky", ["# Gear", filler("telescope", 300), "# Seen", filler("galaxy", 300)]);
    await writeNote(a, PERSONAL, "Zoo trip", [filler("wombat", 400)]);
    await drain(t);
    expect((await inspect(t, space.id)).chunks.length).toBeGreaterThan(0);

    // Keyword search finds nothing ("qqqqq"), the vector half finds the note about space.
    const log = stubAi({ queries: ["qqqqq"], answer: "You looked at a galaxy [1]." });
    const out = await a.as.action(api.ai.ask, { scope: PERSONAL, question: "What did I see through the telescope? Any nebula or galaxy?" });
    expect(log.queries).toHaveLength(1);
    expect(out.sources.map((s) => s.title)).toEqual(["Night sky"]);
    expect(log.prompts[0]).toContain("galaxy entry");
    expect(log.prompts[0]).not.toContain("wombat entry");

    // Keyword and vector agree on one note: it comes first, ahead of keyword-only matches.
    const both = stubAi({ queries: ["wombat", "trip"], answer: "Wombats [1]." });
    await a.as.action(api.ai.ask, { scope: PERSONAL, question: "Tell me about the wombat and the platypus" });
    const prompt = JSON.parse(both.prompts[0]!) as { contents: { parts: { text: string }[] }[] };
    const sent = prompt.contents.at(-1)!.parts[0]!.text;
    expect(sent).toContain("[1] Zoo trip");

    // In a chat, the citation points at a block of the passage that was the source.
    stubAi({ queries: ["qqqqq"], answer: "You saw a galaxy [1]." });
    const conversationId = ulid();
    const sent2 = await a.as.action(api.aiChat.send, { scope: PERSONAL, conversationId, text: "Which galaxy did I see through the telescope?" });
    expect(sent2.status).toBe("done");
    const chat = await a.as.query(api.aiChat.get, { conversationId });
    const answer = chat!.messages.find((m) => m.role === "assistant")!;
    const chunkBlocks = new Set((await inspect(t, space.id)).chunks.flatMap((c) => c.blockIds));
    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0]!.noteId).toBe(space.id);
    expect(chunkBlocks.has(answer.citations[0]!.blockId!)).toBe(true);
  });

  test("a chunk from a note the asker can't open never reaches the model", async () => {
    const t = setup();
    stubAi();
    const owner = await person(t, "search-owner@example.com");
    const member = await person(t, "search-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Board");
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId, planId: "workspace_pro_ai_monthly" });
    await join(t, owner, member, "search-member@example.com", workspaceId, "editor");
    const secret = await writeNote(owner, scope, "Board only", [filler("merger", 300, "Codename Falcon. ")]);
    await owner.as.mutation(api.sharing.setAccessMode, { documentId: secret.id, mode: "restricted" });
    const open = await writeNote(owner, scope, "Team notes", [filler("takeover", 300, "Public plan. ")]);
    await drain(t);
    const secretChunks = (await inspect(t, secret.id)).chunks;
    expect(secretChunks).toHaveLength(1);
    expect((await inspect(t, open.id)).chunks).toHaveLength(1);

    // The member asks about it: vector search finds the restricted chunk, the per-note check drops it.
    const log = stubAi({ queries: ["qqqqq"], answer: "Nothing about that [1]." });
    const out = await member.as.action(api.ai.ask, { scope: inWorkspace(workspaceId), question: "What is the merger codename for the acquisition?" });
    expect(log.queries).toHaveLength(1);
    expect(out.sources.map((s) => s.title)).toEqual(["Team notes"]);
    expect(log.prompts.join("\n")).not.toContain("Falcon");
    // Even handed the chunk directly, gather refuses it (and a chunk from another scope too).
    const hits = [{ chunkId: secretChunks[0]!.id, score: 0.99 }];
    expect(await member.as.query(internal.ai.gather, { scope: inWorkspace(workspaceId), queries: [], limit: 8, hits })).toEqual(expect.not.arrayContaining([expect.objectContaining({ id: secret.id })]));
    expect((await member.as.query(internal.ai.gather, { scope: PERSONAL, queries: [], limit: 8, hits })).some((n) => n.id === secret.id)).toBe(false);
    // The owner, who can open it, gets it.
    const mine = await owner.as.query(internal.ai.gather, { scope: inWorkspace(workspaceId), queries: [], limit: 8, hits });
    expect(mine[0]).toMatchObject({ id: secret.id, blockIds: secretChunks[0]!.blockIds });
  });

  test("when nothing matches, the answer is told so instead of guessing", async () => {
    const t = setup();
    const a = await person(t, "search-none@example.com");
    const log = stubAi({ queries: ["qqqqq"], answer: "I couldn't find that in your notes." });
    await a.as.action(api.ai.ask, { scope: PERSONAL, question: "What is my passport number?" });
    expect(log.prompts[0]).toContain("No note matched the question");
    expect(log.prompts[0]).toContain("Only say something is in their notes when a note below says it");
    // A question about one note is never "unmatched".
    const found = await a.as.query(internal.ai.gather, { scope: PERSONAL, queries: ["coastal weekend"], limit: 5 });
    expect(found.every((n) => !n.recent)).toBe(true);
    const none = await a.as.query(internal.ai.gather, { scope: PERSONAL, queries: ["qqqqq"], limit: 5 });
    expect(none.length).toBeGreaterThan(0);
    expect(none.every((n) => n.recent)).toBe(true);
  });

  test("deleting a workspace removes its chunks", async () => {
    const t = setup();
    stubAi();
    const owner = await pro(t, "search-delete@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Gone soon");
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId, planId: "workspace_pro_monthly" });
    await writeNote(owner, scope, "Stars", [filler("orbit", 300)]);
    await writeNote(owner, PERSONAL, "Animals", [filler("echidna", 300)]);
    await drain(t);
    const wsId = await t.run(async (ctx) => (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", workspaceId)).unique())!._id);
    const inWs = async () => await t.run(async (ctx) => (await ctx.db.query("aiChunks").withIndex("by_workspace", (q) => q.eq("workspaceId", wsId)).collect()).length);
    expect(await inWs()).toBeGreaterThan(0);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(wsId, { status: "deleting" });
      await ctx.db.insert("deletionJobs", { kind: "workspace", targetId: wsId, requestedBy: owner.profileId as Id<"profiles">, requestedByAdmin: false, reason: "test", scheduledFor: now, status: "scheduled", progress: 0, createdAt: now });
    });
    await t.mutation(internal.maintenance.runDeletionJobs, {});
    await drain(t);
    expect(await inWs()).toBe(0);
    expect(await t.run(async (ctx) => (await ctx.db.query("aiIndexScopes").withIndex("by_workspace", (q) => q.eq("workspaceId", wsId)).collect()).length)).toBe(0);
  });
});
