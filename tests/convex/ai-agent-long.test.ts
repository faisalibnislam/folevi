// The agent with a long note (convex/aiAgent.ts, convex/lib/ai/agentBudget.ts, convex/lib/ai/tools/
// longNotes.ts): a ~6,000-word note of 50 sections whose titles are bold paragraphs or numbered lines.
// It comes to the model as its first page and its outline (every section's block id, even past the first
// page), is read on a page at a time, and is edited in batches of turn_into edits that add up into one
// change. A run that runs out of room keeps what it proposed and offers Continue (never the generic
// "couldn't finish"), stays inside the credits it held, and Continue carries on without proposing the
// waiting blocks again. Gemini is a stubbed `fetch` whose turns can look at the request they answer.
import { afterEach, describe, expect, test, vi } from "vitest";
import { LIMITS, markdownToBlocks, rankSequence, SCHEMA_VERSION, validateWireBlock, type WireBlock } from "@folevi/editor-schema";
import { api } from "../../convex/_generated/api";
import { compactContents, CONTINUE_TEXT, contentChars, isLongNote, LONG_BUDGET, mustWrapUp, STANDARD_BUDGET, stoppedText } from "../../convex/lib/ai/agentBudget";
import { estimateCredits } from "../../convex/lib/credits";
import { looksLikeTitle, outlineOf, pageNote, pageOf, turnIntoMarkdown } from "../../convex/lib/ai/tools/longNotes";
import { addOp, MAX_EDITS, type AgentOp } from "../../convex/lib/ai/tools/ops";
import type { Content } from "../../convex/lib/ai/provider";
import { person, setup, ulid } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;
type Call = { name: string; args: Record<string, unknown> };
type Turn = { text?: string; calls?: Call[] } | { status: number };
type Body = { systemInstruction: { parts: { text: string }[] }; contents: Content[]; toolConfig?: unknown };

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});

const FLASH = { main: "gemini-3.8-flash", fast: "gemini-flash-lite-latest" };

/**
 * Stubs Gemini: each model call gets the request it answers and returns a turn ("Done." when it returns
 * nothing). `usage` is each call's token counts. Returns the parsed request bodies.
 */
function stub(next: (body: Body, i: number) => Turn | undefined, usage = { promptTokenCount: 6_000, candidatesTokenCount: 300 }) {
  process.env.GEMINI_API_KEY = "test-key";
  const bodies: Body[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      if (url.includes(":batchEmbedContents")) return new Response("{}", { status: 500 });
      const body = JSON.parse(init.body) as Body;
      bodies.push(body);
      const turn = next(body, bodies.length - 1) ?? { text: "Done." };
      if ("status" in turn) return new Response("{}", { status: turn.status });
      const parts = [...(turn.text ? [{ text: turn.text }] : []), ...(turn.calls ?? []).map((c, i) => ({ functionCall: { name: c.name, args: c.args }, thoughtSignature: `sig-${i}` }))];
      return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata: usage }), { status: 200 });
    }),
  );
  return bodies;
}

const SENTENCE = "The current screen keeps the person waiting while it loads every item at once, which makes the whole page feel slow and unfinished";

/** Section n's title block id. */
const titleId = (n: number) => `TITLE${String(n).padStart(2, "0")}`;

/**
 * A ~6,000-word note: 50 "Issue NN" sections, each a title (a bold paragraph for odd sections, a numbered
 * line for even ones), a description, an "Expected improvement:" line and its paragraph.
 */
async function longNote(p: Person): Promise<{ id: string; blocks: WireBlock[] }> {
  const doc = await p.as.mutation(api.documents.create, { scope: p.scope, title: "Prompt for improving" });
  const shapes: Omit<WireBlock, "rank">[] = [];
  const text = (t: string, bold = false) => [{ type: "text" as const, text: t, ...(bold ? { marks: [{ type: "bold" as const }] } : {}) }];
  for (let n = 1; n <= 50; n++) {
    const title = `Issue ${String(n).padStart(2, "0")}. Loading state on screen ${n}`;
    shapes.push(n % 2 ? { id: titleId(n), type: "paragraph", parentId: null, schemaVersion: SCHEMA_VERSION, text: text(title, true), props: {} } : { id: titleId(n), type: "numbered", parentId: null, schemaVersion: SCHEMA_VERSION, text: text(title), props: {} });
    shapes.push({ id: `DESC${n}`, type: "paragraph", parentId: null, schemaVersion: SCHEMA_VERSION, text: text(`${SENTENCE}. ${SENTENCE}. ${SENTENCE}. ${SENTENCE}.`), props: {} });
    shapes.push({ id: `EXPL${n}`, type: "paragraph", parentId: null, schemaVersion: SCHEMA_VERSION, text: text("Expected improvement:"), props: {} });
    shapes.push({ id: `EXPT${n}`, type: "paragraph", parentId: null, schemaVersion: SCHEMA_VERSION, text: text(`${SENTENCE}. ${SENTENCE}.`), props: {} });
  }
  const ranks = rankSequence(shapes.length, null, null);
  const blocks = shapes.map((b, i) => ({ ...b, rank: ranks[i]! }) as WireBlock);
  for (let i = 0; i < blocks.length; i += 50) {
    await p.as.mutation(api.sync.push, { scope: p.scope, deviceId: "device-test-1", ops: blocks.slice(i, i + 50).map((block) => ({ opId: ulid(), kind: "block.upsert", documentId: doc.id, block, baseRevision: null, fields: ["content", "position"] })) as never });
  }
  return { id: doc.id, blocks };
}

const blocksOf = async (p: Person, id: string) => (await p.as.query(api.blocks.list, { documentId: id }))!.blocks;
const firstText = (body: Body) => body.contents.flatMap((c) => c.parts).map((part) => ("text" in part ? part.text : "")).join("\n");
/** The title block ids the request shows the model (its outline, and its first page). */
const titlesShown = (s: string) => [...new Set([...s.matchAll(/\[(TITLE\d\d)\]/g)].map((m) => m[1]!))];
const headingEdits = (ids: string[]) => ids.map((blockId) => ({ action: "turn_into", blockId, type: "heading", level: 2 }));

async function ask(p: Person, text: string, o: { conversationId?: string; noteId: string }) {
  const conversationId = o.conversationId ?? ulid();
  const sent = await p.as.action(api.aiAgent.send, { scope: p.scope, conversationId, text, context: { kind: "note", ids: [o.noteId] } });
  const got = (await p.as.query(api.aiChat.get, { conversationId }))!;
  const answer = got.messages.find((m) => m.id === sent.messageId)!;
  return { answer, conversationId, run: answer.agent?.run ?? null };
}

describe("long notes, the pure parts", () => {
  test("a note is read a page at a time: blocks shown, where to read on, never past the end", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `[B${i + 1}] line ${i + 1}`);
    const first = pageOf(lines, 30);
    expect([first.first, first.last, first.total]).toEqual([1, 2, 10]);
    expect(pageNote(first)).toEqual({ truncated: "Showing blocks 1 to 2 of 10. Read on with get_note fromBlock 3.", nextFromBlock: 3 });
    const last = pageOf(lines, 1_000, 9);
    expect(last.text).toBe("[B9] line 9\n[B10] line 10");
    expect(pageNote(last)).toEqual({ truncated: "Showing blocks 9 to 10 of 10." });
    expect(pageNote(pageOf(lines, 1_000))).toEqual({});
    // One line longer than a page is cut rather than skipped; past the end is an empty page.
    expect(pageOf(["x".repeat(100)], 20).text).toHaveLength(19);
    expect(pageOf(lines, 1_000, 99)).toMatchObject({ text: "", last: 10 });
  });

  test("the outline finds section titles: headings, bold lines, numbered titles, lines ending in a colon; not sentences", () => {
    const b = (type: string, t: string, bold = false): WireBlock => ({ id: ulid(), type, parentId: null, rank: "a", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: t, ...(bold ? { marks: [{ type: "bold" }] } : {}) }], props: type === "heading" ? { level: 2 } : {} });
    expect(looksLikeTitle(b("heading", "Anything at all, even a sentence."))).toBe(true);
    expect(looksLikeTitle(b("paragraph", "A whole bold line", true))).toBe(true);
    expect(looksLikeTitle(b("paragraph", "Issue 12 - Slow loading"))).toBe(true);
    expect(looksLikeTitle(b("numbered", "3. Scope and goals"))).toBe(true);
    expect(looksLikeTitle(b("paragraph", "Expected improvement:"))).toBe(true);
    expect(looksLikeTitle(b("paragraph", "This is an ordinary sentence that describes the problem."))).toBe(false);
    expect(looksLikeTitle(b("todo", "Issue 4"))).toBe(false);
    expect(looksLikeTitle(b("paragraph", "x".repeat(200), true))).toBe(false);
    const entries = [b("paragraph", "Intro sentence goes here."), b("heading", "Part one"), b("paragraph", "Body.")].map((block) => ({ block, line: `[${block.id}] ${block.type}` }));
    expect(outlineOf(entries, 1_000)).toMatchObject({ sections: 1, more: 0, lines: [`2. [${entries[1]!.block.id}] heading`] });
    expect(outlineOf(entries, 5)).toMatchObject({ sections: 1, more: 1, lines: [] });
  });

  test("turn_into keeps the text exactly: a bold line becomes a plain heading, links and other marks stay", () => {
    const bold: WireBlock = { id: "A", type: "paragraph", parentId: null, rank: "a", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: "Issue 01. Loading", marks: [{ type: "bold" }] }], props: {} };
    expect(turnIntoMarkdown(bold, "heading", 2)).toBe("## Issue 01. Loading");
    const back = markdownToBlocks(turnIntoMarkdown(bold, "heading", 3)!, { titleFromHeading: false }).blocks;
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ type: "heading", props: { level: 3 }, text: [{ type: "text", text: "Issue 01. Loading" }] });
    const linked: WireBlock = { ...bold, type: "numbered", text: [{ type: "text", text: "See " }, { type: "text", text: "the spec", marks: [{ type: "link", href: "https://example.com" }] }] };
    const h = markdownToBlocks(turnIntoMarkdown(linked, "heading")!, { titleFromHeading: false }).blocks[0]!;
    expect(h.type).toBe("heading");
    expect(h.text).toEqual(linked.text);
    // A paragraph keeps text that looks like a list as text.
    const p = markdownToBlocks(turnIntoMarkdown({ ...bold, type: "heading", text: [{ type: "text", text: "1. Not a list" }], props: { level: 2 } }, "paragraph")!, { titleFromHeading: false }).blocks[0]!;
    expect(p).toMatchObject({ type: "paragraph", text: [{ type: "text", text: "1. Not a list" }] });
    expect(turnIntoMarkdown({ ...bold, type: "image", text: [] }, "heading")).toBeNull();
  });

  test("batches of edits to one note add up into one change; a block edited again takes the newer edit", () => {
    const op = (id: string, edits: AgentOp["edits"]): AgentOp => ({ id, kind: "update_note", summary: "", status: "proposed", noteId: "N", noteTitle: "Plans", edits });
    const ops: AgentOp[] = [{ id: "R", kind: "rename_note", summary: "Rename", status: "proposed", noteId: "N" }];
    addOp(ops, op("1", [{ action: "replace", blockId: "a", markdown: "## A" }, { action: "insert", afterBlockId: "a", markdown: "x" }]));
    const merged = addOp(ops, op("2", [{ action: "replace", blockId: "a", markdown: "### A" }, { action: "delete", blockId: "b" }]));
    expect(ops).toHaveLength(2);
    expect(merged.id).toBe("1");
    expect(merged.summary).toBe("Edit “Plans” (3 changes)");
    expect(merged.edits!.map((e) => [e.action, e.blockId ?? e.afterBlockId, e.markdown])).toEqual([
      ["replace", "a", "### A"],
      ["insert", "a", "x"],
      ["delete", "b", undefined],
    ]);
    // Another note's edits are their own change.
    addOp(ops, { ...op("3", [{ action: "delete", blockId: "c" }]), noteId: "M" });
    expect(ops).toHaveLength(3);
  });

  test("old tool results are shortened once the exchange grows; the request and the model's turns stay", () => {
    const page = (n: number) => ({ id: "N", title: "Plans", blocks: 900, truncated: `Showing blocks ${n}`, nextFromBlock: n + 100, content: "x".repeat(20_000) });
    const contents: Content[] = [{ role: "user", parts: [{ text: "request ".repeat(2_000) }] }];
    for (let i = 0; i < 4; i++) {
      contents.push({ role: "model", parts: [{ functionCall: { name: "get_note", args: { noteId: "N", fromBlock: i * 100 + 1 } }, thoughtSignature: "s" }] });
      contents.push({ role: "user", parts: [{ functionResponse: { name: "get_note", response: page(i * 100 + 1) } }] });
    }
    const before = contentChars(contents);
    expect(compactContents(contents)).toBeGreaterThan(0);
    expect(contentChars(contents)).toBeLessThan(before);
    const results = contents.filter((c) => c.parts.some((p) => "functionResponse" in p)).map((c) => (c.parts[0] as { functionResponse: { response: Record<string, unknown> } }).functionResponse.response);
    expect(results[0]).toEqual({ id: "N", title: "Plans", blocks: 900, truncated: "Showing blocks 1", nextFromBlock: 101, shortened: expect.stringMatching(/Read it again/) });
    // The last two results are whole; the request and the calls with their signatures are untouched.
    expect(results[3]!.content).toHaveLength(20_000);
    expect(results[2]!.content).toHaveLength(20_000);
    expect((contents[0]!.parts[0] as { text: string }).text).toHaveLength(16_000);
    expect(contents[1]!.parts[0]).toMatchObject({ thoughtSignature: "s" });
    // Under the limit nothing changes.
    expect(compactContents([{ role: "user", parts: [{ text: "short" }] }])).toBe(0);
  });

  test("budgets: a long note gets more steps, but a run never plans past the credits it held", () => {
    expect(isLongNote({ blockCount: 40, wordCount: 900 })).toBe(false);
    expect(isLongNote({ blockCount: 200, wordCount: 6_000 })).toBe(true);
    expect(isLongNote({ blockCount: 900, wordCount: 1_000 })).toBe(true);
    expect(LONG_BUDGET.modelCalls).toBeGreaterThan(STANDARD_BUDGET.modelCalls);
    expect(LONG_BUDGET.toolCalls).toBeGreaterThanOrEqual(MAX_EDITS);
    // Held: 15 credits for a short note's run (as before), about 25 for a long note's.
    expect(estimateCredits(STANDARD_BUDGET.plan, FLASH)).toBe(15);
    expect(estimateCredits(LONG_BUDGET.plan, FLASH)).toBe(25);
    const call = { model: FLASH.main, promptTokens: 30_000, outputTokens: 500, thoughtsTokens: 0 };
    // About 5 credits a call: after two, one more call and an answer fit in 25 credits, not in 20.
    expect(mustWrapUp({ spent: [call, call], nextInputChars: 1_000, model: FLASH.main, heldCredits: 25 })).toBe(false);
    expect(mustWrapUp({ spent: [call, call], nextInputChars: 1_000, model: FLASH.main, heldCredits: 20 })).toBe(true);
    // A next call with more input than the last one is counted at its size.
    expect(mustWrapUp({ spent: [call, call], nextInputChars: 400_000, model: FLASH.main, heldCredits: 25 })).toBe(true);
  });

  test("a run that stops before it's done says what it did and offers Continue, never the generic fallback", () => {
    const edit: AgentOp = { id: "1", kind: "update_note", summary: "", status: "proposed", noteId: "N", noteTitle: "Prompt for improving", edits: Array.from({ length: 40 }, (_, i) => ({ action: "delete" as const, blockId: `b${i}` })) };
    expect(stoppedText({ ops: [edit], reason: "budget", long: true })).toBe(
      "This note is long, and I reached the most one request can do. So far I've proposed 40 edits to “Prompt for improving”. Check them and approve what you want, then press Continue and I'll carry on from where I stopped.",
    );
    expect(stoppedText({ ops: [], reason: "budget" })).toMatch(/^I reached the most one request can do before I could propose any changes\. Press Continue/);
    expect(stoppedText({ ops: [edit, edit], reason: "error", problem: "The AI is busy right now." })).toMatch(/^Something went wrong partway \(The AI is busy right now\)\. So far I've proposed 2 changes\./);
    for (const s of [stoppedText({ ops: [], reason: "budget" }), stoppedText({ ops: [edit], reason: "error" })]) {
      expect(s).not.toMatch(/couldn't finish|smaller step/);
      expect(s).not.toContain("\u2014");
    }
  });
});

describe("an agent run on a long note", () => {
  test("“Tidy up the headings” on 50 sections: the outline shows every title, two batches of turn_into, one change, all headings", async () => {
    const t = setup();
    const a = await person(t, "long-headings@example.com");
    const note = await longNote(a);
    const words = (await t.run(async (ctx) => (await ctx.db.query("documents").collect()).find((d) => d.publicId === note.id)!)).wordCount;
    expect(words).toBeGreaterThan(5_000);
    let seen: string[] = [];
    const bodies = stub((body, i) => {
      if (i === 0) {
        seen = titlesShown(firstText(body));
        return { calls: [{ name: "update_note", args: { noteId: note.id, edits: headingEdits(seen.slice(0, 40)) } }] };
      }
      if (i === 1) return { calls: [{ name: "update_note", args: { noteId: note.id, edits: headingEdits(seen.slice(40)) } }] };
      return { text: "I've proposed turning all 50 section titles into headings. Check them and approve." };
    });
    const { answer, run } = await ask(a, "Tidy up the headings", { noteId: note.id });
    // The first request has the first page and the outline: every one of the 50 titles, past the first page too.
    const opening = firstText(bodies[0]!);
    expect(opening).toContain("That note is long (200 blocks)");
    expect(opening).toContain("Read on with get_note fromBlock");
    expect(seen).toHaveLength(50);
    expect(opening).toContain("**Issue 01. Loading state on screen 1**");
    // A long note's budget is offered (more tool calls), with the batching rule.
    expect(bodies[0]!.systemInstruction.parts[0]!.text).toContain(`You have at most ${LONG_BUDGET.toolCalls} tool calls`);
    expect(bodies[0]!.systemInstruction.parts[0]!.text).toContain("turn_into");
    expect(bodies).toHaveLength(3);
    expect(answer.status).toBe("done");
    expect(answer.text).toBe("I've proposed turning all 50 section titles into headings. Check them and approve.");
    expect(answer.text).not.toMatch(/couldn't finish/);
    expect(answer.agent!.more).toBe(false);
    // One change for the note, holding both batches.
    expect(run!.operations).toHaveLength(1);
    expect(run!.operations[0]!.summary).toBe("Edit “Prompt for improving” (50 changes)");
    // The credits stay inside the hold.
    expect(answer.credits).toBeGreaterThan(0);
    expect(answer.credits!).toBeLessThanOrEqual(estimateCredits(LONG_BUDGET.plan, FLASH));

    const approved = await a.as.action(api.aiAgent.approve, { runId: run!.id, operationIds: run!.operations.map((o) => o.id) });
    expect(approved.status).toBe("done");
    const after = await blocksOf(a, note.id);
    expect(after).toHaveLength(200);
    for (let n = 1; n <= 50; n++) {
      const b = after.find((x) => x.id === titleId(n))!;
      expect(b.type).toBe("heading");
      expect(b.props).toMatchObject({ level: 2 });
      expect(b.text).toEqual([{ type: "text", text: `Issue ${String(n).padStart(2, "0")}. Loading state on screen ${n}` }]);
    }
    // The bodies are untouched, in order, and every rank is one the server takes.
    expect(after.map((b) => b.id)).toEqual(note.blocks.map((b) => b.id));
    expect(after.every((b) => validateWireBlock({ ...b, revision: undefined }).length === 0 && b.rank.length <= LIMITS.maxRankLength)).toBe(true);
    expect(after.filter((b) => b.type === "paragraph")).toHaveLength(150);

    // One Undo puts every title back as it was.
    expect((await a.as.action(api.aiAgent.undo, { runId: run!.id })).status).toBe("undone");
    const back = await blocksOf(a, note.id);
    expect(back.find((b) => b.id === titleId(1))).toMatchObject({ type: "paragraph" });
    expect(back.find((b) => b.id === titleId(2))).toMatchObject({ type: "numbered" });
  });

  test("a page at a time: get_note fromBlock reads on (a page always fits a tool result), and old pages are shortened", async () => {
    const t = setup();
    const a = await person(t, "long-pages@example.com");
    const note = await longNote(a);
    const bodies = stub((_body, i) => (i < 5 ? { calls: [{ name: "get_note", args: { noteId: note.id, fromBlock: 1 + i * 40, maxChars: 16_000 } }] } : { text: "I read the whole note." }));
    const { answer } = await ask(a, "Read through the whole note and fix the formatting", { noteId: note.id });
    expect(answer.text).toBe("I read the whole note.");
    const results = bodies[5]!.contents.flatMap((c) => c.parts).flatMap((p) => ("functionResponse" in p ? [p.functionResponse.response] : []));
    expect(results).toHaveLength(5);
    // Never a cut-off JSON string: whole pages (the newest ones) or shortened ones that say where they ended.
    expect(results.some((r) => "partial" in r)).toBe(false);
    expect(results.at(-1)!).toMatchObject({ blocks: 200, truncated: expect.stringMatching(/^Showing blocks 161 to/) });
    expect(String(results.at(-1)!.content)).toContain("[TITLE41]");
    expect(results.some((r) => typeof r.shortened === "string")).toBe(true);
  });

  test("out of room: what was proposed is kept, the answer says what's left with Continue, and Continue carries on without redoing the waiting blocks", async () => {
    const t = setup();
    const a = await person(t, "long-continue@example.com");
    const note = await longNote(a);
    // Each call reports 40,000 prompt tokens (about 6 credits): the run reaches its 25-credit hold after a few.
    let seen: string[] = [];
    let firstRun = true;
    let continued = 0;
    const usage = { promptTokenCount: 40_000, candidatesTokenCount: 300 };
    const bodies = stub(
      (body, i) => {
        // Told to answer now (tools off), it asks for a tool anyway.
        if (body.toolConfig) return { calls: [{ name: "get_note", args: { noteId: note.id, fromBlock: 100 } }] };
        if (firstRun && i === 0) {
          seen = titlesShown(firstText(body));
          return { calls: [{ name: "update_note", args: { noteId: note.id, edits: headingEdits(seen.slice(0, 20)) } }] };
        }
        if (firstRun) return { calls: [{ name: "get_note", args: { noteId: note.id, fromBlock: 40 + i } }] };
        // Continue: it proposes the first 25 again (20 of them are waiting for approval), then the rest.
        continued++;
        if (continued === 1) return { calls: [{ name: "update_note", args: { noteId: note.id, edits: headingEdits(seen.slice(0, 25)) } }] };
        if (continued === 2) return { calls: [{ name: "update_note", args: { noteId: note.id, edits: headingEdits(seen.slice(25)) } }] };
        return { text: "That's the rest of the headings." };
      },
      usage,
    );
    const first = await ask(a, "Tidy up the headings", { noteId: note.id });
    expect(first.answer.status).toBe("done");
    expect(first.answer.agent!.more).toBe(true);
    // The last call was told it's out of room (tools off) and came back as a tool call anyway: the run's own account.
    expect(bodies.at(-1)!.toolConfig).toBeDefined();
    expect(first.answer.text).toBe(stoppedText({ ops: first.run!.operations as AgentOp[], reason: "budget", long: true }));
    expect(first.answer.text).toContain("20 edits to “Prompt for improving”");
    expect(first.run!.status).toBe("preview");
    expect(first.answer.credits!).toBeLessThanOrEqual(estimateCredits(LONG_BUDGET.plan, FLASH));
    const calls = bodies.length;
    expect(calls).toBeLessThan(LONG_BUDGET.modelCalls);

    // Continue in the same conversation: told which blocks are waiting, and they aren't proposed again.
    firstRun = false;
    usage.promptTokenCount = 6_000;
    const next = await ask(a, CONTINUE_TEXT, { conversationId: first.conversationId, noteId: note.id });
    const opening = firstText(bodies[calls]!);
    expect(opening).toContain("The person pressed Continue");
    expect(opening).toContain(`waiting for the person's approval. Leave them alone (don't propose them again): ${seen.slice(0, 20).join(", ")}`);
    expect(next.answer.text).toBe("That's the rest of the headings.");
    expect(next.answer.agent!.more).toBe(false);
    expect(next.run!.operations[0]!.edits!.map((e) => e.before)).toEqual(Array.from({ length: 30 }, (_, i) => `Issue ${i + 21}. Loading state on screen ${i + 21}`));

    // Approving both makes all 50 headings, nothing twice.
    for (const r of [first.run!, next.run!]) expect((await a.as.action(api.aiAgent.approve, { runId: r.id, operationIds: r.operations.map((o) => o.id) })).status).toBe("done");
    const after = await blocksOf(a, note.id);
    expect(after.filter((b) => b.type === "heading").map((b) => b.id)).toEqual(Array.from({ length: 50 }, (_, i) => titleId(i + 1)));
  });

  test("an error partway keeps what was proposed, says so plainly, and offers Continue", async () => {
    const t = setup();
    const a = await person(t, "long-error@example.com");
    const note = await longNote(a);
    stub((body, i) => (i === 0 ? { calls: [{ name: "update_note", args: { noteId: note.id, edits: headingEdits(titlesShown(firstText(body)).slice(0, 10)) } }] } : { status: 429 }));
    const { answer, run } = await ask(a, "Tidy up the headings", { noteId: note.id });
    expect(answer.status).toBe("done");
    expect(answer.error).toBeNull();
    expect(answer.agent!.more).toBe(true);
    expect(answer.text).toMatch(/^Something went wrong partway \(The AI is busy right now\. Try again in a minute\)\. So far I've proposed 10 edits/);
    expect(run!.operations[0]!.edits).toHaveLength(10);
  });

  test("AI batches that insert 320 blocks after the same block keep every rank short and in order", async () => {
    const t = setup();
    const a = await person(t, "long-inserts@example.com");
    const note = await longNote(a);
    const batch = (b: number) => Array.from({ length: 40 }, (_, i) => ({ action: "insert", afterBlockId: "DESC1", markdown: `Added line ${b * 40 + i + 1}` }));
    stub((_b, i) => (i < 8 ? { calls: [{ name: "update_note", args: { noteId: note.id, edits: batch(i) } }] } : { text: "Added 320 lines." }));
    const { run } = await ask(a, "Add 320 placeholder lines under the first description", { noteId: note.id });
    expect(run!.operations).toHaveLength(1);
    expect((await a.as.action(api.aiAgent.approve, { runId: run!.id, operationIds: [run!.operations[0]!.id] })).status).toBe("done");
    const after = await blocksOf(a, note.id);
    expect(after).toHaveLength(520);
    const added = after.filter((b) => b.text[0]?.type === "text" && /^Added line /.test(b.text[0].text));
    expect(added.map((b) => (b.text[0] as { text: string }).text)).toEqual(Array.from({ length: 320 }, (_, i) => `Added line ${i + 1}`));
    // In order, right after the first description (before the next block), in reading order.
    const byRank = [...after].sort((x, y) => (x.rank < y.rank ? -1 : x.rank > y.rank ? 1 : 0));
    const at = byRank.findIndex((b) => b.id === "DESC1");
    expect(byRank.slice(at + 1, at + 321).map((b) => b.id)).toEqual(added.map((b) => b.id));
    expect(byRank[at + 321]!.id).toBe("EXPL1");
    expect(Math.max(...after.map((b) => b.rank.length))).toBeLessThanOrEqual(LIMITS.maxRankLength / 2);
  });

  test("a short note keeps the short budget and no outline", async () => {
    const t = setup();
    const a = await person(t, "short-note@example.com");
    const doc = await a.as.mutation(api.documents.create, { scope: a.scope, title: "Short" });
    await a.as.mutation(api.sync.push, { scope: a.scope, deviceId: "device-test-1", ops: [{ opId: ulid(), kind: "block.upsert", documentId: doc.id, block: { id: "S1", type: "paragraph", parentId: null, rank: "a", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: "Plan", marks: [{ type: "bold" }] }], props: {} }, baseRevision: null, fields: ["content", "position"] }] as never });
    const bodies = stub((_b, i) => (i === 0 ? { calls: [{ name: "update_note", args: { noteId: doc.id, edits: [{ action: "turn_into", blockId: "S1", type: "heading", level: 1 }] } }] } : { text: "Made it a heading." }));
    const { answer, run } = await ask(a, "Make the bold line a heading", { noteId: doc.id });
    expect(firstText(bodies[0]!)).not.toContain("That note is long");
    expect(bodies[0]!.systemInstruction.parts[0]!.text).toContain(`You have at most ${STANDARD_BUDGET.toolCalls} tool calls`);
    expect(answer.agent!.more).toBe(false);
    expect(run!.operations[0]!.edits).toEqual([{ action: "replace", before: "Plan", after: "# Plan" }]);
  });
});
