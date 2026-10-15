// Offline changes are replayed: folders, comments and collection rows made on a device with no connection
// carry ids chosen by that device, and sending the same change again (its answer was lost) lands it once.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { person, PERSONAL, setup, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const text = (s: string) => [{ type: "text", text: s }];

async function newDoc(p: Person, title: string) {
  const id = ulid();
  await p.as.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: "device-replays",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } as never }],
  });
  return id;
}

const count = async (t: T, table: "folders" | "commentThreads" | "comments" | "commentReactions" | "notifications") =>
  await t.run(async (ctx) => (await ctx.db.query(table).collect()).length);

describe("folders made offline", () => {
  test("take the id the device chose, and a resend makes no second folder", async () => {
    const t = setup();
    const a = await person(t, "replay-folders@example.com");
    const before = await count(t, "folders");
    const id = ulid();
    expect(await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Trips", id })).toEqual({ id });
    expect(await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Trips", id })).toEqual({ id });
    expect(await count(t, "folders")).toBe(before + 1);

    // A subfolder made offline inside it, and a note filed there by its id.
    const child = ulid();
    await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Japan", parentFolderId: id, id: child });
    const { folders } = await a.as.query(api.organization.sidebar, { scope: PERSONAL });
    expect(folders.find((f) => f.id === child)?.parentFolderId).toBe(id);
    const doc = await newDoc(a, "Packing list");
    const moved = await a.as.mutation(api.documents.bulkUpdate, { documentIds: [doc], action: { kind: "move", folderId: child } });
    expect(moved.done).toEqual([doc]);
    // Sent again, the move changes nothing more.
    expect((await a.as.mutation(api.documents.bulkUpdate, { documentIds: [doc], action: { kind: "move", folderId: child } })).done).toEqual([doc]);
    const listed = await a.as.query(api.documents.list, { scope: PERSONAL, view: "folder", folderId: child, paginationOpts: { numItems: 10, cursor: null } });
    expect(listed.page.map((d) => d.id)).toEqual([doc]);
  });

  test("an id someone else's folder has is refused, and so is a malformed one", async () => {
    const t = setup();
    const a = await person(t, "replay-folder-a@example.com");
    const b = await person(t, "replay-folder-b@example.com");
    const id = ulid();
    await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Mine", id });
    await expect(b.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Theirs", id })).rejects.toThrow(/taken/);
    await expect(a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Odd", id: "not an id!" })).rejects.toThrow(/Invalid folder id/);
  });

  test("deleting a folder twice answers not found the second time (the device counts that as done)", async () => {
    const t = setup();
    const a = await person(t, "replay-folder-delete@example.com");
    const id = ulid();
    await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Old", id });
    await a.as.mutation(api.organization.deleteFolder, { folderId: id });
    await expect(a.as.mutation(api.organization.deleteFolder, { folderId: id })).rejects.toThrow(/Folder not found/);
  });
});

describe("comments made offline", () => {
  test("a thread, a reply and a reaction sent twice land once, and notify once", async () => {
    const t = setup();
    const owner = await person(t, "replay-comments-owner@example.com");
    const guest = await person(t, "replay-comments-guest@example.com");
    const docId = await newDoc(owner, "Itinerary");
    await owner.as.mutation(api.sharing.grant, { documentId: docId, email: "replay-comments-guest@example.com", role: "commenter" });
    const notesBefore = await count(t, "notifications");

    const threadId = ulid();
    const commentId = ulid();
    const first = await guest.as.mutation(api.comments.create, { documentId: docId, body: text("Leave at nine?"), threadId, commentId });
    expect(first).toEqual({ threadId, commentId });
    expect(await guest.as.mutation(api.comments.create, { documentId: docId, body: text("Leave at nine?"), threadId, commentId })).toEqual({ threadId, commentId });
    // The page's creator heard about it once.
    const notesAfterCreate = await count(t, "notifications");
    expect(notesAfterCreate).toBe(notesBefore + 1);

    const replyId = ulid();
    expect(await owner.as.mutation(api.comments.reply, { threadId, body: text("Ten is better."), commentId: replyId })).toEqual({ commentId: replyId });
    expect(await owner.as.mutation(api.comments.reply, { threadId, body: text("Ten is better."), commentId: replyId })).toEqual({ commentId: replyId });

    expect(await guest.as.mutation(api.comments.react, { commentId: replyId, kind: "thumbsUp", on: true })).toEqual({ reacted: true });
    expect(await guest.as.mutation(api.comments.react, { commentId: replyId, kind: "thumbsUp", on: true })).toEqual({ reacted: true });
    expect(await count(t, "commentReactions")).toBe(1);
    expect(await guest.as.mutation(api.comments.react, { commentId: replyId, kind: "thumbsUp", on: false })).toEqual({ reacted: false });
    expect(await guest.as.mutation(api.comments.react, { commentId: replyId, kind: "thumbsUp", on: false })).toEqual({ reacted: false });
    expect(await count(t, "commentReactions")).toBe(0);

    const data = await owner.as.query(api.comments.threads, { documentId: docId });
    expect(data.threads).toHaveLength(1);
    expect(data.threads[0]!.id).toBe(threadId);
    expect(data.threads[0]!.comments.map((c) => c.id)).toEqual([commentId, replyId]);
    expect(await count(t, "commentThreads")).toBe(1);
    expect(await count(t, "comments")).toBe(2);
    // Each new comment notified once: the reply told the guest, and nothing was repeated.
    expect(await count(t, "notifications")).toBe(notesAfterCreate + 1);
  });

  test("ids that belong to someone else's comment are refused", async () => {
    const t = setup();
    const owner = await person(t, "replay-taken-owner@example.com");
    const other = await person(t, "replay-taken-other@example.com");
    const docId = await newDoc(owner, "Shared plan");
    await owner.as.mutation(api.sharing.grant, { documentId: docId, email: "replay-taken-other@example.com", role: "commenter" });
    const threadId = ulid();
    const commentId = ulid();
    await owner.as.mutation(api.comments.create, { documentId: docId, body: text("Mine"), threadId, commentId });
    await expect(other.as.mutation(api.comments.create, { documentId: docId, body: text("Theirs"), threadId, commentId: ulid() })).rejects.toThrow(/taken/);
    await expect(other.as.mutation(api.comments.create, { documentId: docId, body: text("Theirs"), commentId })).rejects.toThrow(/taken/);
    await expect(other.as.mutation(api.comments.reply, { threadId, body: text("Theirs"), commentId })).rejects.toThrow(/taken/);
    await expect(other.as.mutation(api.comments.create, { documentId: docId, body: text("Odd"), threadId: "bad id!" })).rejects.toThrow(/Invalid comment id/);
  });
});

describe("collection rows made offline", () => {
  test("a row added twice with the same ids is one row, with its page under the host", async () => {
    const t = setup();
    const a = await person(t, "replay-rows@example.com");
    const host = await newDoc(a, "Reading list");
    const { collectionId } = await a.as.mutation(api.collections.create, { documentId: host });
    const before = await a.as.query(api.collections.get, { collectionId });
    const status = before.properties.find((p) => p.type === "select")!;
    const id = ulid();
    const documentId = ulid();
    const values = { [status.id]: "doing" };
    expect(await a.as.mutation(api.collections.addRow, { collectionId, title: "Dune", values, id, documentId })).toEqual({ id, documentId });
    expect(await a.as.mutation(api.collections.addRow, { collectionId, title: "Dune", values, id, documentId })).toEqual({ id, documentId });
    await a.as.mutation(api.collections.setValue, { collectionId, rowId: id, propertyId: status.id, value: "done" });
    await a.as.mutation(api.collections.setValue, { collectionId, rowId: id, propertyId: status.id, value: "done" });
    const after = await a.as.query(api.collections.get, { collectionId });
    expect(after.rows.map((r) => [r.id, r.documentId, r.title, r.values[status.id]])).toEqual([[id, documentId, "Dune", "done"]]);

    // Deleted twice: the second answers not found (the device counts that as done).
    await a.as.mutation(api.collections.deleteRow, { collectionId, rowId: id });
    await expect(a.as.mutation(api.collections.deleteRow, { collectionId, rowId: id })).rejects.toThrow(/Row not found/);
  });

  test("a row id from another collection, or a page id already in use, is refused", async () => {
    const t = setup();
    const a = await person(t, "replay-rows-taken@example.com");
    const one = await a.as.mutation(api.collections.create, { documentId: await newDoc(a, "One") });
    const two = await a.as.mutation(api.collections.create, { documentId: await newDoc(a, "Two") });
    const id = ulid();
    await a.as.mutation(api.collections.addRow, { collectionId: one.collectionId, id, documentId: ulid() });
    await expect(a.as.mutation(api.collections.addRow, { collectionId: two.collectionId, id, documentId: ulid() })).rejects.toThrow(/taken/);
    const used = await newDoc(a, "Already here");
    await expect(a.as.mutation(api.collections.addRow, { collectionId: two.collectionId, id: ulid(), documentId: used })).rejects.toThrow(/already exists/);
  });
});

describe("read marks made offline", () => {
  test("marking a thread read or unread twice lands once; a mark up to an older moment leaves newer activity unread", async () => {
    const t = setup();
    const owner = await person(t, "replay-read-owner@example.com");
    const guest = await person(t, "replay-read-guest@example.com");
    const docId = await newDoc(owner, "Plans");
    await owner.as.mutation(api.sharing.grant, { documentId: docId, email: "replay-read-guest@example.com", role: "commenter" });
    const threadId = ulid();
    await owner.as.mutation(api.comments.create, { documentId: docId, body: text("Thoughts, @guest?"), threadId, commentId: ulid() });
    const unreadOf = async () => (await guest.as.query(api.comments.threads, { documentId: docId })).threads[0]!.unread;
    const seen = (await guest.as.query(api.comments.threads, { documentId: docId })).threads[0]!;
    expect(seen.unread).toBe(true);

    // Read up to something older than its latest activity (a mark made offline, before a reply came in).
    await guest.as.mutation(api.comments.markThreadRead, { threadId, upTo: seen.lastActivityAt - 1 });
    expect(await unreadOf()).toBe(true);
    await guest.as.mutation(api.comments.markThreadRead, { threadId, upTo: seen.lastActivityAt });
    await guest.as.mutation(api.comments.markThreadRead, { threadId, upTo: seen.lastActivityAt });
    expect(await unreadOf()).toBe(false);
    // One read state each (the owner's from writing it, the guest's), however often it's sent.
    expect(await t.run(async (ctx) => (await ctx.db.query("readStates").collect()).length)).toBe(2);

    await guest.as.mutation(api.comments.markThreadUnread, { threadId });
    await guest.as.mutation(api.comments.markThreadUnread, { threadId });
    expect(await unreadOf()).toBe(true);

    // The thread is gone: the device counts not found as done.
    await owner.as.mutation(api.comments.deleteThread, { threadId });
    await expect(guest.as.mutation(api.comments.markThreadRead, { threadId, upTo: seen.lastActivityAt })).rejects.toThrow(/not found/i);
    await expect(guest.as.mutation(api.comments.markThreadUnread, { threadId })).rejects.toThrow(/not found/i);
  });
});

describe("collection properties and views made offline", () => {
  test("a property added twice with the same id is one property; its options keep the ids sent", async () => {
    const t = setup();
    const a = await person(t, "replay-props@example.com");
    const { collectionId } = await a.as.mutation(api.collections.create, { documentId: await newDoc(a, "Reading list") });
    const id = ulid();
    expect(await a.as.mutation(api.collections.addProperty, { collectionId, name: "Genre", type: "select", id })).toEqual({ id });
    expect(await a.as.mutation(api.collections.addProperty, { collectionId, name: "Genre", type: "select", id })).toEqual({ id });
    const options = [{ id: ulid(), name: "Sci-fi", color: "plum" }];
    await a.as.mutation(api.collections.updateProperty, { collectionId, propertyId: id, options });
    await a.as.mutation(api.collections.updateProperty, { collectionId, propertyId: id, options });
    const data = await a.as.query(api.collections.get, { collectionId });
    expect(data.properties.filter((p) => p.name === "Genre").map((p) => [p.id, p.options])).toEqual([[id, options]]);
    // Shown in the view once.
    expect(data.views[0]!.config.visibleProperties.filter((p) => p === id)).toHaveLength(1);

    await a.as.mutation(api.collections.deleteProperty, { collectionId, propertyId: id });
    await expect(a.as.mutation(api.collections.deleteProperty, { collectionId, propertyId: id })).rejects.toThrow(/Property not found/);
    // Sent again after it was deleted, the add doesn't bring it back.
    expect(await a.as.mutation(api.collections.addProperty, { collectionId, name: "Genre", type: "select", id })).toEqual({ id });
    expect((await a.as.query(api.collections.get, { collectionId })).properties.some((p) => p.id === id)).toBe(false);
  });

  test("a property or view id from another collection, or a malformed one, is refused", async () => {
    const t = setup();
    const a = await person(t, "replay-props-taken@example.com");
    const one = await a.as.mutation(api.collections.create, { documentId: await newDoc(a, "One") });
    const two = await a.as.mutation(api.collections.create, { documentId: await newDoc(a, "Two") });
    const prop = ulid();
    await a.as.mutation(api.collections.addProperty, { collectionId: one.collectionId, name: "Pages", type: "number", id: prop });
    await expect(a.as.mutation(api.collections.addProperty, { collectionId: two.collectionId, name: "Pages", type: "number", id: prop })).rejects.toThrow(/taken/);
    await expect(a.as.mutation(api.collections.addProperty, { collectionId: two.collectionId, name: "Odd", type: "text", id: "not an id!" })).rejects.toThrow(/Invalid property id/);
    await expect(a.as.mutation(api.collections.addViewToCollection, { collectionId: two.collectionId, name: "Table", type: "table", id: one.viewId })).rejects.toThrow(/taken/);
    await expect(a.as.mutation(api.collections.addViewToCollection, { collectionId: two.collectionId, name: "Odd", type: "table", id: "not an id!" })).rejects.toThrow(/Invalid view id/);
  });

  test("a view added twice is one view; deleted twice, the second is not found even with one view left", async () => {
    const t = setup();
    const a = await person(t, "replay-views@example.com");
    const { collectionId } = await a.as.mutation(api.collections.create, { documentId: await newDoc(a, "Reading list") });
    const id = ulid();
    expect(await a.as.mutation(api.collections.addViewToCollection, { collectionId, name: "Board", type: "board", id })).toEqual({ id });
    expect(await a.as.mutation(api.collections.addViewToCollection, { collectionId, name: "Board", type: "board", id })).toEqual({ id });
    await a.as.mutation(api.collections.updateView, { collectionId, viewId: id, name: "By status" });
    const views = (await a.as.query(api.collections.get, { collectionId })).views;
    expect(views.map((v) => [v.name, v.type])).toEqual([
      ["Table", "table"],
      ["By status", "board"],
    ]);
    await a.as.mutation(api.collections.deleteView, { collectionId, viewId: id });
    await expect(a.as.mutation(api.collections.deleteView, { collectionId, viewId: id })).rejects.toThrow(/View not found/);
    await expect(a.as.mutation(api.collections.deleteView, { collectionId, viewId: views[0]!.id })).rejects.toThrow(/at least one view/);
  });

  test("a row's page made with an id the device chose starts empty (its lines come from the device)", async () => {
    const t = setup();
    const a = await person(t, "replay-row-page@example.com");
    const { collectionId } = await a.as.mutation(api.collections.create, { documentId: await newDoc(a, "Reading list") });
    const documentId = ulid();
    await a.as.mutation(api.collections.addRow, { collectionId, title: "Dune", id: ulid(), documentId });
    const page = await a.as.query(api.blocks.list, { documentId });
    expect(page?.blocks).toEqual([]);
    // Added online without one, the page gets its first empty line from the server, as before.
    const online = await a.as.mutation(api.collections.addRow, { collectionId, title: "Emma" });
    expect((await a.as.query(api.blocks.list, { documentId: online.documentId }))?.blocks).toHaveLength(1);
  });
});
