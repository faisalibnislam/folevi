// Foli AI in local mode (WP11, lib/local/ai): every local AI function against a fake model host. The prompts
// that reach the model are exactly the shared builders' (@folevi/ai-prompts, the same the server sends to
// Gemini), replies go through the same checks as on the server, results have the server's shapes, the
// features offered follow the active model, and keys never come back to the page.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ulid, type SyncOp, type WireBlock } from "@folevi/editor-schema";
import { writingRequest, finishWriting } from "@folevi/ai-prompts/writing";
import { answerRequest, briefRequest, chatTitleRequest, searchTermsRequest } from "@folevi/ai-prompts/ask";
import { flowchartRequest, parseFlowchartDraft } from "@folevi/ai-prompts/flowchart";
import { mapPromptRequest, parseMapReply } from "@folevi/ai-prompts/mindmap";
import { tableEditRequest, tableOf, parseTableReply } from "@folevi/ai-prompts/table";
import { clusterRequest, promptBoardOf } from "@folevi/ai-prompts/stickies";
import { drawRequest } from "@folevi/ai-prompts/wireframe";
import { memoryPrompt } from "@folevi/ai-prompts/memory";
import { api } from "@/lib/convex/api";
import { LocalBackend, LocalClient, MemoryStore } from "@/lib/local";
import { configureLocalAiHost, localAiState, refreshLocalAi, resolveActive, setLocalAiChoice } from "@/lib/local/ai/state";
import { featuresFor } from "@/lib/local/ai/features";
import { NOT_SET_UP, OFF_HERE, TOO_LONG_ON_DEVICE, toHostRequest, withMemory, withSafety } from "@/lib/local/ai/provider";
import { resetStreams } from "@/lib/local/ai/streams";
import { fakeHost, type FakeHost } from "./local-ai-fake";

const SCOPE = { kind: "personal" } as const;
const para = (id: string, text: string, rank = "V"): WireBlock => ({ id, type: "paragraph", parentId: null, rank, schemaVersion: 1, text: [{ type: "text", text }], props: {} });
const todo = (id: string, text: string, rank: string, dueDate: string | null = null): WireBlock => ({ id, type: "todo", parentId: null, rank, schemaVersion: 1, text: [{ type: "text", text }], props: { checked: false, ...(dueDate ? { dueDate } : {}) } });

async function library(host: FakeHost | null) {
  configureLocalAiHost(() => ({ ai: host?.ai ?? null, secrets: host?.secrets ?? null }));
  await refreshLocalAi();
  const backend = new LocalBackend(new MemoryStore(), { deviceId: "dev_ai" });
  const client = new LocalClient(backend);
  await client.local.setup({ timeZone: "UTC", locale: "en", displayName: "Sam", seed: false });
  const push = (ops: SyncOp[]) => client.mutation(api.sync.push, { scope: SCOPE, deviceId: "engine-device-1", ops: ops as never });
  const note = async (title: string, blocks: WireBlock[] = []) => {
    const id = ulid();
    await push([{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: "📝" } }]);
    for (const b of blocks) await push([{ opId: ulid(), kind: "block.upsert", documentId: id, block: b, baseRevision: null, fields: ["content", "position"] }]);
    return id;
  };
  return { client, backend, note };
}

/** The request the host got, as the shared builder made it (the system prompt, then the user turn). */
const asSent = (r: { system?: string; messages: { content: string }[] }) => ({ system: r.system, prompt: r.messages[r.messages.length - 1]!.content });
const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return ((e as { data?: { code: string; message: string } }).data ?? { code: "thrown", message: String(e) }) as { code: string; message: string; reason?: string };
  }
};

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
  resetStreams();
});
afterEach(() => configureLocalAiHost(null));

describe("which model, and what it can do", () => {
  test("no host, no model: nothing is offered and every call says how to set Foli AI up", async () => {
    const { client, note } = await library(null);
    expect(localAiState().active).toBeNull();
    expect(Object.values(localAiState().features).every((on) => !on)).toBe(true);
    const caps = await client.query(api.aiChat.capabilities, {});
    expect(caps).toMatchObject({ model: "", vision: false, audioIn: false, tools: false, searchGrounding: false, contextWindow: 0 });
    const id = await note("Plan", [para("p1", "Ship it")]);
    expect(await errorOf(client.action(api.ai.write, { scope: SCOPE, task: "summarize", documentId: id }))).toMatchObject({ code: "forbidden", message: NOT_SET_UP, reason: "ai_not_included" });
  });

  test("Apple's model when it's on, the person's pick when it can be used, else the first key", async () => {
    const caps = { onDevice: true, onDeviceContext: 4096, keys: { "ai.anthropic": true } } as const;
    expect(resolveActive(caps, null)).toMatchObject({ provider: "on-device", contextTokens: 4096 });
    expect(resolveActive(caps, { provider: "anthropic", model: "claude-opus-5-5" })).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", fastModel: "claude-haiku-5-5" });
    // A pick that can't be used (no key) falls back.
    expect(resolveActive(caps, { provider: "openai", model: "gpt-6-astra" })).toMatchObject({ provider: "on-device" });
    expect(resolveActive({ onDevice: false, keys: { "ai.google": true } }, null)).toMatchObject({ provider: "google", model: "gemini-3.8-flash" });
    expect(resolveActive({ onDevice: false, keys: {} }, null)).toBeNull();
  });

  test("per-feature flags: the small on-device model can't do big structured answers; nothing server-only shows anywhere", () => {
    const device = featuresFor("on-device");
    const key = featuresFor("openai");
    for (const f of ["write", "ask", "brief", "chat", "memory", "translate", "findTodos", "mindmap", "stickies", "table", "chart"] as const) expect([f, device[f], key[f]]).toEqual([f, true, true]);
    for (const f of ["wireframe", "flowchart", "actions", "longNotes"] as const) expect([f, device[f], key[f]]).toEqual([f, false, true]);
    for (const f of ["agent", "research", "web", "attachments", "transcription", "digest", "routines", "semanticSearch", "suggestions", "mindmapFile", "stickiesPhoto"] as const) expect([f, device[f], key[f]]).toEqual([f, false, false]);
  });

  test("a feature the on-device model can't do is refused with the plain message; with a key it runs", async () => {
    const host = fakeHost({ onDevice: true });
    const { client } = await library(host);
    expect(await errorOf(client.action(api.wireframeAi.draw, { scope: SCOPE, instruction: "A sign-in screen" }))).toMatchObject({ code: "forbidden", message: OFF_HERE });
    expect(host.requests).toHaveLength(0);
    host.stored.set("ai.openai", "sk-test-0123456789abcdefghij");
    await setLocalAiChoice({ provider: "openai", model: "gpt-6-astra" });
    host.answer(() => JSON.stringify({ screens: [{ name: "Sign in", frame: "phone", parts: [{ kind: "heading", text: "Welcome" }, { kind: "button", text: "Go" }] }] }));
    const wf = await client.action(api.wireframeAi.draw, { scope: SCOPE, instruction: "A sign-in screen" });
    expect(wf.screens).toHaveLength(1);
    expect(host.requests[0]).toMatchObject({ provider: "openai", model: "gpt-6-astra", json: true });
    expect(asSent(host.requests[0]!)).toEqual({ system: withSafety(drawRequest("A sign-in screen", "phone")).system, prompt: drawRequest("A sign-in screen", "phone").prompt });
  });

  test("capabilities re-run when a key is added (ai:state)", async () => {
    const host = fakeHost();
    const { client } = await library(host);
    const seen: string[] = [];
    const watch = client.watchQuery(api.aiChat.capabilities as never, {});
    const off = watch.onUpdate(() => seen.push(String((watch.localQueryResult() as { model: string } | undefined)?.model)));
    await new Promise((r) => setTimeout(r, 10));
    host.stored.set("ai.google", "AIza-test-0123456789abcdefghijklmnop");
    await refreshLocalAi();
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.at(-1)).toBe("gemini-3.8-flash");
    off();
  });

  test("Foli AI turned off in settings refuses like the server", async () => {
    const host = fakeHost({ onDevice: true });
    const { client } = await library(host);
    await client.mutation(api.users.updateProfile, { aiEnabled: false });
    expect(await errorOf(client.action(api.ai.write, { scope: SCOPE, task: "improve", text: "hello there" }))).toMatchObject({ code: "forbidden", message: "Foli AI is turned off in your settings." });
  });
});

describe("the provider layer", () => {
  test("fast calls use the quick model, preferences go into the system prompt except for plumbing calls", () => {
    const active = resolveActive({ onDevice: false, keys: { "ai.anthropic": true } }, null)!;
    const req = { system: "S", prompt: "P", fast: true, json: true, maxOutputTokens: 200 };
    expect(toHostRequest(req, active)).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", maxTokens: 200, json: true, messages: [{ role: "user", content: "P" }] });
    expect(withMemory(req, "<preferences>x</preferences>")).toBe(req);
    expect(withMemory({ system: "S", prompt: "P" }, "<preferences>x</preferences>").system).toBe("S\n\n<preferences>x</preferences>");
    expect(withMemory({ system: "S", prompt: "P", noMemory: true }, "M").system).toBe("S");
  });

  test("on the device a request is fitted to the context, and one that can't fit is refused", () => {
    const device = resolveActive({ onDevice: true, onDeviceContext: 4096, keys: {} }, null)!;
    const fits = toHostRequest({ system: "S", prompt: "x".repeat(4_000), maxOutputTokens: 3072 }, device)!;
    expect(fits.maxTokens).toBeLessThanOrEqual(2048);
    expect(fits.maxTokens).toBeGreaterThan(256);
    expect(toHostRequest({ system: "S", prompt: "x".repeat(16_000), maxOutputTokens: 1024 }, device)).toBeNull();
  });

  test("a refused key and a long request become the person-readable errors; nothing about the key", async () => {
    const host = fakeHost({ keys: ["ai.openai"] });
    const { client } = await library(host);
    host.answer(() => ({ text: "", stopReason: "error", errorCode: "auth", error: "401" }));
    const e = await errorOf(client.action(api.ai.write, { scope: SCOPE, task: "improve", text: "Some words to improve here." }));
    expect(e).toMatchObject({ code: "forbidden", message: "Your OpenAI key was refused. Check it in Settings > AI." });
    expect(JSON.stringify(e)).not.toContain("sk-test");
    const device = fakeHost({ onDevice: true });
    const lib2 = await library(device);
    expect(await errorOf(lib2.client.action(api.ai.write, { scope: SCOPE, task: "improve", text: "word ".repeat(4_000) }))).toMatchObject({ code: "limit_exceeded", message: TOO_LONG_ON_DEVICE });
    expect(device.requests).toHaveLength(0);
  });
});

describe("ai.*", () => {
  test("write: the shared request, the shared finishing (a title tidied, flashcards made Markdown)", async () => {
    const host = fakeHost({ keys: ["ai.anthropic"] });
    const { client, note } = await library(host);
    const id = await note("Launch plan", [para("p1", "We launch in May with a small beta.")]);
    host.answer(() => '"Launch plan for May."');
    const out = await client.action(api.ai.write, { scope: SCOPE, task: "title", documentId: id });
    expect(out).toEqual(finishWriting("title", '"Launch plan for May."'));
    expect(out.text).toBe("Launch plan for May");
    const sent = host.requests[0]!;
    const expected = writingRequest({ task: "title", note: { title: "Launch plan", text: "# Launch plan\n\nWe launch in May with a small beta." }, text: "", instruction: "" }, true);
    expect(sent.system).toBe(withSafety(expected).system);
    expect(sent.messages.at(-1)!.content).toContain("We launch in May with a small beta.");
    expect(sent).toMatchObject({ model: "claude-haiku-5-5", temperature: expected.temperature });
    host.answer(() => JSON.stringify({ cards: [{ q: "When is the launch?", a: "May." }] }));
    const cards = await client.action(api.ai.write, { scope: SCOPE, task: "flashcards", text: "We launch in May." });
    expect(cards).toEqual(finishWriting("flashcards", JSON.stringify({ cards: [{ q: "When is the launch?", a: "May." }] })));
    // A reply the server's check refuses is refused here with its message.
    host.answer(() => "nothing useful");
    expect(await errorOf(client.action(api.ai.write, { scope: SCOPE, task: "mindMap", text: "Ideas" }))).toMatchObject({ code: "invalid_argument" });
    // Missing input is refused before anything is sent, with the server's words.
    const before = host.requests.length;
    expect(await errorOf(client.action(api.ai.write, { scope: SCOPE, task: "improve", text: " " }))).toMatchObject({ message: "Select some text first." });
    expect(await errorOf(client.action(api.ai.write, { scope: SCOPE, task: "nope" }))).toMatchObject({ message: "Unknown AI action." });
    expect(host.requests.length).toBe(before);
  });

  test("streams: start, the text so far while it's written, Stop aborts the model call", async () => {
    const host = fakeHost({ keys: ["ai.openai"] });
    const { client } = await library(host);
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    host.answer(() => ({ text: "Improved words that keep going for a while.", chunks: 4, hold }));
    const id = await client.mutation(api.ai.startStream, {});
    expect(await client.query(api.ai.stream, { id })).toEqual({ text: "", status: "pending" });
    const running = client.action(api.ai.write, { scope: SCOPE, task: "improve", text: "Some words to make better.", streamId: id });
    await new Promise((r) => setTimeout(r, 120));
    await client.mutation(api.ai.cancelStream, { id });
    release();
    await running;
    expect(host.cancelled).toBe(1);
    expect((await client.query(api.ai.stream, { id }))?.status).toBe("cancelled");
    // A finished stream reads done with the whole text; an unknown one reads null.
    host.answer(() => "Better words.");
    const id2 = await client.mutation(api.ai.startStream, {});
    await client.action(api.ai.write, { scope: SCOPE, task: "improve", text: "Some words to make better.", streamId: id2 });
    expect(await client.query(api.ai.stream, { id: id2 })).toEqual({ text: "Better words.", status: "done" });
    expect(await client.query(api.ai.stream, { id: "st_gone" as never })).toBeNull();
    // A stream can be written into once.
    expect(await errorOf(client.action(api.ai.write, { scope: SCOPE, task: "improve", text: "Some words.", streamId: id2 }))).toMatchObject({ message: "That AI request has expired. Try again." });
  });

  test("ask: search terms (the fast call), the library's search, cited sources", async () => {
    const host = fakeHost({ keys: ["ai.google"] });
    const { client, note } = await library(host);
    const lisbon = await note("Lisbon trip", [para("l1", "Take tram 28 to the castle in Lisbon.")]);
    await note("Groceries", [para("g1", "Milk and bread.")]);
    host.answer((req) => (req.system?.includes("full-text search queries") ? JSON.stringify({ queries: ["lisbon tram"], act: false }) : "Take tram 28 [1]."));
    const out = await client.action(api.ai.ask, { scope: SCOPE, question: "How do I get to the castle in Lisbon?" });
    expect(out).toEqual({ answer: "Take tram 28 [1].", sources: [{ id: lisbon, title: "Lisbon trip" }] });
    const [terms, answer] = host.requests;
    expect(asSent(terms!)).toEqual({ system: withSafety(searchTermsRequest({ question: "", history: [] })).system, prompt: searchTermsRequest({ question: "How do I get to the castle in Lisbon?", history: [] }).prompt });
    expect(terms).toMatchObject({ model: "gemini-3.5-flash-lite", json: true });
    const expected = answerRequest({ notes: [{ id: lisbon, title: "Lisbon trip", text: "Lisbon trip\nTake tram 28 to the castle in Lisbon." }], question: "How do I get to the castle in Lisbon?", history: [], notesOnly: false, focused: false });
    expect(answer!.system).toBe(withSafety(expected).system);
    expect(answer!.messages.at(-1)!.content).toContain("[1] Lisbon trip");
    expect(answer!.messages.at(-1)!.content).toContain("tram 28");
    // Only the note asked about: no search call.
    host.requests.length = 0;
    host.answer(() => "It's about trams [1].");
    const only = await client.action(api.ai.ask, { scope: SCOPE, question: "What's this about?", documentId: lisbon, range: "note" });
    expect(host.requests).toHaveLength(1);
    expect(only.sources).toEqual([{ id: lisbon, title: "Lisbon trip" }]);
    expect(await errorOf(client.action(api.ai.ask, { scope: SCOPE, question: "  " }))).toMatchObject({ message: "Ask a question first." });
  });

  test("ask: a request to change notes becomes a plan (with a key), and applying it makes and moves", async () => {
    const host = fakeHost({ keys: ["ai.anthropic"] });
    const { client, note } = await library(host);
    const lisbon = await note("Lisbon trip", [para("l1", "Tram 28.")]);
    host.answer((req) =>
      req.system?.includes("full-text search queries")
        ? JSON.stringify({ queries: ["lisbon"], act: true })
        : JSON.stringify({ reply: "I'll make Trips and move the note.", actions: [{ type: "createFolder", name: "Trips" }, { type: "moveNote", noteId: lisbon, folderName: "Trips" }, { type: "moveNote", noteId: "ghost", folderName: "Trips" }] }),
    );
    const out = await client.action(api.ai.ask, { scope: SCOPE, question: "Put my Lisbon note in a new Trips folder" });
    expect(out.answer).toBe("I'll make Trips and move the note.");
    expect(out.actions).toEqual([{ type: "createFolder", name: "Trips" }, { type: "moveNote", noteId: lisbon, noteTitle: "Lisbon trip", folderName: "Trips" }]);
    const applied = await client.mutation(api.aiActions.apply, { scope: SCOPE, actions: out.actions! });
    expect(applied.folders.map((f) => f.name)).toEqual(["Trips"]);
    expect(applied.moved).toBe(1);
    expect((await client.query(api.documents.get, { documentId: lisbon }))?.document.folderId).toBe(applied.folders[0]!.id);
  });

  test("ask on the device: no plan of changes (it can't fit), an answer instead", async () => {
    const host = fakeHost({ onDevice: true });
    const { client, note } = await library(host);
    await note("Lisbon trip", [para("l1", "Tram 28.")]);
    host.answer((req) => (req.system?.includes("full-text search queries") ? JSON.stringify({ queries: ["lisbon"], act: true }) : "Here's what your notes say [1]."));
    const out = await client.action(api.ai.ask, { scope: SCOPE, question: "Move my Lisbon note to Trips" });
    expect(out.actions).toBeUndefined();
    expect(out.answer).toBe("Here's what your notes say [1].");
  });

  test("brief: recent notes and open tasks, cited", async () => {
    const host = fakeHost({ keys: ["ai.openai"] });
    const { client, note } = await library(host);
    host.answer(() => "never");
    // An empty library answers without calling the model.
    const empty = await client.action(api.ai.brief, { scope: SCOPE, today: "2026-10-20" });
    expect(empty).toMatchObject({ sources: [] });
    expect(host.requests).toHaveLength(0);
    const id = await note("Launch", [para("p", "Beta in May."), todo("t1", "Send the deck", "W", "2026-10-21")]);
    host.answer(() => "## This week\n- Launch prep [1]\n## Up next\n- Send the deck (tomorrow)");
    const out = await client.action(api.ai.brief, { scope: SCOPE, today: "2026-10-20" });
    expect(out.sources).toEqual([{ id, title: "Launch" }]);
    const expected = briefRequest({ today: "2026-10-20", notes: [], tasks: [] });
    expect(host.requests[0]!.system).toBe(withSafety(expected).system);
    expect(host.requests[0]!.messages.at(-1)!.content).toContain('- Send the deck (due 2026-10-21), in "Launch"');
  });

  test("flowchart: the shared request and the shared check", async () => {
    const host = fakeHost({ keys: ["ai.openai"] });
    const { client } = await library(host);
    const reply = JSON.stringify({ nodes: [{ id: "a", text: "Start" }, { id: "b", text: "Ship" }], edges: [{ from: "a", to: "b" }], direction: "LR" });
    host.answer(() => reply);
    const out = await client.action(api.ai.flowchart, { scope: SCOPE, mode: "create", instruction: "How we ship" });
    expect(out).toEqual(parseFlowchartDraft(reply));
    expect(asSent(host.requests[0]!)).toEqual({ system: withSafety(flowchartRequest({ mode: "create", instruction: "How we ship", current: null })).system, prompt: flowchartRequest({ mode: "create", instruction: "How we ship", current: null }).prompt });
    expect(await errorOf(client.action(api.ai.flowchart, { scope: SCOPE, mode: "update", instruction: "Add a step" }))).toMatchObject({ message: "There's no flowchart to update yet." });
  });
});

describe("aiChat.* (conversations on this device)", () => {
  test("send: the answer streams into the message, cites a block, offers follow-ups and a memory, names the chat", async () => {
    const host = fakeHost({ keys: ["ai.anthropic"] });
    const { client, note } = await library(host);
    const lisbon = await note("Lisbon trip", [para("l1", "Take tram 28 to the castle."), para("l2", "Eat pastel de nata in Belem.", "W")]);
    host.answer((req) => {
      if (req.system?.includes("full-text search queries")) return JSON.stringify({ queries: ["castle tram"], act: false });
      if (req.system === withSafety(chatTitleRequest({ question: "", answer: "" })).system) return "Getting to the castle";
      return 'Take tram 28 to the castle [1].\n[[remember]] {"kind": "tone", "text": "Keep answers short"}\n[[follow-ups]] ["What about food?", "Where to stay?"]';
    });
    const conversationId = ulid();
    const sent = await client.action(api.aiChat.send, { scope: SCOPE, conversationId, text: "How do I get to the castle? Keep it short, always." });
    expect(sent.status).toBe("done");
    const got = await client.query(api.aiChat.get, { conversationId });
    expect(got!.conversation).toMatchObject({ id: conversationId, title: "Getting to the castle", ephemeral: false, scope: SCOPE, shared: false, canShare: false });
    const answer = got!.messages.at(-1)!;
    expect(answer).toMatchObject({ role: "assistant", status: "done", text: "Take tram 28 to the castle [1].", suggestions: ["What about food?", "Where to stay?"], memory: { kind: "tone", text: "Keep answers short", status: "proposed" }, live: false, agent: null, credits: null });
    expect(answer.citations).toEqual([{ n: 1, noteId: lisbon, title: "Lisbon trip", blockId: "l1", quote: "Take tram 28 to the castle." }]);
    // The answer request is the shared chat one (follow-ups and the memory rule asked for).
    const chat = host.requests.find((r) => r.system?.includes("[[follow-ups]]"))!;
    expect(chat.system).toBe(withSafety(answerRequest({ notes: [], question: "", history: [], notesOnly: false, focused: false, chat: true, remember: true })).system);
    // The list, pinned, rename, search.
    expect((await client.query(api.aiChat.list, { scope: SCOPE, paginationOpts: { numItems: 10, cursor: null } })).page.map((c) => c.id)).toEqual([conversationId]);
    await client.mutation(api.aiChat.setPinned, { conversationId, pinned: true });
    expect((await client.query(api.aiChat.pinned, { scope: SCOPE })).map((c) => c.id)).toEqual([conversationId]);
    expect((await client.query(api.aiChat.list, { scope: SCOPE, search: "castle", paginationOpts: { numItems: 10, cursor: null } })).page).toHaveLength(1);
    await client.mutation(api.aiChat.rename, { conversationId, title: "  Castle  " });
    expect((await client.query(api.aiChat.get, { conversationId }))!.conversation.title).toBe("Castle");
    // Saving the offered memory: it's then in every request's system prompt.
    await client.mutation(api.aiMemory.saveProposal, { messageId: answer.id });
    const memory = await client.query(api.aiMemory.list, {});
    expect(memory).toMatchObject({ on: true, items: [{ kind: "tone", text: "Keep answers short", source: "chat", workspace: null }] });
    host.requests.length = 0;
    host.answer(() => "Shorter.");
    await client.action(api.ai.write, { scope: SCOPE, task: "improve", text: "A long sentence to improve." });
    expect(host.requests[0]!.system).toContain(memoryPrompt([{ kind: "tone", text: "Keep answers short" }])!);
    // Export and save as a note.
    const md = await client.query(api.aiChat.exportMarkdown, { conversationId });
    expect(md.filename).toBe("Castle.md");
    expect(md.markdown).toContain("Take tram 28 to the castle [1].");
    const saved = await client.mutation(api.aiChat.saveAsNote, { conversationId, messageId: answer.id });
    expect((await client.query(api.documents.get, { documentId: saved.id }))?.document.title).toBe("How do I get to the castle? Keep it short, always.");
    const all = await client.query(api.aiChat.exportAll, { paginationOpts: { numItems: 10, cursor: null } });
    expect(all.page.map((f) => f.name)).toEqual(["Castle"]);
    await client.mutation(api.aiChat.remove, { conversationId });
    expect(await client.query(api.aiChat.get, { conversationId })).toBeNull();
  });

  test("regenerate and edit replace the last answer; web and files are refused on the answer, not thrown", async () => {
    const host = fakeHost({ keys: ["ai.openai"] });
    const { client } = await library(host);
    host.answer((req) => (req.system?.includes("full-text search queries") ? JSON.stringify({ queries: ["x"] }) : req.system?.includes("name conversations") ? "Hi" : "Answer one."));
    const conversationId = ulid();
    await client.action(api.aiChat.send, { scope: SCOPE, conversationId, text: "Hello?" });
    host.answer((req) => (req.system?.includes("full-text search queries") ? JSON.stringify({ queries: ["x"] }) : "Answer two."));
    await client.action(api.aiChat.regenerate, { conversationId });
    let got = await client.query(api.aiChat.get, { conversationId });
    expect(got!.messages.map((m) => m.text)).toEqual(["Hello?", "Answer two."]);
    await client.action(api.aiChat.edit, { conversationId, messageId: got!.messages[0]!.id, text: "Hello again?" });
    got = await client.query(api.aiChat.get, { conversationId });
    expect(got!.messages.map((m) => m.text)).toEqual(["Hello again?", "Answer two."]);
    const web = await client.action(api.aiChat.send, { scope: SCOPE, conversationId, text: "Search the web", web: true });
    expect(web.status).toBe("error");
    got = await client.query(api.aiChat.get, { conversationId });
    expect(got!.messages.at(-1)!.error).toEqual({ code: "forbidden", message: "The AI model in use can't search the web." });
  });

  test("history off: a conversation lasts only while its chat is open", async () => {
    const host = fakeHost({ keys: ["ai.openai"] });
    const { client } = await library(host);
    await client.mutation(api.users.updateProfile, { aiPrefs: { history: false } });
    host.answer((req) => (req.system?.includes("full-text search queries") ? JSON.stringify({ queries: ["x"] }) : "Hi."));
    const conversationId = ulid();
    await client.action(api.aiChat.send, { scope: SCOPE, conversationId, text: "Hello?" });
    expect((await client.query(api.aiChat.get, { conversationId }))!.conversation.ephemeral).toBe(true);
    expect((await client.query(api.aiChat.list, { scope: SCOPE, paginationOpts: { numItems: 10, cursor: null } })).page).toEqual([]);
    await client.mutation(api.aiChat.discard, { conversationId });
    expect(await client.query(api.aiChat.get, { conversationId })).toBeNull();
  });

  test("memory in Settings: add, update, remove, clear", async () => {
    const { client } = await library(fakeHost({ onDevice: true }));
    const id = await client.mutation(api.aiMemory.add, { kind: "language", text: "  Use British spelling " });
    expect(await client.mutation(api.aiMemory.add, { kind: "language", text: "use british spelling" })).toBe(id);
    await client.mutation(api.aiMemory.update, { id, text: "Use British English" });
    expect((await client.query(api.aiMemory.list, {})).items.map((i) => i.text)).toEqual(["Use British English"]);
    await client.mutation(api.aiMemory.remove, { id });
    await client.mutation(api.aiMemory.add, { kind: "tone", text: "Warm" });
    expect(await client.mutation(api.aiMemory.clear, {})).toBe(1);
    expect(await errorOf(client.mutation(api.aiMemory.add, { kind: "tone", text: "x" }))).toMatchObject({ message: "Write what to remember first." });
  });
});

describe("blocks", () => {
  test("mind maps: the shared request, the shared strict check; a PDF isn't read here", async () => {
    const host = fakeHost({ onDevice: true });
    const { client, note } = await library(host);
    const reply = JSON.stringify({ root: { text: "Garden", children: [{ text: "Vegetables", children: [{ text: "Tomatoes" }] }, { text: "Flowers" }] } });
    host.answer(() => reply);
    const made = await client.action(api.mindmapAi.generate, { scope: SCOPE, source: "prompt", instruction: "Plan my garden", layout: "right" });
    // Ids are new each time; the map is the shared check's.
    const outline = (data: string) => (JSON.parse(data) as { nodes: { text: string; parent: string | null }[] }).nodes.map((n) => n.text);
    expect(outline(made.data)).toEqual(outline(parseMapReply(reply, { layout: "right" })!));
    expect(JSON.parse(made.data).layout).toBe("right");
    expect(asSent(host.requests[0]!)).toEqual({ system: withSafety(mapPromptRequest({ source: "prompt", instruction: "Plan my garden" })).system, prompt: mapPromptRequest({ source: "prompt", instruction: "Plan my garden" }).prompt });
    const id = await note("Garden", [para("g", "Tomatoes and roses.")]);
    await client.action(api.mindmapAi.generate, { scope: SCOPE, source: "note", documentId: id });
    expect(host.requests.at(-1)!.messages.at(-1)!.content).toContain("untrusted_note");
    expect(await errorOf(client.action(api.mindmapAi.generate, { scope: SCOPE, source: "file", documentId: id, fileId: "f" }))).toMatchObject({ code: "forbidden", message: OFF_HERE });
    const map = made.data;
    const root = JSON.parse(map).nodes[0].id as string;
    host.answer(() => JSON.stringify({ ideas: [{ text: "Herbs" }, { text: "Fruit trees" }, { text: "Vegetables" }] }));
    expect((await client.action(api.mindmapAi.expand, { scope: SCOPE, data: map, nodeId: root })).ideas.map((i) => i.text)).toEqual(["Herbs", "Fruit trees"]);
    host.answer(() => "## Summary\nA garden plan.");
    expect((await client.action(api.mindmapAi.summarize, { scope: SCOPE, data: map })).markdown).toContain("A garden plan.");
    host.answer(() => JSON.stringify({ tasks: ["Buy seeds", "Dig beds"] }));
    expect((await client.action(api.mindmapAi.tasks, { scope: SCOPE, data: map, nodeIds: [] })).tasks).toEqual(["Buy seeds", "Dig beds"]);
    host.answer(() => reply);
    expect((await client.action(api.mindmapAi.tidy, { scope: SCOPE, data: map })).data).toBeTruthy();
    host.answer(() => "not json");
    expect(await errorOf(client.action(api.mindmapAi.tidy, { scope: SCOPE, data: map }))).toMatchObject({ message: "Foli AI couldn't tidy the map. Try again." });
    expect(await errorOf(client.action(api.mindmapAi.expand, { scope: SCOPE, data: map, nodeId: "gone" }))).toMatchObject({ message: "That idea isn't in the mind map anymore." });
  });

  test("tables: edit, clean, formula, explain", async () => {
    const host = fakeHost({ onDevice: true });
    const { client } = await library(host);
    const table = { rows: [["Item", "Price", "Qty", "Total"], ["Apples", "1.5", "4", "=Price * Qty"], ["Pears", "2", "3", ""]], headerRow: true };
    host.answer(() => JSON.stringify({ rows: [["Item", "Price"], ["Apples", "1.5"]], summary: "Removed a column." }));
    const edited = await client.action(api.tableAi.edit, { scope: SCOPE, table, instruction: "Drop Qty" });
    expect(edited).toEqual(parseTableReply(JSON.stringify({ rows: [["Item", "Price"], ["Apples", "1.5"]], summary: "Removed a column." })));
    expect(asSent(host.requests[0]!)).toEqual({ system: withSafety(tableEditRequest(tableOf(table)!, "Drop Qty")).system, prompt: tableEditRequest(tableOf(table)!, "Drop Qty").prompt });
    host.answer(() => JSON.stringify({ rows: [["Item", "Price"], ["Apples", "1.50"]], summary: "Fixed a format." }));
    expect((await client.action(api.tableAi.clean, { scope: SCOPE, table })).summary).toBe("Fixed a format.");
    host.answer(() => JSON.stringify({ formula: "=Price * Qty", explanation: "Price times quantity." }));
    expect(await client.action(api.tableAi.formula, { scope: SCOPE, table, instruction: "Total", row: 2, column: 3 })).toEqual({ formula: "=Price * Qty", explanation: "Price times quantity." });
    host.answer(() => JSON.stringify({ summary: "One fruit.", points: ["Apples."] }));
    expect(await client.action(api.tableAi.explain, { scope: SCOPE, table })).toEqual({ summary: "One fruit.", points: ["Apples."] });
    expect(await errorOf(client.action(api.tableAi.explain, { scope: SCOPE, table: { rows: [[""]], headerRow: false } }))).toMatchObject({ message: "The table is empty. Add a few rows first." });
  });

  test("sticky notes: group, sum up, ideas, tasks, write up; photos aren't read here", async () => {
    const host = fakeHost({ onDevice: true });
    const { client } = await library(host);
    const board = JSON.stringify({ v: 1, notes: [{ id: "s1", text: "Faster sign up", color: "yellow", x: 0, y: 0 }, { id: "s2", text: "Dark mode", color: "blue", x: 200, y: 0 }, { id: "s3", text: "Fewer fields", color: "yellow", x: 0, y: 200 }] });
    host.answer(() => JSON.stringify({ groups: [{ label: "Onboarding", ids: ["s1", "s3"] }, { label: "Look", ids: ["s2"] }] }));
    const grouped = await client.action(api.stickiesAi.cluster, { scope: SCOPE, board });
    expect(grouped.groups.map((g) => g.label)).toEqual(["Onboarding", "Look"]);
    const b = promptBoardOf(board, 2);
    expect("board" in b && asSent(host.requests[0]!).prompt === clusterRequest(b.board).prompt).toBe(true);
    host.answer(() => JSON.stringify({ summary: "Sign up speed matters most." }));
    expect((await client.action(api.stickiesAi.summarize, { scope: SCOPE, board })).summary).toBe("Sign up speed matters most.");
    host.answer(() => JSON.stringify({ ideas: [{ text: "Magic links", color: "green" }, { text: "Dark mode", color: "blue" }] }));
    expect((await client.action(api.stickiesAi.ideas, { scope: SCOPE, board })).ideas.map((i) => i.text)).toEqual(["Magic links"]);
    host.answer(() => JSON.stringify({ tasks: [{ noteId: "s1", task: "Cut the form to two fields", owner: "Sam" }] }));
    expect((await client.action(api.stickiesAi.tasks, { scope: SCOPE, board, noteIds: ["s1"] })).tasks).toEqual([{ noteId: "s1", text: "Cut the form to two fields", owner: "Sam" }]);
    host.answer(() => JSON.stringify({ title: "Retro", summary: "Good sprint.", nextSteps: ["Ship dark mode"] }));
    expect(await client.action(api.stickiesAi.writeUp, { scope: SCOPE, board })).toEqual({ title: "Retro", summary: "Good sprint.", nextSteps: ["Ship dark mode"] });
    expect(await errorOf(client.action(api.stickiesAi.photo, { scope: SCOPE, image: { mimeType: "image/png", data: "AAAA" } }))).toMatchObject({ code: "forbidden" });
    expect(await errorOf(client.action(api.stickiesAi.cluster, { scope: SCOPE, board: JSON.stringify({ v: 1, notes: [] }) }))).toMatchObject({ message: "Add at least 2 notes with text first." });
  });

  test("charts: assist and from words (numbers from the note)", async () => {
    const host = fakeHost({ onDevice: true });
    const { client, note } = await library(host);
    const chart = JSON.stringify({ kind: "bar", columns: [{ id: "c1", name: "Month" }, { id: "c2", name: "Sales" }], rows: [["Jan", 10], ["Feb", 12]] });
    host.answer(() => JSON.stringify({ kind: "line", sort: "none", reason: "Months run in order." }));
    const patch = await client.action(api.chartAi.assist, { scope: SCOPE, task: "suggest", chart });
    expect(patch).toBeTruthy();
    const id = await note("Budget", [para("b", "Rent 1200, food 400.")]);
    host.answer(() => JSON.stringify({ kind: "bar", title: "Budget", columns: ["Item", "Cost"], rows: [["Rent", 1200], ["Food", 400]] }));
    const drawn = await client.action(api.chartAi.fromWords, { scope: SCOPE, instruction: "Chart my budget", documentId: id });
    expect(typeof drawn.data).toBe("string");
    expect(host.requests.at(-1)!.messages.at(-1)!.content).toContain("Rent 1200");
    expect(await errorOf(client.action(api.chartAi.assist, { scope: SCOPE, task: "suggest", chart: "{}" }))).toMatchObject({ message: "Add some data to the chart first." });
  });

  test("wireframes with a key: draw, vary, refine", async () => {
    const host = fakeHost({ keys: ["ai.google"] });
    const { client } = await library(host);
    const screens = (n: number) => JSON.stringify({ screens: Array.from({ length: n }, (_, i) => ({ name: `Screen ${i + 1}`, frame: "phone", parts: [{ kind: "heading", text: `Hello ${i}` }] })) });
    host.answer(() => screens(1));
    const drawn = await client.action(api.wireframeAi.draw, { scope: SCOPE, instruction: "Sign in" });
    host.answer(() => screens(5));
    const one = JSON.stringify({ ...drawn, screens: [drawn.screens[0]], items: drawn.items.filter((p) => p.screen === drawn.screens[0]!.id), links: [] });
    expect((await client.action(api.wireframeAi.vary, { scope: SCOPE, screen: one })).screens).toHaveLength(3);
    host.answer(() => screens(1));
    expect((await client.action(api.wireframeAi.refine, { scope: SCOPE, screen: one, instruction: "Add a link" })).screens).toHaveLength(1);
  });
});

describe("notes: to-dos, translation, drafts", () => {
  test("find to-dos: the whole note or a selection, owners matched to the library's one person", async () => {
    const host = fakeHost({ onDevice: true });
    const { client, note } = await library(host);
    const id = await note("Meeting", [para("m", "Sam will send the deck on Monday.")]);
    host.answer(() => JSON.stringify({ items: [{ text: "Send the deck", owner: "Sam", when: "on Monday", quote: "Sam will send the deck on Monday." }] }));
    const found = await client.action(api.aiTodos.find, { scope: SCOPE, documentId: id });
    expect(found.people).toEqual([{ profileId: expect.any(String), displayName: "Sam", isYou: true }]);
    expect(found.items).toEqual([{ text: "Send the deck", owner: "Sam", when: "on Monday", quote: "Sam will send the deck on Monday.", assigneeId: found.people[0]!.profileId, match: "matched" }]);
    expect(await client.query(api.aiTodos.people, { documentId: id })).toEqual(found.people);
    const empty = await note("Empty");
    expect(await errorOf(client.action(api.aiTodos.find, { scope: SCOPE, documentId: empty }))).toMatchObject({ message: "There's nothing in this note to find to-dos in yet." });
  });

  test("translate a note: as a new note beside it, or as new text with a version saved first", async () => {
    const host = fakeHost({ onDevice: true });
    const { client, note } = await library(host);
    const id = await note("Trip", [para("p1", "Read the guide."), para("p2", "Pack light.", "W")]);
    host.answer((req) => {
      const segments = JSON.parse(/\{"segments":[\s\S]*?\]\}/.exec(req.messages.at(-1)!.content)![0]).segments as { i: number; t: string }[];
      return JSON.stringify({ segments: segments.map((s) => ({ i: s.i, t: `ES ${s.t}` })) });
    });
    const copy = await client.action(api.aiStudy.translateNote, { scope: SCOPE, documentId: id, language: "Spanish", output: "note" });
    expect(copy).toMatchObject({ title: "Trip (Spanish)", untranslated: 0 });
    const blocks = await client.query(api.blocks.list, { documentId: copy.id! });
    expect(JSON.stringify(blocks)).toContain("ES Read the guide.");
    // No preferences in a translation (noMemory), and the device gets one request at a time.
    expect(host.requests.every((r) => !r.system?.includes("<preferences>"))).toBe(true);
    const replace = await client.action(api.aiStudy.translateNote, { scope: SCOPE, documentId: id, language: "Spanish", output: "replace" });
    expect(replace.preview).toContain("ES Pack light.");
    expect(replace.translations!.map((t) => t.id).sort()).toEqual(["p1", "p2"]);
    expect(await client.mutation(api.aiStudy.versionBeforeReplace, { documentId: id })).toMatchObject({ versionId: expect.any(String) });
  });

  test("save a generated page as a note or a template", async () => {
    const { client } = await library(fakeHost({ onDevice: true }));
    const { id } = await client.mutation(api.aiWriting.saveDraft, { scope: SCOPE, kind: "note", title: "# Weekly plan.", markdown: "## Monday\n- [ ] Plan" });
    const doc = await client.query(api.documents.get, { documentId: id });
    expect(doc?.document).toMatchObject({ title: "Weekly plan", kind: "document" });
    const t = await client.mutation(api.aiWriting.saveDraft, { scope: SCOPE, kind: "template", title: "", markdown: "## Notes" });
    expect((await client.query(api.documents.get, { documentId: t.id }))?.document).toMatchObject({ title: "New template", kind: "template" });
  });
});

describe("keys stay native", () => {
  test("the page can set, check and delete a key but never read one back", async () => {
    const host = fakeHost();
    configureLocalAiHost(() => ({ ai: host.ai, secrets: host.secrets }));
    await host.secrets.set("ai.openai", "sk-test-abcdefghijklmnopqrstuv");
    const state = await refreshLocalAi();
    expect(state.caps?.keys).toEqual({ "ai.openai": true, "ai.anthropic": false, "ai.google": false });
    expect(JSON.stringify(state)).not.toContain("sk-test");
    // The bridge has no way to read one.
    expect(Object.keys(host.secrets).sort()).toEqual(["delete", "has", "set"]);
    await host.secrets.delete("ai.openai");
    expect((await refreshLocalAi()).active).toBeNull();
  });
});
