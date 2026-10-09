// Proactive suggestions (convex/aiSuggestions.ts, lib/ai/suggestions.ts, docs/AI_ASSISTANT.md milestone
// 8): open questions and action items found by patterns, related notes and duplicates from the knowledge
// graph, all without a model call; dismissals per person and note; access checks; the off switches; Core.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SCHEMA_VERSION, rankSequence, type WireBlock } from "@folevi/editor-schema";
import { actionItem, patternSuggestions, suggestionKey, validSuggestionKey, type SuggestionLine } from "../../convex/lib/ai/suggestions";
import { join, person, PERSONAL, setup, teamWorkspace, ulid, type ScopeArg, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.GEMINI_API_KEY;
});

/** A line: "## x" a heading, "[] x" a to-do, "~~x~~" struck through, leading spaces nest it under the line above. */
function blocksOf(lines: string[]): WireBlock[] {
  const ranks = rankSequence(lines.length);
  const out: WireBlock[] = [];
  const parents: (string | null)[] = [];
  lines.forEach((raw, i) => {
    const depth = raw.length - raw.trimStart().length;
    const line = raw.trim();
    const id = ulid();
    parents[depth] = id;
    const parentId = depth > 0 ? (parents[depth - 1] ?? null) : null;
    const heading = line.startsWith("## ");
    const todo = line.startsWith("[] ");
    const struck = /^~~.*~~$/.test(line);
    const text = heading ? line.slice(3) : todo ? line.slice(3) : struck ? line.slice(2, -2) : line;
    out.push({
      id,
      type: heading ? "heading" : todo ? "todo" : "paragraph",
      parentId,
      rank: ranks[i]!,
      schemaVersion: SCHEMA_VERSION,
      text: text ? [{ type: "text", text, ...(struck ? { marks: [{ type: "strike" }] } : {}) }] : [],
      props: heading ? { level: 2 } : todo ? { checked: false } : {},
    } as WireBlock);
  });
  return out;
}

async function writeNote(p: Person, scope: ScopeArg, title: string, lines: string[]) {
  const id = ulid();
  const blocks = blocksOf(lines);
  await p.as.mutation(api.sync.push, {
    scope,
    deviceId: "device-suggest",
    ops: [
      { opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } },
      ...blocks.map((b) => ({ opId: ulid(), kind: "block.upsert", documentId: id, block: b, baseRevision: null, fields: ["content", "position"] })),
    ] as never,
  });
  return { id, blocks };
}

/** Any model call fails the test: suggestions never make one. */
function noModel() {
  process.env.GEMINI_API_KEY = "test-key";
  const fetch = vi.fn(async () => {
    throw new Error("no model calls expected");
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const MEETING = [
  "## Open points",
  "Who owns the launch checklist?",
  "When do we freeze the copy?",
  "  Thursday, after the review.",
  "Is the venue booked already?",
  "Yes, booked last week.",
  "~~Do we need a second photographer?~~",
  "Should we invite the press? (resolved)",
  "## Actions",
  "TODO: send the deck to Sam",
  "Action: book the venue for March",
  "@Dana will draft the press release",
  "We need to confirm the budget with finance",
  "[] Already a task: order badges",
  "Nothing to do here, just notes.",
  "What's the plan for the afterparty?",
];

describe("patterns", () => {
  const lines = (texts: string[]): SuggestionLine[] =>
    blocksOf(texts).map((b, i) => ({ id: b.id, type: b.type, text: (b.text[0] as { text?: string } | undefined)?.text ?? "", depth: texts[i]!.length - texts[i]!.trimStart().length, struck: /^~~/.test(texts[i]!.trim()) }));

  test("open questions: no answer below, not resolved; action items: not already tasks", () => {
    const l = lines(MEETING);
    const hits = patternSuggestions(l);
    expect(hits.filter((h) => h.kind === "question").map((h) => h.text)).toEqual(["Who owns the launch checklist?", "What's the plan for the afterparty?"]);
    expect(hits.filter((h) => h.kind === "action").map((h) => h.text)).toEqual(["send the deck to Sam", "book the venue for March", "@Dana will draft the press release", "We need to confirm the budget with finance"]);
    const deck = hits.find((h) => h.kind === "action")!;
    expect(deck).toMatchObject({ blockId: l[9]!.id, strip: "TODO: ".length });
    // A question followed by a heading or another question is open; with a nested answer it isn't.
    expect(patternSuggestions(lines(["Where do we meet next week?", "## Notes"])).map((h) => h.kind)).toEqual(["question"]);
    expect(patternSuggestions(lines(["Where do we meet next week?", "  At the studio."]))).toEqual([]);
    expect(patternSuggestions(lines(["Short one?"]))).toEqual([]);
    // A few of each, at most.
    expect(patternSuggestions(lines(Array.from({ length: 12 }, (_, i) => `TODO item number ${i}`))).length).toBe(5);
  });

  test("action markers and keys", () => {
    expect(actionItem("TODO: call the bank")).toEqual({ strip: 6 });
    expect(actionItem("Next steps: draft the brief")).toEqual({ strip: 12 });
    expect(actionItem("Follow-up: invoice Acme")).toEqual({ strip: 11 });
    expect(actionItem("@Dana Lee to send the minutes")).toEqual({ strip: 0 });
    expect(actionItem("Remember the TODO list")).toEqual({ strip: 0 });
    expect(actionItem("Do we need to book it?")).toBeNull();
    expect(actionItem("todo")).toBeNull();
    expect(actionItem("A calm paragraph about tea.")).toBeNull();
    expect(suggestionKey("action", "B1")).toBe("act:B1");
    expect(validSuggestionKey("link:01ABC")).toBe(true);
    expect(validSuggestionKey("act:x y")).toBe(false);
    expect(validSuggestionKey("other:1")).toBe(false);
  });
});

describe("suggestions on a note", () => {
  test("found without a model call, dismissed for good, per person", async () => {
    const t = setup();
    const fetch = noModel();
    const owner = await person(t, "sugg-owner@example.com");
    const member = await person(t, "sugg-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Events");
    await join(t, owner, member, "sugg-member@example.com", workspaceId, "editor");
    const note = await writeNote(owner, scope, "Launch meeting", MEETING);

    const first = await owner.as.query(api.aiSuggestions.forNote, { documentId: note.id });
    expect(first.on).toBe(true);
    expect(first.canEdit).toBe(true);
    expect(first.items.map((i) => [i.kind, i.label])).toEqual([
      ["question", "Who owns the launch checklist?"],
      ["action", "send the deck to Sam"],
      ["action", "book the venue for March"],
      ["action", "@Dana will draft the press release"],
      ["action", "We need to confirm the budget with finance"],
      ["question", "What's the plan for the afterparty?"],
    ]);
    const deck = first.items[1]!;
    expect(deck).toMatchObject({ key: `act:${note.blocks[9]!.id}`, blockId: note.blocks[9]!.id, strip: 6 });

    await owner.as.mutation(api.aiSuggestions.dismiss, { documentId: note.id, key: deck.key });
    await owner.as.mutation(api.aiSuggestions.dismiss, { documentId: note.id, key: deck.key });
    const after = await owner.as.query(api.aiSuggestions.forNote, { documentId: note.id });
    expect(after.items.map((i) => i.key)).not.toContain(deck.key);
    expect(after.items).toHaveLength(5);
    expect(await t.run(async (ctx) => (await ctx.db.query("aiSuggestionDismissals").collect()).length)).toBe(1);
    // Someone else on the same note still sees it.
    expect((await member.as.query(api.aiSuggestions.forNote, { documentId: note.id })).items.map((i) => i.key)).toContain(deck.key);
    await expect(owner.as.mutation(api.aiSuggestions.dismiss, { documentId: note.id, key: "nope" })).rejects.toThrow(/isn't valid/);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("only for people who can open the note; read-only people can't act on it", async () => {
    const t = setup();
    noModel();
    const owner = await person(t, "sugg-access@example.com");
    const stranger = await person(t, "sugg-stranger@example.com");
    const viewer = await person(t, "sugg-viewer@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Private");
    await join(t, owner, viewer, "sugg-viewer@example.com", workspaceId, "viewer");
    const note = await writeNote(owner, scope, "Plans", ["TODO: write the plan"]);
    expect(await stranger.as.query(api.aiSuggestions.forNote, { documentId: note.id })).toEqual({ on: false, canEdit: false, items: [] });
    await expect(stranger.as.mutation(api.aiSuggestions.dismiss, { documentId: note.id, key: "act:x" })).rejects.toThrow(/not found/i);
    const seen = await viewer.as.query(api.aiSuggestions.forNote, { documentId: note.id });
    expect(seen.items).toHaveLength(1);
    expect(seen.canEdit).toBe(false);
  });

  test("off: suggestions off, AI off, or a Core plan show nothing", async () => {
    const t = setup();
    noModel();
    const a = await person(t, "sugg-off@example.com");
    const note = await writeNote(a, PERSONAL, "Plans", ["TODO: write the plan"]);
    expect((await a.as.query(api.aiSuggestions.forNote, { documentId: note.id })).items).toHaveLength(1);
    await a.as.mutation(api.users.updateProfile, { aiPrefs: { suggestions: false } });
    expect(await a.as.query(api.aiSuggestions.forNote, { documentId: note.id })).toEqual({ on: false, canEdit: false, items: [] });
    await a.as.mutation(api.users.updateProfile, { aiPrefs: { suggestions: true }, aiEnabled: false });
    expect((await a.as.query(api.aiSuggestions.forNote, { documentId: note.id })).on).toBe(false);
    await a.as.mutation(api.users.updateProfile, { aiEnabled: true });
    expect((await a.as.query(api.aiSuggestions.forNote, { documentId: note.id })).on).toBe(true);

    const core = await person(t, "sugg-core@example.com");
    await core.as.mutation(api.billing.testPurchase, { plan: "core", interval: "month" });
    const theirs = await writeNote(core, PERSONAL, "Plans", ["TODO: write the plan"]);
    expect(await core.as.query(api.aiSuggestions.forNote, { documentId: theirs.id })).toEqual({ on: false, canEdit: false, items: [] });
  });
});

// ---------------------------------------------------------------------------------------------------
// From the knowledge graph (Pro): the fake provider of tests/convex/ai-graph.test.ts, cut down
// ---------------------------------------------------------------------------------------------------

const TOPICS = [
  ["nebula", "quasar", "telescope", "galaxy", "orbit", "stars"],
  ["quokka", "wombat", "platypus", "echidna", "marsupial"],
];

function fakeVector(text: string): number[] {
  const v = new Array<number>(768).fill(0);
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  TOPICS.forEach((family, i) => {
    for (const w of words) if (family.includes(w)) v[i]! += 1;
  });
  v[767] = 0.2;
  return v;
}

const reply = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } }), { status: 200 });

/** Embeddings and graph extraction ("Project Atlas" is the one name it knows). */
function stubGraph() {
  process.env.GEMINI_API_KEY = "test-key";
  const fetch = vi.fn(async (url: string, init: { body: string }) => {
    if (url.includes(":batchEmbedContents")) {
      const body = JSON.parse(init.body) as { requests: { content: { parts: { text: string }[] } }[] };
      return new Response(JSON.stringify({ embeddings: body.requests.map((r) => ({ values: fakeVector(r.content.parts[0]!.text) })) }), { status: 200 });
    }
    const body = JSON.parse(init.body) as { contents: { parts: { text: string }[] }[] };
    const prompt = body.contents.at(-1)!.parts[0]!.text;
    const mine: string[] = [];
    let inNote = false;
    for (const line of prompt.split("\n")) {
      if (line.startsWith("<note")) inNote = true;
      else if (line === "</note>") inNote = false;
      else if (inNote) mine.push(line.replace(/^\d+\. /, ""));
    }
    const lines = mine.map((t, i) => (t.includes("Project Atlas") ? i + 1 : 0)).filter(Boolean);
    return reply(JSON.stringify({ entities: lines.length ? [{ name: "Project Atlas", kind: "project", lines }] : [], relations: [], links: [] }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const drain = async (t: T) => await t.finishAllScheduledFunctions(vi.runAllTimers);

describe("from the graph", () => {
  test("related notes not linked yet and likely duplicates, on plans with the graph only", async () => {
    const t = setup();
    const fetch = stubGraph();
    const a = await person(t, "sugg-graph@example.com");
    await a.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    const plan = await writeNote(a, PERSONAL, "Atlas plan", ["Project Atlas kicks off in spring."]);
    const budget = await writeNote(a, PERSONAL, "Atlas budget", ["Project Atlas costs are on track."]);
    const log = await writeNote(a, PERSONAL, "Telescope log", ["nebula galaxy telescope orbit", "quasar stars"]);
    const copy = await writeNote(a, PERSONAL, "Telescope log (copy)", ["nebula galaxy telescope orbit", "quasar stars"]);
    await drain(t);

    const calls = fetch.mock.calls.length;
    const forPlan = await a.as.query(api.aiSuggestions.forNote, { documentId: plan.id });
    expect(forPlan.items.find((i) => i.kind === "connection")).toMatchObject({ key: `link:${budget.id}`, noteId: budget.id, label: "Atlas budget", reason: "Both mention Project Atlas" });
    const forLog = await a.as.query(api.aiSuggestions.forNote, { documentId: log.id });
    expect(forLog.items.filter((i) => i.kind === "duplicate").map((i) => i.noteId)).toEqual([copy.id]);
    // Reading suggestions never calls the model.
    expect(fetch.mock.calls.length).toBe(calls);

    // Dismissed: gone for this note.
    await a.as.mutation(api.aiSuggestions.dismiss, { documentId: plan.id, key: `link:${budget.id}` });
    expect((await a.as.query(api.aiSuggestions.forNote, { documentId: plan.id })).items.some((i) => i.kind === "connection")).toBe(false);

    // The plan lapses: graph suggestions stop, pattern ones would still show.
    await t.run(async (ctx) => {
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_profile", (q) => q.eq("profileId", a.profileId as Id<"profiles">))
        .unique();
      await ctx.db.patch(sub!._id, { status: "canceled", currentPeriodEnd: Date.now() - 1 });
    });
    expect((await a.as.query(api.aiSuggestions.forNote, { documentId: log.id })).items.some((i) => i.kind === "duplicate")).toBe(false);
  });
});
