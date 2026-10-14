// Comment reactions: six kinds, toggled by anyone who can comment on the page (guests too), shown grouped
// with counts, "mine" and who else; gone with the comment, the page and the reacting person's account.
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { person, PERSONAL, setup, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const text = (s: string) => [{ type: "text", text: s }];

async function newDoc(p: Person, title: string) {
  const id = ulid();
  await p.as.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: "device-reactions",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } as never }],
  });
  return id;
}

/** An owner's page with a comment on it, a guest who may comment, a guest who may only read, and a stranger. */
async function page(t: T) {
  const owner = await person(t, "react-owner@example.com");
  const commenter = await person(t, "react-commenter@example.com");
  const viewer = await person(t, "react-viewer@example.com");
  const stranger = await person(t, "react-stranger@example.com");
  const docId = await newDoc(owner, "Trip plan");
  await owner.as.mutation(api.sharing.grant, { documentId: docId, email: "react-commenter@example.com", role: "commenter" });
  await owner.as.mutation(api.sharing.grant, { documentId: docId, email: "react-viewer@example.com", role: "viewer" });
  const { commentId, threadId } = await owner.as.mutation(api.comments.create, { documentId: docId, body: text("Leave on Friday?") });
  return { owner, commenter, viewer, stranger, docId, commentId, threadId };
}

async function reactionsSeenBy(p: Person, docId: string, commentId: string) {
  const data = await p.as.query(api.comments.threads, { documentId: docId });
  return data.threads.flatMap((th) => th.comments).find((c) => c.id === commentId)!.reactions;
}

async function reactionRows(t: T) {
  return await t.run(async (ctx) => await ctx.db.query("commentReactions").collect());
}

describe("reacting", () => {
  test("toggles on and off, grouped by kind with counts, mine and names", async () => {
    const t = setup();
    const { owner, commenter, docId, commentId } = await page(t);

    expect(await owner.as.mutation(api.comments.react, { commentId, kind: "thumbsUp" })).toEqual({ reacted: true });
    expect(await commenter.as.mutation(api.comments.react, { commentId, kind: "thumbsUp" })).toEqual({ reacted: true });
    expect(await commenter.as.mutation(api.comments.react, { commentId, kind: "idea" })).toEqual({ reacted: true });

    expect(await reactionsSeenBy(owner, docId, commentId)).toEqual([
      { kind: "thumbsUp", count: 2, mine: true, names: ["react-commenter"] },
      { kind: "idea", count: 1, mine: false, names: ["react-commenter"] },
    ]);
    expect((await reactionsSeenBy(commenter, docId, commentId)).map((r) => [r.kind, r.mine])).toEqual([
      ["thumbsUp", true],
      ["idea", true],
    ]);

    // The same kind again takes it back.
    expect(await owner.as.mutation(api.comments.react, { commentId, kind: "thumbsUp" })).toEqual({ reacted: false });
    expect(await reactionsSeenBy(owner, docId, commentId)).toEqual([
      { kind: "thumbsUp", count: 1, mine: false, names: ["react-commenter"] },
      { kind: "idea", count: 1, mine: false, names: ["react-commenter"] },
    ]);
  });

  test("only kinds from the set are accepted", async () => {
    const t = setup();
    const { owner, commentId } = await page(t);
    await expect(owner.as.mutation(api.comments.react, { commentId, kind: "party" as never })).rejects.toThrow();
  });

  test("people who can't comment can't react; readers still see reactions", async () => {
    const t = setup();
    const { owner, viewer, stranger, docId, commentId } = await page(t);
    await owner.as.mutation(api.comments.react, { commentId, kind: "heart" });
    await expect(viewer.as.mutation(api.comments.react, { commentId, kind: "heart" })).rejects.toThrow(/can't react/);
    await expect(stranger.as.mutation(api.comments.react, { commentId, kind: "heart" })).rejects.toThrow(/not found/i);
    expect(await reactionsSeenBy(viewer, docId, commentId)).toEqual([{ kind: "heart", count: 1, mine: false, names: ["react-owner"] }]);
    expect(await reactionRows(t)).toHaveLength(1);
  });

  test("reacting notifies nobody", async () => {
    const t = setup();
    const { owner, commenter, commentId } = await page(t);
    const before = (await owner.as.query(api.notifications.list, {})).length;
    await commenter.as.mutation(api.comments.react, { commentId, kind: "check" });
    expect((await owner.as.query(api.notifications.list, {})).length).toBe(before);
  });
});

describe("cleanup", () => {
  test("deleting a comment (or its thread) deletes its reactions", async () => {
    const t = setup();
    const { owner, commenter, docId, commentId, threadId } = await page(t);
    const { commentId: replyId } = await commenter.as.mutation(api.comments.reply, { threadId, body: text("Saturday works better") });
    await commenter.as.mutation(api.comments.react, { commentId, kind: "eyes" });
    await owner.as.mutation(api.comments.react, { commentId: replyId, kind: "laugh" });
    expect(await reactionRows(t)).toHaveLength(2);

    await owner.as.mutation(api.comments.remove, { commentId });
    expect((await reactionRows(t)).map((r) => r.kind)).toEqual(["laugh"]);
    expect(await reactionsSeenBy(owner, docId, commentId)).toEqual([]);

    await owner.as.mutation(api.comments.deleteThread, { threadId });
    expect(await reactionRows(t)).toEqual([]);
  });

  test("deleting the page or the reacting person's account removes their reactions", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const { owner, commenter, commentId } = await page(t);
      await commenter.as.mutation(api.comments.react, { commentId, kind: "heart" });
      await owner.as.mutation(api.comments.react, { commentId, kind: "check" });

      const now = Date.now();
      await t.run(async (ctx) => {
        await ctx.db.patch(commenter.profileId as Id<"profiles">, { status: "pending_deletion" });
        await ctx.db.insert("deletionJobs", { kind: "account", targetId: commenter.profileId, requestedBy: commenter.profileId as Id<"profiles">, requestedByAdmin: false, reason: "test", scheduledFor: now - 1, status: "scheduled", progress: 0, createdAt: now });
      });
      for (let i = 0; i < 20; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
      expect((await reactionRows(t)).map((r) => r.kind)).toEqual(["check"]);

      await t.run(async (ctx) => {
        await ctx.db.patch(owner.profileId as Id<"profiles">, { status: "pending_deletion" });
        await ctx.db.insert("deletionJobs", { kind: "account", targetId: owner.profileId, requestedBy: owner.profileId as Id<"profiles">, requestedByAdmin: false, reason: "test", scheduledFor: now - 1, status: "scheduled", progress: 0, createdAt: now });
      });
      for (let i = 0; i < 20; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
      expect(await reactionRows(t)).toEqual([]);
      expect(await t.run(async (ctx) => await ctx.db.query("comments").collect())).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
