// AI conversations (convex/aiChat.ts, docs/AI_ASSISTANT.md milestone 1): the list, sending with a
// streamed answer and citations, regenerate and edit, permissions, history off, credits, proposed changes,
// and deletion with the account or workspace. Gemini is a stubbed `fetch`.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bestBlock, citingSentences, cleanTitle, normalizeContext, titleFromQuestion } from "../../convex/lib/ai/chat";
import { capabilitiesOf, priceOf } from "../../convex/lib/ai/capabilities";
import { hideFollowUps, splitFollowUps } from "../../convex/ai";
import { inWorkspace, person, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.GEMINI_API_KEY;
});

const USAGE = { promptTokenCount: 20_000, candidatesTokenCount: 400 };

function reply(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: USAGE }), { status: 200 });
}

/** A streamed answer in a few pieces (server-sent events). */
function streamed(text: string) {
  const third = Math.ceil(text.length / 3);
  const pieces = [text.slice(0, third), text.slice(third, 2 * third), text.slice(2 * third)];
  const sse = pieces
    .map((p, i) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: p }] }, ...(i === 2 ? { finishReason: "STOP" } : {}) }], usageMetadata: USAGE })}\r\n\r\n`)
    .join("");
  return new Response(sse, { status: 200 });
}

/**
 * Stubs Gemini: search terms (and whether to act), the streamed answer, a plan of changes, and the title.
 * Returns the requests made (url and body).
 */
function gemini(o: { answer?: string; queries?: string[]; act?: boolean; plan?: unknown; title?: string } = {}) {
  process.env.GEMINI_API_KEY = "test-key";
  const calls: { url: string; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      if (url.includes("streamGenerateContent")) return streamed(o.answer ?? "An answer.");
      if (init.body.includes("full-text search queries")) return reply(JSON.stringify({ queries: o.queries ?? ["coastal weekend"], act: o.act ?? false }));
      if (init.body.includes("You name conversations")) return reply(o.title ?? "Coastal weekend plans");
      return reply(JSON.stringify(o.plan ?? { reply: "", actions: [] }));
    }),
  );
  return calls;
}

async function tripNote(p: Person) {
  const found = await p.as.query(internal.ai.gather, { scope: p.scope, queries: ["coastal weekend"], limit: 5 });
  return found.find((n) => n.title === "Trip Sketch: Coastal Weekend")!;
}

const balance = async (p: Person) => await p.as.query(api.billing.credits, { scope: p.scope });

async function spendAll(t: T, p: Person) {
  await t.run(async (ctx) => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_profile", (q) => q.eq("profileId", p.profileId as Id<"profiles">))
      .unique();
    await ctx.db.patch(sub!._id, { trialEndsAt: Date.now() - 1 });
  });
  const { holdId } = await p.as.mutation(internal.ai.begin, { scope: p.scope });
  await t.mutation(internal.ai.settle, { holdId, calls: [{ model: "gemini-3.8-flash", promptTokens: 1_000_000, outputTokens: 0, thoughtsTokens: 0 }] });
}

describe("helpers", () => {
  test("follow-ups are split off the answer and never shown while it streams", () => {
    expect(splitFollowUps('The ferry leaves at 9 [1].\n[[follow-ups]] ["When do we come back?", "What to pack?", "x", "y"]')).toEqual({ answer: "The ferry leaves at 9 [1].", suggestions: ["When do we come back?", "What to pack?", "x"] });
    expect(splitFollowUps("No list here.")).toEqual({ answer: "No list here.", suggestions: [] });
    expect(splitFollowUps("Broken [[follow-ups]] [nope")).toEqual({ answer: "Broken", suggestions: [] });
    expect(hideFollowUps("Answer text\n[[follow-ups]] [\"a\"")).toBe("Answer text");
    expect(hideFollowUps("Answer text\n[[follo")).toBe("Answer text");
    expect(hideFollowUps("Answer [1]")).toBe("Answer [1]");
  });

  test("titles, contexts and the block a citation points at", () => {
    expect(cleanTitle('## "Coastal weekend plans."\nmore')).toBe("Coastal weekend plans");
    expect(titleFromQuestion("When is the coastal weekend trip and how do we get there by ferry or by car?")).toBe("When is the coastal weekend trip and how do we get there by…");
    expect(normalizeContext(undefined)).toEqual({ kind: "workspace", ids: [] });
    expect(normalizeContext({ kind: "notes", ids: ["a", "a", "b c"] })).toEqual({ kind: "note", ids: ["a"] });
    expect(normalizeContext({ kind: "notes", ids: ["1", "2", "3", "4", "5", "6"] }).ids).toHaveLength(5);
    expect(normalizeContext({ kind: "folder", ids: [] })).toEqual({ kind: "workspace", ids: [] });
    expect(citingSentences("We take the ferry [1]. Pack light [2]. Book early [1][2].", 1)).toMatch(/ferry.*Book early/);
    const blocks = [
      { id: "b1", text: "Pack a rain jacket" },
      { id: "b2", text: "Book the ferry for Friday morning" },
    ];
    expect(bestBlock(blocks, "You book the ferry on Friday morning")).toEqual({ blockId: "b2", quote: "Book the ferry for Friday morning" });
    expect(bestBlock(blocks, "Nothing in common here")).toBeNull();
  });

  test("the capability registry prices models the way credits always have", () => {
    expect(priceOf("gemini-flash-lite-latest")).toEqual({ inputNanoPerToken: 300, outputNanoPerToken: 2500 });
    expect(priceOf("gemini-3.8-flash")).toEqual({ inputNanoPerToken: 1500, outputNanoPerToken: 7500 });
    expect(priceOf("gemini-something-new")).toEqual({ inputNanoPerToken: 1500, outputNanoPerToken: 7500 });
    expect(capabilitiesOf("gemini-3.8-flash")).toMatchObject({ text: true, tools: true, searchGrounding: true, embeddings: false });
    expect(capabilitiesOf("gemini-embedding-001")).toMatchObject({ text: false, embeddings: true });
  });
});

describe("conversations", () => {
  test("create, list, rename, pin, search, export and delete", async () => {
    const t = setup();
    const a = await person(t, "chat-list@example.com");
    const first = await a.as.mutation(api.aiChat.create, { scope: a.scope });
    const second = await a.as.mutation(api.aiChat.create, { scope: a.scope });
    let list = await a.as.query(api.aiChat.list, { scope: a.scope, paginationOpts: { numItems: 20, cursor: null } });
    expect(list.page.map((c) => c.id).sort()).toEqual([first, second].sort());
    expect(list.page.every((c) => c.title === "New chat")).toBe(true);

    await a.as.mutation(api.aiChat.rename, { conversationId: first, title: "  Budget   review  " });
    await expect(a.as.mutation(api.aiChat.rename, { conversationId: first, title: "   " })).rejects.toThrow(/name/);
    await a.as.mutation(api.aiChat.setPinned, { conversationId: first, pinned: true });
    const pinned = await a.as.query(api.aiChat.pinned, { scope: a.scope });
    expect(pinned.map((c) => [c.id, c.title])).toEqual([[first, "Budget review"]]);
    list = await a.as.query(api.aiChat.list, { scope: a.scope, paginationOpts: { numItems: 20, cursor: null } });
    expect(list.page.map((c) => c.id)).toEqual([second]);
    const found = await a.as.query(api.aiChat.list, { scope: a.scope, search: "budget", paginationOpts: { numItems: 20, cursor: null } });
    expect(found.page.map((c) => c.id)).toEqual([first]);

    const exported = await a.as.query(api.aiChat.exportMarkdown, { conversationId: first });
    expect(exported.filename).toBe("Budget review.md");
    expect(exported.markdown).toMatch(/^# Budget review\n/);

    await a.as.mutation(api.aiChat.remove, { conversationId: first });
    expect(await a.as.query(api.aiChat.get, { conversationId: first })).toBeNull();
    expect(await a.as.query(api.aiChat.pinned, { scope: a.scope })).toEqual([]);
    // A made-up id is refused.
    await expect(a.as.mutation(api.aiChat.create, { scope: a.scope, conversationId: "not-a-ulid" })).rejects.toThrow(/isn't valid/);
  });

  test("sending streams the answer into the conversation, with cited notes (and blocks), follow-ups, a title and the credits it cost", async () => {
    const t = setup();
    const a = await person(t, "chat-send@example.com");
    const trip = await tripNote(a);
    const calls = gemini({ answer: 'Book the ferry for Friday morning [1].\n[[follow-ups]] ["What should I pack?", "When do we leave?"]' });
    const conversationId = ulid();
    const before = (await balance(a)).used;
    const sent = await a.as.action(api.aiChat.send, { scope: a.scope, conversationId, text: "How do we get to the coast?" });
    expect(sent.status).toBe("done");
    const got = (await a.as.query(api.aiChat.get, { conversationId }))!;
    expect(got.conversation.title).toBe("Coastal weekend plans");
    expect(got.messages.map((m) => [m.role, m.status])).toEqual([
      ["user", "done"],
      ["assistant", "done"],
    ]);
    const answer = got.messages[1]!;
    expect(answer.text).toBe("Book the ferry for Friday morning [1].");
    expect(answer.suggestions).toEqual(["What should I pack?", "When do we leave?"]);
    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0]).toMatchObject({ n: 1, noteId: trip.id, title: "Trip Sketch: Coastal Weekend", quote: "Book the ferry for Friday morning" });
    const blocks = (await a.as.query(api.blocks.list, { documentId: trip.id }))!.blocks;
    expect(blocks.find((b) => b.id === answer.citations[0]!.blockId)?.text[0]?.text).toBe("Book the ferry for Friday morning");
    // Search terms, the streamed answer, then the title (on the fast model).
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["gemini-flash-lite-latest:generateContent", "gemini-3.8-flash:streamGenerateContent?alt=sse", "gemini-flash-lite-latest:generateContent"]);
    expect(calls[1]!.body).toContain("ferry");
    // Charged once, for all three calls, and the cost is on the answer.
    expect(answer.credits).toBeGreaterThan(0);
    expect((await balance(a)).used - before).toBe(answer.credits);
    expect(await t.run(async (ctx) => (await ctx.db.query("aiCreditHolds").collect()).length)).toBe(0);

    // A follow-up sends the conversation so far; the title isn't asked for again.
    const more = gemini({ answer: "Pack a rain jacket [1]." });
    await a.as.action(api.aiChat.send, { scope: a.scope, conversationId, text: "And what should I pack?" });
    expect(more.some((c) => c.body.includes("You name conversations"))).toBe(false);
    expect(more.find((c) => c.url.includes("stream"))!.body).toContain("How do we get to the coast?");
    expect((await a.as.query(api.aiChat.get, { conversationId }))!.messages).toHaveLength(4);
    // It's listed, and found by what was said.
    const found = await a.as.query(api.aiChat.list, { scope: a.scope, search: "ferry", paginationOpts: { numItems: 10, cursor: null } });
    expect(found.page.map((c) => c.id)).toEqual([conversationId]);
  });

  test("regenerate replaces the last answer; editing a message drops what came after it", async () => {
    const t = setup();
    const a = await person(t, "chat-edit@example.com");
    gemini({ answer: "First answer." });
    const conversationId = ulid();
    await a.as.action(api.aiChat.send, { scope: a.scope, conversationId, text: "Question one" });
    await a.as.action(api.aiChat.send, { scope: a.scope, conversationId, text: "Question two" });
    let messages = (await a.as.query(api.aiChat.get, { conversationId }))!.messages;
    expect(messages).toHaveLength(4);

    gemini({ answer: "Second take." });
    const again = await a.as.action(api.aiChat.regenerate, { conversationId });
    messages = (await a.as.query(api.aiChat.get, { conversationId }))!.messages;
    expect(messages.map((m) => m.text)).toEqual(["Question one", "First answer.", "Question two", "Second take."]);
    expect(messages[3]!.id).toBe(again.messageId);

    gemini({ answer: "Edited answer." });
    await a.as.action(api.aiChat.edit, { conversationId, messageId: messages[0]!.id, text: "Question one, rephrased" });
    messages = (await a.as.query(api.aiChat.get, { conversationId }))!.messages;
    expect(messages.map((m) => m.text)).toEqual(["Question one, rephrased", "Edited answer."]);
    // An answer can't be edited as if it were the person's message.
    await expect(a.as.action(api.aiChat.edit, { conversationId, messageId: messages[1]!.id, text: "x" })).rejects.toThrow(/isn't there/);
  });

  test("Stop: the answer being written stops at its next write and keeps what it had", async () => {
    const t = setup();
    const a = await person(t, "chat-stop@example.com");
    const conversationId = ulid();
    const { messageId } = await a.as.mutation(internal.aiChat.post, { mode: "send", scope: a.scope, conversationId, text: "Tell me everything" });
    expect(await t.mutation(internal.aiChat.writeMessage, { messageId, text: "Part one" })).toBe(true);
    // Only one answer at a time.
    await expect(a.as.mutation(internal.aiChat.post, { mode: "send", conversationId, text: "Another" })).rejects.toThrow(/Wait for the answer/);
    await a.as.mutation(api.aiChat.stop, { messageId });
    expect(await t.mutation(internal.aiChat.writeMessage, { messageId, text: "Part one, part two" })).toBe(false);
    await t.mutation(internal.aiChat.finishMessage, { messageId, status: "done", text: "Part one, part two", suggestions: ["more?"] });
    const answer = (await a.as.query(api.aiChat.get, { conversationId }))!.messages[1]!;
    expect(answer).toMatchObject({ status: "stopped", text: "Part one, part two", suggestions: [] });
  });

  test("proposed changes work in a chat: stored on the answer, applied by the person, outcome kept", async () => {
    const t = setup();
    const a = await person(t, "chat-act@example.com");
    gemini({ act: true, plan: { reply: "I'll make a Recipes folder.", actions: [{ type: "createFolder", name: "Recipes" }] } });
    const conversationId = ulid();
    await a.as.action(api.aiChat.send, { scope: a.scope, conversationId, text: "Make a folder called Recipes" });
    const answer = (await a.as.query(api.aiChat.get, { conversationId }))!.messages[1]!;
    expect(answer.text).toBe("I'll make a Recipes folder.");
    expect(answer.actions).toEqual([{ type: "createFolder", name: "Recipes" }]);
    const applied = await a.as.mutation(api.aiActions.apply, { scope: a.scope, actions: answer.actions! });
    await a.as.mutation(api.aiChat.setActionsOutcome, { messageId: answer.id, outcome: { kind: "applied", ...applied } });
    const after = (await a.as.query(api.aiChat.get, { conversationId }))!.messages[1]!;
    expect(after.actionsOutcome).toMatchObject({ kind: "applied", folders: [{ name: "Recipes" }] });
  });
});

describe("privacy and limits", () => {
  test("a conversation is private to its owner, and a note someone can't read is never used or cited", async () => {
    const t = setup();
    const a = await person(t, "chat-owner@example.com");
    const b = await person(t, "chat-other@example.com");
    const aTrip = await tripNote(a);
    gemini({ answer: "Book the ferry for Friday morning [1]." });
    const conversationId = ulid();
    await a.as.action(api.aiChat.send, { scope: a.scope, conversationId, text: "How do we get there?" });
    const answerId = (await a.as.query(api.aiChat.get, { conversationId }))!.messages[1]!.id;

    // B can't read, list, search, change, stop, export or continue it.
    expect(await b.as.query(api.aiChat.get, { conversationId })).toBeNull();
    expect((await b.as.query(api.aiChat.list, { scope: b.scope, paginationOpts: { numItems: 10, cursor: null } })).page).toEqual([]);
    expect((await b.as.query(api.aiChat.list, { scope: b.scope, search: "ferry", paginationOpts: { numItems: 10, cursor: null } })).page).toEqual([]);
    await expect(b.as.mutation(api.aiChat.rename, { conversationId, title: "Mine now" })).rejects.toThrow(/isn't there/);
    await expect(b.as.mutation(api.aiChat.stop, { messageId: answerId })).rejects.toThrow(/isn't there/);
    await expect(b.as.query(api.aiChat.exportMarkdown, { conversationId })).rejects.toThrow(/isn't there/);
    await expect(b.as.action(api.aiChat.send, { scope: b.scope, conversationId, text: "hi" })).rejects.toThrow(/isn't there/);
    await b.as.mutation(api.aiChat.remove, { conversationId });
    expect(await a.as.query(api.aiChat.get, { conversationId })).not.toBeNull();

    // B can't point a chat at A's note.
    await expect(b.as.action(api.aiChat.send, { scope: b.scope, conversationId: ulid(), text: "Summarize", context: { kind: "note", ids: [aTrip.id] } })).rejects.toThrow(/not found/i);
    // B's own chat about "the coast" only ever sees B's notes.
    const calls = gemini({ answer: "Book the ferry for Friday morning [1]." });
    const mine = ulid();
    await b.as.action(api.aiChat.send, { scope: b.scope, conversationId: mine, text: "How do we get to the coast?" });
    const cited = (await b.as.query(api.aiChat.get, { conversationId: mine }))!.messages[1]!.citations;
    expect(cited.length).toBe(1);
    expect(cited[0]!.noteId).not.toBe(aTrip.id);
    expect(calls.every((c) => !c.body.includes(aTrip.id))).toBe(true);
  });

  test("a conversation about one note reads only that note (no search)", async () => {
    const t = setup();
    const a = await person(t, "chat-note@example.com");
    const trip = await tripNote(a);
    const calls = gemini({ answer: "Book the ferry for Friday morning [1]." });
    const conversationId = ulid();
    await a.as.action(api.aiChat.send, { scope: a.scope, conversationId, text: "What's left to do?", context: { kind: "note", ids: [trip.id] } });
    expect(calls.some((c) => c.body.includes("full-text search queries"))).toBe(false);
    const got = (await a.as.query(api.aiChat.get, { conversationId }))!;
    expect(got.conversation.context).toEqual({ kind: "note", items: [{ id: trip.id, name: "Trip Sketch: Coastal Weekend" }] });
    expect(got.messages[1]!.citations[0]!.noteId).toBe(trip.id);
  });

  test("history off: the conversation isn't listed, goes when the chat closes, and is swept after a day", async () => {
    const t = setup();
    const a = await person(t, "chat-history@example.com");
    expect((await a.as.query(api.aiChat.capabilities, {})).prefs).toEqual({ history: true, memory: true, suggestions: true, attachments: true, webResearch: true, digests: false });
    await a.as.mutation(api.users.updateProfile, { aiPrefs: { history: false } });
    expect((await a.as.query(api.users.me, {}) as { profile: { aiPrefs: { history: boolean; digests: boolean } } }).profile.aiPrefs).toMatchObject({ history: false, digests: false });
    gemini({ answer: "Hello." });
    const closed = ulid();
    await a.as.action(api.aiChat.send, { scope: a.scope, conversationId: closed, text: "Hi" });
    const got = (await a.as.query(api.aiChat.get, { conversationId: closed }))!;
    expect(got.conversation.ephemeral).toBe(true);
    // Not named (nothing to list it by), not listed.
    expect(got.conversation.title).toBe("New chat");
    expect((await a.as.query(api.aiChat.list, { scope: a.scope, paginationOpts: { numItems: 10, cursor: null } })).page).toEqual([]);
    await a.as.mutation(api.aiChat.discard, { conversationId: closed });
    expect(await a.as.query(api.aiChat.get, { conversationId: closed })).toBeNull();
    expect(await t.run(async (ctx) => (await ctx.db.query("aiMessages").collect()).length)).toBe(0);

    // A tab closed without saying so: swept after a day.
    const left = ulid();
    await a.as.action(api.aiChat.send, { scope: a.scope, conversationId: left, text: "Hi again" });
    expect((await t.mutation(internal.aiChat.sweep, {})).conversations).toBe(0);
    await t.run(async (ctx) => {
      const c = (await ctx.db.query("aiConversations").collect())[0]!;
      await ctx.db.patch(c._id, { updatedAt: Date.now() - 25 * 60 * 60_000 });
    });
    expect((await t.mutation(internal.aiChat.sweep, {})).conversations).toBe(1);
    expect(await t.run(async (ctx) => (await ctx.db.query("aiMessages").collect()).length)).toBe(0);
    // Kept conversations are never discarded.
    await a.as.mutation(api.users.updateProfile, { aiPrefs: { history: true } });
    const kept = ulid();
    await a.as.action(api.aiChat.send, { scope: a.scope, conversationId: kept, text: "Keep me" });
    await a.as.mutation(api.aiChat.discard, { conversationId: kept });
    expect(await a.as.query(api.aiChat.get, { conversationId: kept })).not.toBeNull();
  });

  test("refusals are stored on the answer: out of credits (nothing sent), AI turned off (refused outright)", async () => {
    const t = setup();
    const a = await person(t, "chat-credits@example.com");
    await spendAll(t, a);
    const calls = gemini();
    const conversationId = ulid();
    const sent = await a.as.action(api.aiChat.send, { scope: a.scope, conversationId, text: "What's new?" });
    expect(sent.status).toBe("error");
    expect(calls).toHaveLength(0);
    const answer = (await a.as.query(api.aiChat.get, { conversationId }))!.messages[1]!;
    expect(answer.status).toBe("error");
    expect(answer.error).toMatchObject({ code: "out_of_credits", action: "upgrade" });

    await a.as.mutation(api.users.updateProfile, { aiEnabled: false });
    await expect(a.as.action(api.aiChat.send, { scope: a.scope, conversationId: ulid(), text: "Hi" })).rejects.toThrow(/turned off/);
    expect(calls).toHaveLength(0);
  });

  test("conversations go with the workspace, and with the account", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await person(t, "chat-delete@example.com");
    const { workspaceId } = await teamWorkspace(a, "Chats");
    gemini({ answer: "Fine." });
    await a.as.action(api.aiChat.send, { scope: inWorkspace(workspaceId), conversationId: ulid(), text: "In the workspace" });
    await a.as.action(api.aiChat.send, { scope: a.scope, conversationId: ulid(), text: "In Personal" });
    const counts = async () => await t.run(async (ctx) => ({ conversations: (await ctx.db.query("aiConversations").collect()).length, messages: (await ctx.db.query("aiMessages").collect()).length }));
    expect(await counts()).toEqual({ conversations: 2, messages: 4 });

    const now = Date.now();
    await t.run(async (ctx) => {
      const ws = (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", workspaceId)).unique())!;
      await ctx.db.patch(ws._id, { deletionScheduledFor: now - 1 });
      await ctx.db.insert("deletionJobs", { kind: "workspace", targetId: ws._id, requestedBy: a.profileId as Id<"profiles">, requestedByAdmin: false, reason: "test", scheduledFor: now - 1, status: "scheduled", progress: 0, createdAt: now });
    });
    for (let i = 0; i < 10; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    expect(await counts()).toEqual({ conversations: 1, messages: 2 });

    await t.run(async (ctx) => {
      await ctx.db.patch(a.profileId as Id<"profiles">, { status: "pending_deletion" });
      await ctx.db.insert("deletionJobs", { kind: "account", targetId: a.profileId, requestedBy: a.profileId as Id<"profiles">, requestedByAdmin: false, reason: "test", scheduledFor: now - 1, status: "scheduled", progress: 0, createdAt: now });
    });
    for (let i = 0; i < 20; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    expect(await counts()).toEqual({ conversations: 0, messages: 0 });
  });
});
