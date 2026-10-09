// Sharing AI conversations with a workspace (convex/aiSharing.ts, docs/AI_ASSISTANT.md "Sharing"): only on
// request, only workspace conversations, read-only for members, visible to a member only while they can
// open every note it depends on (checked on every read), uploads kept private, runs without Approve or
// Undo, unshare at any time, and an audit-style log with counts only. No Gemini key, so nothing is sent.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { messageNoteIds, researchNoteIds, runNoteIds } from "../../convex/lib/ai/sharing";
import { inWorkspace, join, person, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

afterEach(() => {
  vi.restoreAllMocks();
});

/** An owner and two members (editors) in a team workspace, each pointed at it, with two workspace notes. */
async function team(t: T) {
  const owner = await person(t, "share-owner@example.com");
  const member = await person(t, "share-member@example.com");
  const other = await person(t, "share-other@example.com");
  const { workspaceId, scope } = await teamWorkspace(owner, "Sharing");
  await join(t, owner, member, "share-member@example.com", workspaceId, "editor");
  await join(t, owner, other, "share-other@example.com", workspaceId, "editor");
  for (const p of [owner, member, other]) p.scope = scope;
  const plans = (await owner.as.mutation(api.documents.create, { scope, title: "Launch plans" })).id;
  const budget = (await owner.as.mutation(api.documents.create, { scope, title: "Budget" })).id;
  return { owner, member, other, workspaceId, scope, plans, budget };
}

/** A conversation of `p`'s with one question and an answer citing `cites` (as an answer would be stored). */
async function conversation(t: T, p: Person, cites: { id: string; title: string }[], o: { context?: { kind: "note"; ids: string[] } } = {}) {
  const conversationId = ulid();
  const { messageId } = await p.as.mutation(internal.aiChat.post, { mode: "send", scope: p.scope, conversationId, text: "What's the plan?", context: o.context });
  await t.mutation(internal.aiChat.finishMessage, { messageId, status: "done", text: `It's in your notes${cites.map((_, i) => ` [${i + 1}]`).join("")}.`, citations: cites.map((c, i) => ({ n: i + 1, noteId: c.id, title: c.title })), webCitations: [{ n: cites.length + 1, url: "https://example.com/guide", title: "A guide", domain: "example.com" }] });
  return { conversationId, messageId };
}

const sharedList = async (p: Person) => (await p.as.query(api.aiSharing.list, { scope: p.scope })).map((c) => c.id);

describe("which notes a conversation depends on", () => {
  test("citations, proposed moves and what they applied, agent runs and research sources", () => {
    expect(messageNoteIds({ citations: [{ n: 1, noteId: "a", title: "A" }], actions: [{ type: "moveNote", noteId: "b", noteTitle: "B" }, { type: "createFolder", name: "X" }], actionsOutcome: { kind: "applied", folders: [], notes: [{ id: "c", title: "C" }], moved: 1 } })).toEqual(["a", "b", "c"]);
    expect(messageNoteIds({})).toEqual([]);
    const op = { id: "1", kind: "merge_notes" as const, summary: "Merge", status: "applied" as const, noteId: "t", sources: [{ id: "s1", title: "S1" }], result: { noteId: "r" } };
    expect(runNoteIds({ operations: [op] })).toEqual(["t", "s1", "r"]);
    expect(researchNoteIds({ sources: [{ n: 1, kind: "note", id: "n", title: "N" }, { n: 2, kind: "web", url: "https://x.y", title: "Y", domain: "x.y" }] })).toEqual(["n"]);
  });
});

describe("sharing", () => {
  test("Personal conversations can't be shared, and history-off ones aren't kept to share", async () => {
    const t = setup();
    const a = await person(t, "share-personal@example.com");
    const { conversationId } = await conversation(t, a, []);
    await expect(a.as.mutation(api.aiSharing.share, { conversationId })).rejects.toThrow(/Personal conversations can't be shared/);
    expect((await a.as.query(api.aiChat.get, { conversationId }))!.conversation).toMatchObject({ shared: false, canShare: false });

    const { workspaceId } = await teamWorkspace(a, "Mine");
    a.scope = inWorkspace(workspaceId);
    await a.as.mutation(api.users.updateProfile, { aiPrefs: { history: false } });
    const ephemeral = await conversation(t, a, []);
    await expect(a.as.mutation(api.aiSharing.share, { conversationId: ephemeral.conversationId })).rejects.toThrow(/History is off/);
  });

  test("a shared conversation is read-only for members, shows under Shared with you, and unsharing hides it", async () => {
    const t = setup();
    const w = await team(t);
    const { conversationId, messageId } = await conversation(t, w.owner, [{ id: w.plans, title: "Launch plans" }]);
    // Nothing is shared until its person asks.
    expect(await sharedList(w.member)).toEqual([]);
    expect(await w.member.as.query(api.aiSharing.get, { conversationId })).toBeNull();

    const log = vi.spyOn(console, "log");
    await w.owner.as.mutation(api.aiSharing.share, { conversationId });
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes("ai_chat.share"))!;
    expect(JSON.parse(line)).toMatchObject({ event: "audit.user", action: "ai_chat.share", targetType: "aiConversation", targetId: conversationId, notes: 1 });
    // Counts only: never the title, the question or the answer.
    expect(line).not.toMatch(/plan\?|Launch|your notes/);

    const own = (await w.owner.as.query(api.aiChat.get, { conversationId }))!;
    expect(own.conversation).toMatchObject({ shared: true, canShare: true });
    expect((await w.owner.as.query(api.aiChat.list, { scope: w.scope, paginationOpts: { numItems: 10, cursor: null } })).page[0]).toMatchObject({ id: conversationId, shared: true });
    // Your own shared conversation isn't "shared with you".
    expect(await sharedList(w.owner)).toEqual([]);

    const listed = await w.member.as.query(api.aiSharing.list, { scope: w.scope });
    expect(listed).toEqual([expect.objectContaining({ id: conversationId, title: own.conversation.title, by: "share-owner" })]);
    const seen = (await w.member.as.query(api.aiSharing.get, { conversationId }))!;
    expect(seen.conversation).toMatchObject({ id: conversationId, by: "share-owner" });
    expect(seen.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    const answer = seen.messages[1]!;
    expect(answer.citations).toEqual([expect.objectContaining({ noteId: w.plans })]);
    // Web citations are fine to show; the person's credits aren't.
    expect(answer.webCitations).toEqual([expect.objectContaining({ url: "https://example.com/guide" })]);
    expect(answer.credits).toBeNull();

    // Read-only: a member can't open it as their own, continue, rename, pin, stop, delete, export or unshare it.
    expect(await w.member.as.query(api.aiChat.get, { conversationId })).toBeNull();
    await expect(w.member.as.mutation(internal.aiChat.post, { mode: "send", scope: w.scope, conversationId, text: "Me too" })).rejects.toThrow(/isn't there/);
    await expect(w.member.as.mutation(internal.aiChat.post, { mode: "regenerate", conversationId })).rejects.toThrow(/isn't there/);
    await expect(w.member.as.mutation(api.aiChat.rename, { conversationId, title: "Mine now" })).rejects.toThrow(/isn't there/);
    await expect(w.member.as.mutation(api.aiChat.setPinned, { conversationId, pinned: true })).rejects.toThrow(/isn't there/);
    await expect(w.member.as.mutation(api.aiChat.stop, { messageId })).rejects.toThrow(/isn't there/);
    await expect(w.member.as.query(api.aiChat.exportMarkdown, { conversationId })).rejects.toThrow(/isn't there/);
    await expect(w.member.as.mutation(api.aiChat.saveAsNote, { conversationId })).rejects.toThrow(/isn't there/);
    await expect(w.member.as.mutation(api.aiSharing.unshare, { conversationId })).rejects.toThrow(/isn't there/);
    await w.member.as.mutation(api.aiChat.remove, { conversationId });
    expect(await w.owner.as.query(api.aiChat.get, { conversationId })).not.toBeNull();

    // Unshared: gone for everyone else, logged with counts only.
    await w.owner.as.mutation(api.aiSharing.unshare, { conversationId });
    expect(log.mock.calls.some((c) => String(c[0]).includes('"action":"ai_chat.unshare"'))).toBe(true);
    expect(await sharedList(w.member)).toEqual([]);
    expect(await w.member.as.query(api.aiSharing.get, { conversationId })).toBeNull();
    expect((await w.owner.as.query(api.aiChat.get, { conversationId }))!.conversation.shared).toBe(false);
  });

  test("a member sees it only while they can open every cited note, checked on every read", async () => {
    const t = setup();
    const w = await team(t);
    const { conversationId } = await conversation(t, w.owner, [
      { id: w.plans, title: "Launch plans" },
      { id: w.budget, title: "Budget" },
    ]);
    await w.owner.as.mutation(api.aiSharing.share, { conversationId });
    expect(await sharedList(w.member)).toEqual([conversationId]);

    // One cited note restricted to its owner: the member can't open it, so the conversation is gone for them.
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: w.budget, mode: "restricted" });
    expect(await sharedList(w.member)).toEqual([]);
    expect(await w.member.as.query(api.aiSharing.get, { conversationId })).toBeNull();
    // Given access to that page, they see it again.
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: w.budget, mode: "workspace" });
    expect(await sharedList(w.member)).toEqual([conversationId]);

    // A cited note in Trash: gone for members too.
    await w.owner.as.mutation(api.documents.moveToTrash, { documentId: w.plans });
    expect(await sharedList(w.member)).toEqual([]);
    await w.owner.as.mutation(api.documents.restoreFromTrash, { documentId: w.plans });
    expect(await sharedList(w.member)).toEqual([conversationId]);

    // A later answer citing a note the member can't open hides it from then on.
    const secret = (await w.owner.as.mutation(api.documents.create, { scope: w.scope, title: "Salaries" })).id;
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: secret, mode: "restricted" });
    const { messageId } = await w.owner.as.mutation(internal.aiChat.post, { mode: "send", conversationId, text: "And salaries?" });
    await t.mutation(internal.aiChat.finishMessage, { messageId, status: "done", text: "See [1].", citations: [{ n: 1, noteId: secret, title: "Salaries" }] });
    expect(await sharedList(w.member)).toEqual([]);
    expect(await w.member.as.query(api.aiSharing.get, { conversationId })).toBeNull();
    // The owner still sees all of it.
    expect((await w.owner.as.query(api.aiChat.get, { conversationId }))!.messages).toHaveLength(4);
  });

  test("what it's about and an agent run's notes count too", async () => {
    const t = setup();
    const w = await team(t);
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: w.budget, mode: "restricted" });
    // About a note the member can't open.
    const about = await conversation(t, w.owner, [], { context: { kind: "note", ids: [w.budget] } });
    await w.owner.as.mutation(api.aiSharing.share, { conversationId: about.conversationId });
    expect(await sharedList(w.member)).toEqual([]);
    // Pointed at a note they can open instead: visible.
    await w.owner.as.mutation(api.aiChat.setContext, { conversationId: about.conversationId, context: { kind: "note", ids: [w.plans] } });
    expect(await sharedList(w.member)).toEqual([about.conversationId]);

    // An agent run proposing to rename the restricted note.
    const conversationId = ulid();
    const { messageId } = await w.owner.as.mutation(internal.aiChat.post, { mode: "send", scope: w.scope, conversationId, text: "Rename my budget", agent: true });
    await w.owner.as.mutation(api.aiSharing.share, { conversationId });
    expect(await sharedList(w.member)).toContain(conversationId);
    await t.mutation(internal.aiAgent.finish, { messageId, text: "Here's the change.", steps: [], operations: [{ id: "op1", kind: "rename_note", summary: "Rename “Budget”", status: "proposed", noteId: w.budget, noteTitle: "Budget", title: "Budget 2026", fromTitle: "Budget" }] });
    expect(await sharedList(w.member)).not.toContain(conversationId);
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: w.budget, mode: "workspace" });
    expect(await sharedList(w.member)).toContain(conversationId);
  });

  test("agent runs are shown read-only: members can't approve, discard or undo", async () => {
    const t = setup();
    const w = await team(t);
    const conversationId = ulid();
    const { messageId } = await w.owner.as.mutation(internal.aiChat.post, { mode: "send", scope: w.scope, conversationId, text: "Rename the plans", agent: true });
    await t.mutation(internal.aiAgent.finish, { messageId, text: "Here's the change.", steps: [{ tool: "get_note", count: 1, ok: true }], operations: [{ id: "op1", kind: "rename_note", summary: "Rename “Launch plans”", status: "proposed", noteId: w.plans, noteTitle: "Launch plans", title: "Launch", fromTitle: "Launch plans" }] });
    await w.owner.as.mutation(api.aiSharing.share, { conversationId });
    const seen = (await w.member.as.query(api.aiSharing.get, { conversationId }))!;
    const run = seen.messages[1]!.agent!.run!;
    expect(run.operations.map((o) => o.summary)).toEqual(["Rename “Launch plans”"]);
    await expect(w.member.as.action(api.aiAgent.approve, { runId: run.id, operationIds: ["op1"] })).rejects.toThrow();
    await expect(w.member.as.mutation(api.aiAgent.discard, { runId: run.id })).rejects.toThrow();
    await expect(w.member.as.action(api.aiAgent.undo, { runId: run.id })).rejects.toThrow();
    // Nothing changed.
    expect((await w.owner.as.query(api.aiChat.get, { conversationId }))!.messages[1]!.agent!.run!.status).toBe("preview");
  });

  test("uploads stay private ('file not shared'); a note's file shows to members who can open the note", async () => {
    const t = setup();
    const w = await team(t);
    const { conversationId } = await conversation(t, w.owner, [{ id: w.plans, title: "Launch plans" }]);
    const ids = await t.run(async (ctx) => {
      const c = (await ctx.db.query("aiConversations").withIndex("by_public_id", (q) => q.eq("publicId", conversationId)).unique())!;
      const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", w.plans)).unique())!;
      const storageId = await ctx.storage.store(new Blob(["hello"], { type: "text/plain" }));
      const upload = await ctx.db.insert("files", { publicId: ulid(), storageId, workspaceId: c.workspaceId, uploadedBy: c.profileId, conversationId: c._id, filename: "private-notes.txt", mimeType: "text/plain", size: 5, sha256: "x", kind: "attachment", status: "ready", createdAt: Date.now() });
      const noteFile = await ctx.db.insert("files", { publicId: ulid(), storageId, workspaceId: c.workspaceId, documentId: doc._id, uploadedBy: c.profileId, filename: "plan.png", mimeType: "image/png", size: 5, sha256: "x", kind: "image", status: "ready", createdAt: Date.now() });
      const first = (await ctx.db.query("aiMessages").withIndex("by_conversation", (q) => q.eq("conversationId", c._id)).first())!;
      await ctx.db.patch(first._id, { attachments: [upload, noteFile] as Id<"files">[] });
      return { upload, noteFile };
    });
    expect(ids.upload).toBeTruthy();
    await w.owner.as.mutation(api.aiSharing.share, { conversationId });
    // The owner sees both files by name.
    expect((await w.owner.as.query(api.aiChat.get, { conversationId }))!.messages[0]!.attachments.map((f) => f.name)).toEqual(["private-notes.txt", "plan.png"]);
    // A member sees the note's file, and only that an upload wasn't shared (not even its name).
    const files = (await w.member.as.query(api.aiSharing.get, { conversationId }))!.messages[0]!.attachments;
    expect(files.map((f) => [f.name, f.shared])).toEqual([
      ["File not shared", false],
      ["plan.png", true],
    ]);
    expect(JSON.stringify(files)).not.toContain("private-notes");
    // The note with that file restricted: the conversation is gone for them.
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: w.plans, mode: "restricted" });
    expect(await w.member.as.query(api.aiSharing.get, { conversationId })).toBeNull();
  });

  test("gone when its person leaves the workspace; guests and other workspaces never see it", async () => {
    const t = setup();
    const w = await team(t);
    w.member.scope = w.scope;
    const { conversationId } = await conversation(t, w.member, [{ id: w.plans, title: "Launch plans" }]);
    await w.member.as.mutation(api.aiSharing.share, { conversationId });
    expect(await sharedList(w.other)).toEqual([conversationId]);
    expect(await sharedList(w.owner)).toEqual([conversationId]);
    // Someone outside the workspace can't list or open it.
    const outsider = await person(t, "share-outsider@example.com");
    await expect(outsider.as.query(api.aiSharing.list, { scope: w.scope })).rejects.toThrow();
    expect(await outsider.as.query(api.aiSharing.get, { conversationId })).toBeNull();
    // In Personal there's nothing shared with you.
    expect(await w.other.as.query(api.aiSharing.list, { scope: { kind: "personal" } })).toEqual([]);
    // Its person removed from the workspace: gone for the others.
    await w.owner.as.mutation(api.workspaces.removeMember, { workspaceId: w.workspaceId, profileId: w.member.profileId });
    expect(await sharedList(w.other)).toEqual([]);
    expect(await w.other.as.query(api.aiSharing.get, { conversationId })).toBeNull();
  });

  test("a refused question still makes a conversation that can be shared (no AI key)", async () => {
    const t = setup();
    const w = await team(t);
    const conversationId = ulid();
    const sent = await w.owner.as.action(api.aiChat.send, { scope: w.scope, conversationId, text: "What's new this week?" });
    expect(sent.status).toBe("error");
    await w.owner.as.mutation(api.aiSharing.share, { conversationId });
    const seen = (await w.member.as.query(api.aiSharing.get, { conversationId }))!;
    expect(seen.messages.map((m) => [m.role, m.status])).toEqual([
      ["user", "done"],
      ["assistant", "error"],
    ]);
  });
});

