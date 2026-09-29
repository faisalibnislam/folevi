// Comments and the notifications they (and invites, shares, access changes, note mentions) create,
// exercised end to end through the public API with signed-in people.
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { productEmailAllowed } from "../../convex/email";
import { inWorkspace, para, person, setup, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;
type Prefs = Doc<"profiles">["notificationPrefs"];

async function newDoc(p: Person, workspaceId: string, title: string) {
  const id = ulid();
  const [r] = await p.as.mutation(api.sync.push, {
    scope: inWorkspace(workspaceId),
    deviceId: "device-test-1",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }],
  });
  expect(r!.status).toBe("applied");
  return id;
}

async function addBlock(p: Person, workspaceId: string, documentId: string, block: ReturnType<typeof para>) {
  const [r] = await p.as.mutation(api.sync.push, { scope: inWorkspace(workspaceId), deviceId: "device-test-1", ops: [{ opId: ulid(), kind: "block.upsert", documentId, block, baseRevision: null, fields: ["content", "position"] }] });
  expect(r!.status).toBe("applied");
  return block.id;
}

/** Owner with a team workspace, an editor member, a commenter member, a viewer member, and an outsider. */
async function team(t: T) {
  const owner = await person(t, "owner@example.com");
  const editor = await person(t, "editor@example.com");
  const commenter = await person(t, "commenter@example.com");
  const viewer = await person(t, "viewer@example.com");
  const outsider = await person(t, "outsider@example.com");
  const { id: teamId } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Garden Team" });
  for (const [p, role] of [
    [editor, "editor"],
    [commenter, "commenter"],
    [viewer, "viewer"],
  ] as const) {
    await owner.as.mutation(api.workspaces.invite, { workspaceId: teamId, email: `${role}@example.com`, role });
    const invite = (await p.as.query(api.notifications.list, {})).find((n) => n.kind === "invite")!;
    await p.as.mutation(api.workspaces.acceptInvite, { inviteId: invite.inviteId! });
    await p.as.mutation(api.notifications.remove, { ids: [invite.id] });
  }
  const docId = await newDoc(owner, teamId, "Launch review");
  const blockId = await addBlock(owner, teamId, docId, para(ulid(), "Ship the beta on Friday"));
  return { owner, editor, commenter, viewer, outsider, teamId, docId, blockId };
}

const text = (s: string) => [{ type: "text", text: s }];

async function inbox(p: Person) {
  return await p.as.query(api.notifications.list, {});
}

async function scheduledEmails(t: T) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.system.query("_scheduled_functions").collect();
    return rows.filter((r) => r.name.includes("sendTemplate")).map((r) => r.args[0] as { key: string; profileId?: string; preference?: string });
  });
}

async function setPrefs(t: T, p: Person, patch: Partial<Prefs>) {
  await t.run(async (ctx) => {
    const row = await ctx.db.get(p.profileId as Doc<"profiles">["_id"]);
    await ctx.db.patch(row!._id, { notificationPrefs: { ...row!.notificationPrefs, ...patch } });
  });
}

describe("notification triggers", () => {
  test("a workspace invitation notifies an existing account in-app", async () => {
    const t = setup();
    const owner = await person(t, "inviter@example.com");
    const guest = await person(t, "invitee@example.com");
    const { id: teamId } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Studio" });
    await owner.as.mutation(api.workspaces.invite, { workspaceId: teamId, email: "invitee@example.com", role: "editor" });
    const [n] = await inbox(guest);
    expect(n).toMatchObject({ kind: "invite", actorName: "inviter", read: false });
    expect(n!.inviteId).toBeTruthy();
    expect(await owner.as.query(api.notifications.list, {})).toEqual([]);
  });

  test("invitations stay out of the bell when shares and invitations are turned off there", async () => {
    const t = setup();
    const owner = await person(t, "inviter2@example.com");
    const guest = await person(t, "invitee2@example.com");
    await setPrefs(t, guest, { inApp: { comments: true, replies: true, mentions: true, shares: false, access: true } });
    const { id: teamId } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Studio" });
    await owner.as.mutation(api.workspaces.invite, { workspaceId: teamId, email: "invitee2@example.com", role: "editor" });
    expect(await inbox(guest)).toEqual([]);
    // The invitation email still goes out (it has its own email preference).
    expect((await scheduledEmails(t)).some((e) => e.key === "workspace_invite")).toBe(true);
  });

  test("sharing a page notifies the person; changing their role is an access change", async () => {
    const t = setup();
    const w = await team(t);
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: w.docId, mode: "restricted" });
    await w.owner.as.mutation(api.sharing.grant, { documentId: w.docId, email: "outsider@example.com", role: "viewer" });
    let [n] = await inbox(w.outsider);
    expect(n).toMatchObject({ kind: "share", documentId: w.docId, documentTitle: "Launch review" });
    await w.owner.as.mutation(api.sharing.grant, { documentId: w.docId, email: "outsider@example.com", role: "commenter" });
    [n] = await inbox(w.outsider);
    expect(n).toMatchObject({ kind: "share_change", documentId: w.docId });
    expect(n!.title).toMatch(/Can comment/);
  });

  test("a comment notifies the note's creator and followers, never the author or muted people", async () => {
    const t = setup();
    const w = await team(t);
    await w.viewer.as.mutation(api.notifications.setNoteSubscription, { documentId: w.docId, mode: "follow" });
    await w.commenter.as.mutation(api.comments.create, { documentId: w.docId, blockId: w.blockId, body: text("Is Friday realistic?") });
    const [n] = await inbox(w.owner);
    expect(n).toMatchObject({ kind: "comment", actorName: "commenter", documentId: w.docId, blockId: w.blockId, body: "Is Friday realistic?", read: false });
    expect(n!.threadId).toBeTruthy();
    expect(n!.commentId).toBeTruthy();
    expect((await inbox(w.viewer)).map((x) => x.kind)).toEqual(["comment"]);
    expect(await inbox(w.commenter)).toEqual([]);
    expect(await inbox(w.editor)).toEqual([]);

    // Muted: the creator hears nothing more about comments on this note.
    await w.owner.as.mutation(api.notifications.setNoteSubscription, { documentId: w.docId, mode: "mute" });
    await w.owner.as.mutation(api.notifications.remove, { ids: [n!.id] });
    await w.editor.as.mutation(api.comments.create, { documentId: w.docId, body: text("Another thought") });
    expect(await inbox(w.owner)).toEqual([]);
    expect(await w.owner.as.query(api.notifications.noteSubscription, { documentId: w.docId })).toEqual({ mode: "mute", isAuthor: true });
  });

  test("replies notify the thread's participants; @mentions notify once and only people who can read the page", async () => {
    const t = setup();
    const w = await team(t);
    const { threadId } = await w.commenter.as.mutation(api.comments.create, { documentId: w.docId, body: text("Kick-off") });
    await w.owner.as.mutation(api.notifications.markRead, {});
    await w.editor.as.mutation(api.comments.reply, {
      threadId,
      body: [
        { type: "text", text: "Agreed " },
        { type: "mention", userId: w.commenter.profileId, label: "commenter" },
        { type: "mention", userId: w.outsider.profileId, label: "outsider" },
        { type: "mention", userId: w.viewer.profileId, label: "viewer" },
      ],
    });
    // The commenter took part and was mentioned: one notification, the mention.
    expect((await inbox(w.commenter)).map((n) => n.kind)).toEqual(["mention"]);
    expect((await inbox(w.viewer)).map((n) => n.kind)).toEqual(["mention"]);
    // The outsider can't read the page: nothing (and nothing that names it).
    expect(await inbox(w.outsider)).toEqual([]);
    // The creator isn't in the thread: "commented on".
    expect((await inbox(w.owner)).filter((n) => !n.read).map((n) => n.kind)).toEqual(["comment"]);
    // Now the owner replies; both earlier participants hear "replied".
    await w.owner.as.mutation(api.comments.reply, { threadId, body: text("Noted") });
    expect((await inbox(w.editor)).map((n) => n.kind)).toEqual(["reply"]);
    expect((await inbox(w.commenter)).map((n) => n.kind)).toEqual(["reply", "mention"]);
  });

  test("an @mention typed into the note notifies with the block to jump to", async () => {
    const t = setup();
    const w = await team(t);
    const blockId = await addBlock(w.owner, w.teamId, w.docId, {
      ...para(ulid(), ""),
      text: [
        { type: "text", text: "Over to " },
        { type: "mention", userId: w.editor.profileId, label: "editor" },
      ],
    } as ReturnType<typeof para>);
    const [n] = await inbox(w.editor);
    expect(n).toMatchObject({ kind: "mention", documentId: w.docId, blockId });
    // Mentioning someone who can't open the note does nothing.
    await addBlock(w.owner, w.teamId, w.docId, { ...para(ulid(), ""), text: [{ type: "mention", userId: w.outsider.profileId, label: "outsider" }] } as ReturnType<typeof para>);
    expect(await inbox(w.outsider)).toEqual([]);
  });

  test("access removal is announced without linking to the page", async () => {
    const t = setup();
    const w = await team(t);
    await w.owner.as.mutation(api.workspaces.changeRole, { workspaceId: w.teamId, profileId: w.editor.profileId, role: "viewer" });
    const [n] = await inbox(w.editor);
    expect(n).toMatchObject({ kind: "share_change", documentId: null });
    expect(n!.title).toMatch(/Viewer/);
  });

  test("a burst of comments from one person folds into one notification and one email", async () => {
    const t = setup();
    const w = await team(t);
    const { threadId } = await w.editor.as.mutation(api.comments.create, { documentId: w.docId, body: text("one") });
    await w.editor.as.mutation(api.comments.reply, { threadId, body: text("two") });
    await w.editor.as.mutation(api.comments.reply, { threadId, body: text("three") });
    const rows = await inbox(w.owner);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "comment", count: 3, body: "three" });
    const emails = (await scheduledEmails(t)).filter((e) => e.key === "comment_notification" && e.profileId === w.owner.profileId);
    expect(emails).toHaveLength(1);
    // Once read, the next comment is a new notification.
    await w.owner.as.mutation(api.notifications.markRead, {});
    await w.editor.as.mutation(api.comments.reply, { threadId, body: text("four") });
    expect((await inbox(w.owner)).map((n) => [n.read, n.count])).toEqual([
      [false, 1],
      [true, 3],
    ]);
  });

  test("a kind turned off in the bell still sends its email (and never shows or counts)", async () => {
    const t = setup();
    const w = await team(t);
    await setPrefs(t, w.owner, { inApp: { comments: false, replies: true, mentions: true, shares: true, access: true } });
    await w.editor.as.mutation(api.comments.create, { documentId: w.docId, body: text("quiet") });
    expect(await inbox(w.owner)).toEqual([]);
    expect(await w.owner.as.query(api.notifications.unreadCount, {})).toBe(0);
    expect((await scheduledEmails(t)).filter((e) => e.key === "comment_notification")).toHaveLength(1);
    // And with the digest, it's in the digest instead.
    await setPrefs(t, w.owner, { digest: "daily" });
    await w.commenter.as.mutation(api.comments.create, { documentId: w.docId, body: text("digest me") });
    const result = await t.mutation(internal.digest.sendDailyDigests, { now: Date.now() + 1000 });
    expect(result.sent).toBe(1);
  });

  test("replies use the comment email under their own preference", async () => {
    const t = setup();
    const w = await team(t);
    const { threadId } = await w.owner.as.mutation(api.comments.create, { documentId: w.docId, body: text("start") });
    await w.editor.as.mutation(api.comments.reply, { threadId, body: text("reply") });
    const emails = (await scheduledEmails(t)).filter((e) => e.profileId === w.owner.profileId);
    expect(emails.map((e) => [e.key, e.preference])).toEqual([["comment_notification", "replies"]]);
    // The send-time check: a reply switch that's off wins over comments; unset follows comments.
    expect(productEmailAllowed("comment_notification", "comments", { comments: true, replies: false }, "replies")).toBe(false);
    expect(productEmailAllowed("comment_notification", "comments", { comments: false }, "replies")).toBe(false);
    expect(productEmailAllowed("comment_notification", "comments", { comments: false, replies: true }, "replies")).toBe(true);
    // An unknown refinement can't loosen the template's own preference.
    expect(productEmailAllowed("comment_notification", "comments", { comments: false, shares: true }, "shares")).toBe(false);
    expect(productEmailAllowed("access_changed", "shares", { shares: true, access: false }, "access")).toBe(false);
  });
});

describe("notification inbox", () => {
  test("mark read/unread and remove only touch your own notifications", async () => {
    const t = setup();
    const w = await team(t);
    await w.editor.as.mutation(api.comments.create, { documentId: w.docId, body: text("hello") });
    const [n] = await inbox(w.owner);
    await w.editor.as.mutation(api.notifications.markRead, { ids: [n!.id] });
    await w.editor.as.mutation(api.notifications.remove, { ids: [n!.id] });
    expect((await inbox(w.owner))[0]).toMatchObject({ id: n!.id, read: false });
    await w.owner.as.mutation(api.notifications.markRead, { ids: [n!.id] });
    expect(await w.owner.as.query(api.notifications.unreadCount, {})).toBe(0);
    await w.owner.as.mutation(api.notifications.markUnread, { ids: [n!.id] });
    expect(await w.owner.as.query(api.notifications.unreadCount, {})).toBe(1);
    await w.owner.as.mutation(api.notifications.remove, { ids: [n!.id] });
    expect(await inbox(w.owner)).toEqual([]);
  });

  test("opening a thread marks its notifications read", async () => {
    const t = setup();
    const w = await team(t);
    const { threadId } = await w.editor.as.mutation(api.comments.create, { documentId: w.docId, body: text("look") });
    expect(await w.owner.as.query(api.notifications.unreadCount, {})).toBe(1);
    await w.owner.as.mutation(api.comments.markThreadRead, { threadId });
    expect(await w.owner.as.query(api.notifications.unreadCount, {})).toBe(0);
    const thread = (await w.owner.as.query(api.comments.threads, { documentId: w.docId })).threads[0]!;
    expect(thread.unread).toBe(false);
    await w.owner.as.mutation(api.comments.markThreadUnread, { threadId });
    expect((await w.owner.as.query(api.comments.threads, { documentId: w.docId })).threads[0]!.unread).toBe(true);
  });

  test("note subscriptions need read access and never reveal whether a page exists", async () => {
    const t = setup();
    const w = await team(t);
    expect(await w.outsider.as.query(api.notifications.noteSubscription, { documentId: w.docId })).toBeNull();
    await w.outsider.as.mutation(api.notifications.setNoteSubscription, { documentId: w.docId, mode: "follow" });
    await w.editor.as.mutation(api.comments.create, { documentId: w.docId, body: text("private") });
    expect(await inbox(w.outsider)).toEqual([]);
    expect(await w.outsider.as.query(api.notifications.noteSubscription, { documentId: "does-not-exist" })).toBeNull();
    await w.viewer.as.mutation(api.notifications.setNoteSubscription, { documentId: w.docId, mode: "follow" });
    await w.viewer.as.mutation(api.notifications.setNoteSubscription, { documentId: w.docId, mode: "default" });
    expect(await w.viewer.as.query(api.notifications.noteSubscription, { documentId: w.docId })).toEqual({ mode: "default", isAuthor: false });
  });

  test("losing access hides the comment text but keeps the notice", async () => {
    const t = setup();
    const w = await team(t);
    await w.owner.as.mutation(api.notifications.setNoteSubscription, { documentId: w.docId, mode: "default" });
    await w.editor.as.mutation(api.notifications.setNoteSubscription, { documentId: w.docId, mode: "follow" });
    await w.commenter.as.mutation(api.comments.create, { documentId: w.docId, body: text("confidential words") });
    expect((await inbox(w.editor))[0]!.body).toBe("confidential words");
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: w.docId, mode: "restricted" });
    const comment = (await inbox(w.editor)).find((n) => n.kind === "comment")!;
    expect(comment).toMatchObject({ body: null, documentId: null, documentTitle: null, threadId: null });
  });
});

describe("comments", () => {
  test("viewers read, commenters and above comment; the per-block summary counts open threads", async () => {
    const t = setup();
    const w = await team(t);
    await expect(w.viewer.as.mutation(api.comments.create, { documentId: w.docId, blockId: w.blockId, body: text("no") })).rejects.toThrow(/permission/);
    await expect(w.outsider.as.mutation(api.comments.create, { documentId: w.docId, body: text("no") })).rejects.toThrow(/not found/i);
    await expect(w.outsider.as.query(api.comments.threads, { documentId: w.docId })).resolves.toEqual({ threads: [], blocks: [], canComment: false, canManage: false });
    const { threadId } = await w.commenter.as.mutation(api.comments.create, { documentId: w.docId, blockId: w.blockId, body: text("first") });
    await w.editor.as.mutation(api.comments.reply, { threadId, body: text("second") });
    await w.commenter.as.mutation(api.comments.create, { documentId: w.docId, blockId: w.blockId, body: text("another thread") });
    const seen = await w.viewer.as.query(api.comments.threads, { documentId: w.docId });
    expect(seen.canComment).toBe(false);
    expect(seen.threads).toHaveLength(2);
    expect(seen.threads[0]).toMatchObject({ blockExists: true, blockText: "Ship the beta on Friday", canDelete: false, canResolve: false });
    expect(seen.blocks).toEqual([expect.objectContaining({ blockId: w.blockId, threads: 2, comments: 3 })]);
    expect(seen.blocks[0]!.authors.map((a) => a.name)).toEqual(["commenter", "editor"]);
    // Resolved threads leave the summary.
    await w.commenter.as.mutation(api.comments.setResolved, { threadId, resolved: true });
    const after = await w.commenter.as.query(api.comments.threads, { documentId: w.docId });
    expect(after.blocks[0]).toMatchObject({ threads: 1, comments: 1 });
    expect(after.threads.find((x) => x.id === threadId)).toMatchObject({ status: "resolved", resolvedBy: "commenter" });
    // A reply reopens it.
    await w.editor.as.mutation(api.comments.reply, { threadId, body: text("reopening") });
    expect((await w.editor.as.query(api.comments.threads, { documentId: w.docId })).threads.find((x) => x.id === threadId)!.status).toBe("open");
  });

  test("authors edit their own comments; authors and admins delete; the last comment takes the thread", async () => {
    const t = setup();
    const w = await team(t);
    const { threadId, commentId } = await w.commenter.as.mutation(api.comments.create, { documentId: w.docId, body: text("draft") });
    const { commentId: replyId } = await w.editor.as.mutation(api.comments.reply, { threadId, body: text("reply") });
    await expect(w.editor.as.mutation(api.comments.edit, { commentId, body: text("hijack") })).rejects.toThrow(/own comments/);
    await expect(w.editor.as.mutation(api.comments.remove, { commentId })).rejects.toThrow(/can't delete/);
    await w.commenter.as.mutation(api.comments.edit, { commentId, body: text("final") });
    let thread = (await w.commenter.as.query(api.comments.threads, { documentId: w.docId })).threads[0]!;
    expect(thread.comments[0]).toMatchObject({ body: text("final"), canEdit: true, canDelete: true });
    expect(thread.comments[1]).toMatchObject({ canEdit: false, canDelete: false });
    expect(thread.canDelete).toBe(true);
    // The owner (admin) may delete anyone's comment, but not edit it.
    await expect(w.owner.as.mutation(api.comments.edit, { commentId: replyId, body: text("x") })).rejects.toThrow(/own comments/);
    await w.owner.as.mutation(api.comments.remove, { commentId: replyId });
    thread = (await w.commenter.as.query(api.comments.threads, { documentId: w.docId })).threads[0]!;
    expect(thread.comments[1]).toMatchObject({ deleted: true, body: [] });
    const result = await w.commenter.as.mutation(api.comments.remove, { commentId });
    expect(result.threadDeleted).toBe(true);
    expect((await w.commenter.as.query(api.comments.threads, { documentId: w.docId })).threads).toEqual([]);
    // Notifications about a deleted thread go too.
    expect((await inbox(w.owner)).filter((n) => n.kind === "comment")).toEqual([]);
  });

  test("deleting a thread: its starter or an admin", async () => {
    const t = setup();
    const w = await team(t);
    const { threadId } = await w.commenter.as.mutation(api.comments.create, { documentId: w.docId, body: text("topic") });
    await expect(w.editor.as.mutation(api.comments.deleteThread, { threadId })).rejects.toThrow(/can't delete/);
    await expect(w.outsider.as.mutation(api.comments.deleteThread, { threadId })).rejects.toThrow(/not found/i);
    await w.owner.as.mutation(api.comments.deleteThread, { threadId });
    expect((await w.owner.as.query(api.comments.threads, { documentId: w.docId })).threads).toEqual([]);
  });

  test("a thread on a deleted block stays, marked as such", async () => {
    const t = setup();
    const w = await team(t);
    await w.editor.as.mutation(api.comments.create, { documentId: w.docId, blockId: w.blockId, body: text("about this line") });
    const [r] = await w.owner.as.mutation(api.sync.push, { scope: inWorkspace(w.teamId), deviceId: "device-test-1", ops: [{ opId: ulid(), kind: "block.delete", documentId: w.docId, blockId: w.blockId, baseRevision: 1 }] });
    expect(r!.status).toBe("applied");
    const data = await w.owner.as.query(api.comments.threads, { documentId: w.docId });
    expect(data.threads[0]).toMatchObject({ blockId: w.blockId, blockExists: false, blockText: null });
    expect(data.blocks).toEqual([]);
    // New comments can't target a deleted block.
    await expect(w.owner.as.mutation(api.comments.create, { documentId: w.docId, blockId: w.blockId, body: text("x") })).rejects.toThrow(/Block not found/);
  });
});
