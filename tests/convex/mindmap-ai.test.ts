// Foli AI for mind maps (convex/mindmapAi.ts) through the real actions, with Gemini as a stubbed `fetch`:
// each action's reply is checked before it's returned, the usual gates apply (AI off, nothing sent), notes
// and PDFs are read only for someone who can open them, credits are charged; and Markdown with a
// ```mindmap fence (Foli AI chat, MCP) becomes a mind map block in a note.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { mindmapDataIssue, mindmapToOutline, parseMindmap, SCHEMA_VERSION } from "@folevi/editor-schema";
import { TOOL_BY_NAME } from "../../convex/lib/mcp/tools";
import { AI_MAX_IDEAS, mindmapFence, parseListReply } from "../../convex/lib/mindmapAi";
import { finishWriting } from "../../convex/lib/ai/writing";
import { person, setup, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});

const USAGE = { promptTokenCount: 2_000, candidatesTokenCount: 300 };
const MAP = JSON.stringify({ v: 1, nodes: [{ id: "r", parent: null, text: "Launch" }, { id: "a", parent: "r", text: "Marketing" }, { id: "a1", parent: "a", text: "Blog post" }] });

/** Stubs Gemini with one reply for every call; returns the request bodies. */
function gemini(reply: unknown) {
  process.env.GEMINI_API_KEY = "test-key";
  const bodies: string[] = [];
  const text = typeof reply === "string" ? reply : JSON.stringify(reply);
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(init.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: USAGE }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { bodies, fetchMock };
}

/** A note with a PDF in it (as an uploaded file block leaves it). */
async function noteWithPdf(t: T, p: Person) {
  const note = await p.as.mutation(api.documents.create, { scope: p.scope, title: "Report" });
  const fileId = ulid();
  const bytes = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
  await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([bytes], { type: "application/pdf" }));
    const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", note.id)).unique())!;
    await ctx.db.insert("files", { publicId: fileId, storageId, ownerProfileId: doc.ownerProfileId, workspaceId: doc.workspaceId, documentId: doc._id, uploadedBy: doc.createdBy, filename: "report.pdf", mimeType: "application/pdf", size: bytes.length, sha256: "x", kind: "file", status: "ready", createdAt: Date.now() });
    const now = Date.now();
    await ctx.db.insert("blocks", { blockId: ulid(), documentId: doc._id, ownerProfileId: doc.ownerProfileId, workspaceId: doc.workspaceId, parentId: null, rank: "z", type: "file", schemaVersion: SCHEMA_VERSION, text: [], props: { fileId, name: "report.pdf", size: bytes.length, mimeType: "application/pdf" }, revision: 1, contentRev: 1, positionRev: 1, seq: 1, createdAt: now, updatedAt: now, updatedBy: doc.createdBy });
  });
  return { noteId: note.id, fileId };
}

const credits = async (t: T) => t.run(async (ctx) => (await ctx.db.query("aiCreditHolds").collect()).length);

describe("Foli AI mind maps", () => {
  test("from a prompt: the reply becomes valid block data in the layout asked for; empty prompts are refused", async () => {
    const t = setup();
    const a = await person(t, "mm-prompt@example.com");
    const { bodies } = gemini({ root: { text: "Garden", children: [{ text: "Vegetables", children: [{ text: "Tomatoes" }] }, { text: "Flowers" }] } });
    const { data } = await a.as.action(api.mindmapAi.generate, { scope: a.scope, source: "prompt", instruction: "Plan my garden", layout: "right" });
    expect(mindmapDataIssue(data)).toBeNull();
    const map = parseMindmap(data);
    expect(map.layout).toBe("right");
    expect(mindmapToOutline(map).map((i) => i.text)).toEqual(["Garden", "Vegetables", "Tomatoes", "Flowers"]);
    expect(bodies[0]).toContain("Plan my garden");
    await expect(a.as.action(api.mindmapAi.generate, { scope: a.scope, source: "prompt", instruction: "  " })).rejects.toThrow(/Say what/);
    // Every request settled its hold (charged what Gemini counted).
    expect(await credits(t)).toBe(0);
  });

  test("from the note, from selected text and from a PDF: read only for someone who can open them", async () => {
    const t = setup();
    const a = await person(t, "mm-note@example.com");
    const b = await person(t, "mm-other@example.com");
    const { bodies } = gemini({ root: { text: "Report", children: [{ text: "Findings" }] } });
    const { noteId, fileId } = await noteWithPdf(t, a);
    // The note (as Markdown, wrapped as untrusted data).
    const seeded = (await a.as.query(internal.ai.gather, { scope: a.scope, queries: ["coastal weekend"], limit: 5 })).find((n) => n.title.includes("Coastal"))!;
    await a.as.action(api.mindmapAi.generate, { scope: a.scope, documentId: seeded.id, source: "note" });
    expect(bodies.at(-1)).toContain("untrusted_note");
    expect(bodies.at(-1)).toMatch(/ferry/i);
    // Selected text.
    await a.as.action(api.mindmapAi.generate, { scope: a.scope, documentId: noteId, source: "text", text: "Ferries leave at nine and at one." });
    expect(bodies.at(-1)).toContain("Ferries leave at nine");
    await expect(a.as.action(api.mindmapAi.generate, { scope: a.scope, documentId: noteId, source: "text", text: " " })).rejects.toThrow(/Select some text/);
    // The PDF goes as inline data.
    await a.as.action(api.mindmapAi.generate, { scope: a.scope, documentId: noteId, source: "file", fileId });
    expect(bodies.at(-1)).toContain('"mimeType":"application/pdf"');
    // Someone else can't map the note or its PDF, and nothing is sent for them.
    const sent = bodies.length;
    await expect(b.as.action(api.mindmapAi.generate, { scope: b.scope, documentId: noteId, source: "file", fileId })).rejects.toThrow(/not found/i);
    await expect(b.as.action(api.mindmapAi.generate, { scope: b.scope, documentId: seeded.id, source: "note" })).rejects.toThrow(/not found/i);
    expect(bodies.length).toBe(sent);
    // With "Read attachments" off, the PDF isn't read.
    await t.run(async (ctx) => ctx.db.patch(a.profileId as Id<"profiles">, { aiAttachments: false }));
    await expect(a.as.action(api.mindmapAi.generate, { scope: a.scope, documentId: noteId, source: "file", fileId })).rejects.toThrow(/turned off/);
    expect(bodies.length).toBe(sent);
  });

  test("expand, summarise, tasks and tidy return checked results", async () => {
    const t = setup();
    const a = await person(t, "mm-tools@example.com");
    let s = gemini({ ideas: [{ text: "Blog post" }, { text: "Podcast" }, { text: "Newsletter" }, { text: "Webinar" }] });
    const { ideas } = await a.as.action(api.mindmapAi.expand, { scope: a.scope, data: MAP, nodeId: "a" });
    expect(ideas.map((i) => i.text)).toEqual(["Podcast", "Newsletter", "Webinar"]);
    expect(s.bodies[0]).toContain("Launch");
    expect(s.bodies[0]).toContain("It already has");
    await expect(a.as.action(api.mindmapAi.expand, { scope: a.scope, data: MAP, nodeId: "gone" })).rejects.toThrow(/isn't in the mind map/);

    vi.unstubAllGlobals();
    s = gemini("```markdown\n# Launch\nA launch in two parts.\n- Marketing: a blog post\n```");
    expect((await a.as.action(api.mindmapAi.summarize, { scope: a.scope, data: MAP })).markdown).toBe("A launch in two parts.\n- Marketing: a blog post");
    await expect(a.as.action(api.mindmapAi.summarize, { scope: a.scope, data: "" })).rejects.toThrow(/no mind map/);

    vi.unstubAllGlobals();
    s = gemini({ tasks: ["Write the blog post", "[ ] Write the blog post", "Pick a launch date"] });
    expect((await a.as.action(api.mindmapAi.tasks, { scope: a.scope, data: MAP, nodeIds: ["a"] })).tasks).toEqual(["Write the blog post", "Pick a launch date"]);
    expect(s.bodies[0]).toContain("<branch>");
    expect(s.bodies[0]).not.toContain('\\"text\\":\\"Launch\\",\\"children');

    vi.unstubAllGlobals();
    gemini({ root: { id: "r", text: "Launch plan", children: [{ id: "a", text: "Marketing", children: [{ id: "a1", text: "Blog" }] }] } });
    const tidied = parseMindmap((await a.as.action(api.mindmapAi.tidy, { scope: a.scope, data: MAP })).data);
    expect(tidied.nodes.map((n) => [n.id, n.text])).toEqual([["r", "Launch plan"], ["a", "Marketing"], ["a1", "Blog"]]);
    expect(await credits(t)).toBe(0);
  });

  test("with Foli AI turned off, nothing is sent", async () => {
    const t = setup();
    const a = await person(t, "mm-off@example.com");
    const { fetchMock } = gemini({ ideas: [] });
    await a.as.mutation(api.users.updateProfile, { aiEnabled: false });
    await expect(a.as.action(api.mindmapAi.generate, { scope: a.scope, source: "prompt", instruction: "Anything" })).rejects.toThrow(/turned off/);
    await expect(a.as.action(api.mindmapAi.expand, { scope: a.scope, data: MAP, nodeId: "a" })).rejects.toThrow(/turned off/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("Markdown with a mindmap fence (Foli AI chat, MCP) becomes a mind map block; the tools say how", async () => {
    const t = setup();
    const a = await person(t, "mm-fence@example.com");
    const markdown = "Our plan:\n\n```mindmap\n- Launch\n  - Marketing\n    - Blog post\n  - Product\n```\n";
    const { id } = await a.as.mutation(api.aiWriting.saveDraft, { scope: a.scope, kind: "note", title: "Plan", markdown });
    const blocks = await t.run(async (ctx) => {
      const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", id)).unique())!;
      return ctx.db.query("blocks").withIndex("by_document", (q) => q.eq("documentId", doc._id)).collect();
    });
    const mind = blocks.find((b) => b.type === "mindmap")!;
    expect(mind).toBeTruthy();
    const data = String((mind.props as { data: string }).data);
    expect(mindmapDataIssue(data)).toBeNull();
    expect(mindmapToOutline(parseMindmap(data)).map((i) => i.text)).toEqual(["Launch", "Marketing", "Blog post", "Product"]);
    for (const name of ["create_note", "append_to_note"]) expect(JSON.stringify(TOOL_BY_NAME.get(name)!.inputSchema)).toContain("```mindmap");
  });

  test("the \"Mind map\" writing tool gives a real map: the block's data, strictly checked, and its fence; credits as before", async () => {
    const t = setup();
    const a = await person(t, "mm-writing@example.com");
    const { id } = await a.as.mutation(api.aiWriting.saveDraft, { scope: a.scope, kind: "note", title: "Trip", markdown: "We take the ferry at nine, then hike." });
    const before = await a.as.query(api.billing.credits, { scope: a.scope });
    gemini("Here's the map:\n- Weekend trip\n    - Travel\n        1. Ferry at nine\n    - Hike\n    - Food");
    const out = await a.as.action(api.ai.write, { scope: a.scope, task: "mindMap", documentId: id });
    expect(out.mindmap).toBeTruthy();
    expect(mindmapDataIssue(out.mindmap!)).toBeNull();
    expect(mindmapToOutline(parseMindmap(out.mindmap!)).map((i) => [i.depth, i.text])).toEqual([[0, "Weekend trip"], [1, "Travel"], [2, "Ferry at nine"], [1, "Hike"], [1, "Food"]]);
    // Its Markdown is a ```mindmap fence of the same map (a new note from it gets the block too).
    expect(out.text).toBe("```mindmap\n- Weekend trip\n  - Travel\n    - Ferry at nine\n  - Hike\n  - Food\n```");
    const after = await a.as.query(api.billing.credits, { scope: a.scope });
    expect(after.available).toBeLessThan(before.available);
    expect(await credits(t)).toBe(0);
    // Nothing usable: refused (the hold is settled, nothing is returned).
    vi.unstubAllGlobals();
    gemini("Sorry, I can't help with that.\n\n```\n```");
    await expect(a.as.action(api.ai.write, { scope: a.scope, task: "mindMap", documentId: id })).rejects.toThrow(/couldn't make a mind map/);
    expect(await credits(t)).toBe(0);
  });

  test("a list reply as block data: capped in reading order, every idea under its parent; fences can't be broken out of", () => {
    const long = ["- Centre", ...Array.from({ length: 200 }, (_, i) => `  - Idea ${i}`)].join("\n");
    const data = parseListReply(long)!;
    expect(mindmapDataIssue(data)).toBeNull();
    const map = parseMindmap(data);
    expect(map.nodes).toHaveLength(AI_MAX_IDEAS);
    expect(map.nodes[0]!.text).toBe("Centre");
    expect(parseListReply("")).toBeNull();
    expect(parseListReply("- ")).toBeNull();
    expect(parseListReply("- Only a centre")).toBeNull();
    expect(parseListReply("A paragraph, then another line.\nNo list here.")).toBeNull();
    const fenced = mindmapFence(parseListReply("- Code\n  - ```js trick")!);
    expect(fenced.split("\n").filter((l) => l.includes("```"))).toEqual(["```mindmap", "```"]);
    expect(finishWriting("mindMap", "- A\n  - B").mindmap).toBeTruthy();
    expect(() => finishWriting("mindMap", "No list at all")).toThrow(/couldn't make a mind map/);
  });
});
