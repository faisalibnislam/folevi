// Exporting AI conversations (convex/aiChat.ts): Markdown (one conversation, or one answer such as an
// agent's or a research report), "Export all conversations" a page at a time (history-off ones left
// out), and Save as note with cited notes as page links.
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { conversationFilename, conversationMarkdown } from "../../convex/lib/ai/chat";
import { inWorkspace, person, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

/** One exchange in a conversation of `p`'s, the answer citing `cites` and a web page. */
async function exchange(t: T, p: Person, conversationId: string, question: string, answer: string, cites: { id: string; title: string }[] = [], agent = false) {
  const { messageId } = await p.as.mutation(internal.aiChat.post, { mode: "send", scope: p.scope, conversationId, text: question, ...(agent ? { agent: true } : {}) });
  if (!agent) await t.mutation(internal.aiChat.finishMessage, { messageId, status: "done", text: answer, citations: cites.map((c, i) => ({ n: i + 1, noteId: c.id, title: c.title })), webCitations: [{ n: cites.length + 1, url: "https://example.com/a", title: "A [guide]", domain: "example.com" }] });
  return messageId;
}

describe("Markdown", () => {
  test("the format: title, turns, sources, an agent's changes; file names are safe", () => {
    const md = conversationMarkdown("Plans", [{ role: "user", text: "Q?" }, { role: "assistant", text: "A [1].", citations: [{ n: 1, title: "Note" }], webCitations: [{ n: 2, title: "Web [x]", url: "https://x.y" }], changes: [{ summary: "Rename “Note”", status: "applied" }, { summary: "Move it", status: "failed" }] }], Date.parse("2026-10-10T00:00:00Z"));
    expect(md).toBe("# Plans\n\n_Exported from Folevi AI on 2026-10-10._\n\n## You\n\nQ?\n\n## Folevi AI\n\nA [1].\n\nChanges:\n- Rename “Note” (done)\n- Move it (couldn't be done)\n\nSources:\n- [1] Note\n- [2] [Web x](https://x.y)\n");
    // Without a title: just the messages (one answer copied on its own).
    expect(conversationMarkdown(null, [{ role: "assistant", text: "Only this." }], 0)).toBe("## Folevi AI\n\nOnly this.\n");
    expect(conversationFilename('a/b: "c"?')).toBe("a b c");
    expect(conversationFilename("   ")).toBe("Conversation");
  });

  test("one conversation, or one answer with its question (an agent's report lists its changes)", async () => {
    const t = setup();
    const a = await person(t, "export-one@example.com");
    const note = (await a.as.mutation(api.documents.create, { scope: a.scope, title: "Trip" })).id;
    const conversationId = ulid();
    await exchange(t, a, conversationId, "Where to?", "The coast [1].", [{ id: note, title: "Trip" }]);
    const agentAnswer = await exchange(t, a, conversationId, "Rename the trip note", "", [], true);
    await t.mutation(internal.aiAgent.finish, { messageId: agentAnswer, text: "Here's the change.", steps: [], operations: [{ id: "op1", kind: "rename_note", summary: "Rename “Trip”", status: "proposed", noteId: note, noteTitle: "Trip", title: "Coast trip", fromTitle: "Trip" }] });
    await a.as.mutation(api.aiChat.rename, { conversationId, title: "Trip: plans/ideas" });

    const all = await a.as.query(api.aiChat.exportMarkdown, { conversationId });
    expect(all.filename).toBe("Trip plans ideas.md");
    expect(all.markdown).toMatch(/^# Trip: plans\/ideas\n/);
    expect(all.markdown).toContain("## You\n\nWhere to?\n\n## Folevi AI\n\nThe coast [1].");
    expect(all.markdown).toContain("Sources:\n- [1] Trip\n- [2] [A guide](https://example.com/a)");
    expect(all.markdown).toContain("Changes:\n- Rename “Trip” (proposed)");

    const one = await a.as.query(api.aiChat.exportMarkdown, { conversationId, messageId: agentAnswer });
    expect(one.markdown).toBe("## You\n\nRename the trip note\n\n## Folevi AI\n\nHere's the change.\n\nChanges:\n- Rename “Trip” (proposed)\n");
    // The person's own message isn't an answer to export on its own.
    const question = (await a.as.query(api.aiChat.get, { conversationId }))!.messages[0]!.id;
    await expect(a.as.query(api.aiChat.exportMarkdown, { conversationId, messageId: question })).rejects.toThrow(/isn't there/);
  });
});

describe("export all", () => {
  test("every kept conversation, page by page, in a folder per place; history-off ones are left out", async () => {
    const t = setup();
    const a = await person(t, "export-all@example.com");
    for (let i = 0; i < 12; i++) await exchange(t, a, ulid(), `Personal question ${i}`, `Answer ${i}`);
    const { workspaceId } = await teamWorkspace(a, "Studio");
    a.scope = inWorkspace(workspaceId);
    const inStudio = ulid();
    await exchange(t, a, inStudio, "Studio question", "Studio answer");
    await a.as.mutation(api.users.updateProfile, { aiPrefs: { history: false } });
    await exchange(t, a, ulid(), "Not kept", "Gone soon");

    const files: { folder: string; name: string; markdown: string }[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: { page: typeof files; isDone: boolean; continueCursor: string } = await a.as.query(api.aiChat.exportAll, { paginationOpts: { numItems: 50, cursor } });
      // At most ten conversations a page, however many are asked for.
      expect(page.page.length).toBeLessThanOrEqual(10);
      files.push(...page.page);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(files).toHaveLength(13);
    expect(files.filter((f) => f.folder === "Personal")).toHaveLength(12);
    expect(files.filter((f) => f.folder === "Studio").map((f) => f.markdown)).toEqual([expect.stringContaining("Studio answer")]);
    expect(files.some((f) => f.markdown.includes("Not kept"))).toBe(false);
    // Only your own.
    const b = await person(t, "export-all-other@example.com");
    expect((await b.as.query(api.aiChat.exportAll, { paginationOpts: { numItems: 10, cursor: null } })).page).toEqual([]);
  });
});

describe("save as note", () => {
  test("a conversation becomes a note with cited notes as page links; in a workspace it starts restricted", async () => {
    const t = setup();
    const a = await person(t, "export-note@example.com");
    const { scope } = await teamWorkspace(a, "Notes Co");
    a.scope = scope;
    const plans = (await a.as.mutation(api.documents.create, { scope, title: "Launch plans" })).id;
    const conversationId = ulid();
    const answer = await exchange(t, a, conversationId, "When do we launch?", "In May [1].", [{ id: plans, title: "Launch plans" }]);
    await a.as.mutation(api.aiChat.rename, { conversationId, title: "Launch date" });

    const { id } = await a.as.mutation(api.aiChat.saveAsNote, { conversationId });
    const doc = await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", id)).unique())!);
    expect(doc).toMatchObject({ title: "Launch date", accessMode: "restricted" });
    expect(doc.workspaceId).toBeDefined();
    const blocks = (await a.as.query(api.blocks.list, { documentId: id }))!.blocks;
    const link = blocks.flatMap((b) => b.text).find((n) => n.type === "pageLink");
    expect(link).toMatchObject({ type: "pageLink", documentId: plans, label: "Launch plans" });
    const plain = blocks.map((b) => b.text.map((n) => ("text" in n ? n.text : "")).join("")).join("\n");
    expect(plain).toContain("When do we launch?");
    expect(plain).toContain("In May [1].");
    expect(plain).not.toMatch(/FoleviNoteRef/);
    // Web sources stay links to the page.
    expect(JSON.stringify(blocks)).toContain("https://example.com/a");

    // One answer on its own, titled from its question.
    const single = await a.as.mutation(api.aiChat.saveAsNote, { conversationId, messageId: answer });
    expect(await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", single.id)).unique())!.title)).toBe("When do we launch?");
  });

  test("a cited note you can no longer open is written as its title, not a link; nothing to save is refused", async () => {
    const t = setup();
    const a = await person(t, "export-gone@example.com");
    const note = (await a.as.mutation(api.documents.create, { scope: a.scope, title: "Old idea" })).id;
    const conversationId = ulid();
    await exchange(t, a, conversationId, "Ideas?", "One [1].", [{ id: note, title: "Old idea" }]);
    await a.as.mutation(api.documents.moveToTrash, { documentId: note });
    const { id } = await a.as.mutation(api.aiChat.saveAsNote, { conversationId });
    const blocks = (await a.as.query(api.blocks.list, { documentId: id }))!.blocks;
    expect(blocks.flatMap((b) => b.text).some((n) => n.type === "pageLink")).toBe(false);
    expect(blocks.some((b) => b.text.some((n) => n.type === "text" && n.text === "[1] Old idea"))).toBe(true);
    // In Personal it's just yours (not restricted: there's no one else).
    expect(await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", id)).unique())!.accessMode)).toBe("workspace");

    const empty = await a.as.mutation(api.aiChat.create, { scope: a.scope });
    await expect(a.as.mutation(api.aiChat.saveAsNote, { conversationId: empty })).rejects.toThrow(/nothing to save/);
  });
});
