// Revision 4's views and commands through the bridge host: folder cards, Shared with Me, Changes, the bell,
// search, a filtered list, and the note, folder, Trash and notification commands.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeHost } from "@/lib/engine/host";
import { resetNoteHost } from "@/lib/engine/noteHost";
import { resetGates } from "@/lib/engine/gates";
import { applyDiff, emptyNativeList, nativeRows } from "@/lib/engine/diff";
import type { ChangesValue, FolderCardsValue, NotificationsValue, Reply, SearchValue, SharedValue } from "@/lib/engine/protocol";
import { Posts, pagedList, rig, summary, type Rig } from "./fakes";

const PLACE = "acct:user_1";
let posts: Posts;
let host: BridgeHost;
let r: Rig;
let n = 0;
const send = async (m: Record<string, unknown>) => JSON.parse(await host.handle(JSON.stringify({ v: 1, id: String(++n), ...m }))) as Reply;
const ok = async (m: Record<string, unknown>) => {
  const reply = await send(m);
  if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
  return reply.value;
};
const errorOf = async (m: Record<string, unknown>) => {
  const reply = await send(m);
  if (reply.ok) throw new Error("expected an error");
  return reply.error;
};
const settle = async () => {
  await new Promise((res) => setTimeout(res, 0));
  host.flush();
};
const query = (name: string, args: Record<string, unknown> = {}) => ok({ kind: "query", place: PLACE, name, args });
const command = (name: string, args: Record<string, unknown> = {}) => ok({ kind: "command", place: PLACE, name, args });

const SIDEBAR = {
  folders: [
    { id: "f1", name: "Trips", color: "moss", parentFolderId: null, rank: "a" },
    { id: "f2", name: "Japan", color: null, parentFolderId: "f1", rank: "a" },
    { id: "f3", name: "Kyoto", color: null, parentFolderId: "f2", rank: "a" },
  ],
  tags: [],
};

beforeEach(() => {
  posts = new Posts();
  host = new BridgeHost({ post: posts.post, schedule: () => undefined, marker: { platform: "ios", protocol: 1, place: PLACE }, queryTimeoutMs: 50 });
  r = rig(PLACE);
  r.client.answer("organization:sidebar", SIDEBAR);
  r.client.answer("organization:index", { folders: [{ id: "f2", name: "Japan", color: null, parentFolderId: "f1", rank: "a", createdAt: 0, updatedAt: 9, documentCount: 5, previews: [{ cover: { kind: "none" }, title: "Kyoto", excerpt: "Temples" }] }], tags: [] });
  host.attach(r.deps());
  n = 0;
});

afterEach(() => {
  host.dispose();
  resetNoteHost();
  resetGates();
});

describe("views", () => {
  it("folders.cards: a folder's subfolders with their counts and previews", async () => {
    const v = (await query("folders.cards", { parentId: "f1" })) as FolderCardsValue;
    expect(v.folders).toEqual([expect.objectContaining({ id: "f2", noteCount: 5, childCount: 1, previews: [{ title: "Kyoto", excerpt: "Temples", cover: { kind: "none" } }] })]);
    const top = (await query("folders.cards", {})) as FolderCardsValue;
    expect(top.folders.map((f) => f.id)).toEqual(["f1"]);
  });

  it("shared.list, changes and the bell", async () => {
    r.client.answer("sharing:sharedWithMe", [{ id: "d1", title: "Plan", icon: null, role: "editor", sharedBy: "Maya", sharedAt: 1, workspaceName: null, ownerName: "Maya", updatedAt: 2, excerpt: "x" }]);
    const shared = (await query("shared.list")) as SharedValue;
    expect(shared.rows[0]).toMatchObject({ id: "d1", sharedBy: "Maya", encrypted: false, h: expect.any(String) });

    r.client.answer("changes:list", { notes: [{ id: "d2", title: "Q4", icon: null, at: 5, actors: ["p1", "p2"], added: 2, edited: 0, removed: 1, more: false }], people: { p1: { name: "Maya" }, p2: { name: "Sam" } } });
    r.client.answer("proposals:list", [{ id: "pr1", documentId: "d3", title: "Kyoto", sourceName: "Claude", summary: "Add a list", createdAt: 4, problem: null }]);
    const changes = (await query("changes")) as ChangesValue;
    expect(changes.notes[0]).toEqual({ id: "d2", title: "Q4", icon: null, who: "Maya and 1 other", counts: "2 lines added, 1 removed", changedAt: 5 });
    expect(changes.proposals[0]).toMatchObject({ id: "pr1", noteId: "d3", sourceName: "Claude" });

    r.client.answer("notifications:list", [{ id: "n1", kind: "comment", title: "Maya commented", body: null, fileId: null, actorName: "Maya", actorAvatarUrl: null, documentId: "d2", toChanges: false, documentTitle: "Q4", threadId: "t1", blockId: null, count: 1, inviteId: null, pageInviteId: null, createdAt: 3, read: false }]);
    r.client.answer("notifications:unreadCount", 1);
    const bell = (await query("notifications.list")) as NotificationsValue;
    expect(bell.unread).toBe(1);
    expect(bell.rows[0]).toMatchObject({ id: "n1", body: "", route: "/d/d2#comment-t1", noteTitle: "Q4" });
  });

  it("search: this space with filters, everywhere, and by meaning after the keyword matches", async () => {
    let asked: Record<string, unknown> | null = null;
    r.client.answer("search:documents", (args: Record<string, unknown>) => {
      asked = args;
      return [{ id: "d1", title: "Kyoto", icon: null, kind: "document", updatedAt: 1, snippet: "…Kyoto…", match: null, archived: false, homeFolder: { id: "f1", name: "Trips", color: "moss" } }];
    });
    r.client.answer("search:meaningAvailable", true);
    r.client.act = (name) => (name === "search:byMeaning" ? [{ id: "d9", title: "Temples", snippet: "Fushimi" }, { id: "d1", title: "Kyoto", snippet: "dup" }] : null);
    await ok({ kind: "watch", sub: "s", place: PLACE, name: "search", args: { text: " kyoto ", folderId: "f1", meaning: true } });
    await settle();
    await settle();
    expect(asked).toEqual({ scope: { kind: "personal" }, query: "kyoto", limit: 20, folderId: "f1" });
    const v = posts.updates("s").at(-1)!.value as SearchValue;
    expect(v.meaningAvailable).toBe(true);
    expect(v.hits.map((h) => [h.id, h.matchIn])).toEqual([["d1", "text"], ["d9", "meaning"]]);
    expect(v.hits[0]!.folder).toEqual({ id: "f1", name: "Trips", color: "moss" });

    r.client.answer("search:everywhere", [{ id: "d5", title: "Launch", icon: null, kind: "document", updatedAt: 1, snippet: "", match: null, archived: false, homeFolder: null, place: { id: "ws1", name: "Studio" } }]);
    const all = (await query("search", { text: "launch", scope: "everywhere" })) as SearchValue;
    expect(all.hits[0]).toMatchObject({ id: "d5", space: "ws1", spaceName: "Studio" });
    const empty = (await query("search", { text: "  " })) as SearchValue;
    expect(empty.hits).toEqual([]);
  });

  it("notes.list with a filter looks through every page", async () => {
    const docs = Array.from({ length: 450 }, (_, i) => summary(i, { title: i % 100 === 7 ? `Plan ${i}` : `Note ${i}` }));
    r.client.answer("documents:list", pagedList(() => docs));
    await ok({ kind: "watch", sub: "f", place: PLACE, name: "notes.list", args: { view: "all", filter: "PLAN" }, window: { start: 0, count: 20 } });
    for (let i = 0; i < 5; i++) await settle();
    let list = emptyNativeList();
    for (const u of posts.updates("f")) if (u.diff) list = applyDiff(list, u.diff);
    expect(nativeRows(list).map((x) => x.title)).toEqual(["Plan 7", "Plan 107", "Plan 207", "Plan 307", "Plan 407"]);
    expect(list.complete).toBe(true);
  });
});

describe("commands", () => {
  it("note.deleteForever, duplicate and copyTo", async () => {
    r.client.mutate = (name, args) => (name === "documents:bulkUpdate" ? { done: args.documentIds, skipped: 0 } : name === "documents:duplicate" ? { id: "copy1" } : name === "copies:copyTo" ? { id: `c_${String(args.documentId)}` } : null);
    expect(await command("note.deleteForever", { ids: ["d1"] })).toEqual({ done: ["d1"], skipped: 0, queued: false });
    expect(r.client.mutations[0]!.args.action).toEqual({ kind: "delete" });
    expect(await command("note.duplicate", { id: "d1" })).toEqual({ id: "copy1" });
    expect(await command("note.copyTo", { ids: ["d1", "d2"], space: "ws1", folderId: null })).toEqual({ done: ["c_d1", "c_d2"], skipped: 0, queued: false });
    expect(r.client.mutations.at(-1)!.args).toMatchObject({ destination: { kind: "workspace", workspaceId: "ws1" }, folderId: null });
  });

  it("note.reorder finds the note that follows", async () => {
    r.client.answer("documents:list", { page: [{ id: "a" }, { id: "b" }, { id: "c" }], isDone: true, continueCursor: "3" });
    await command("note.reorder", { id: "c", afterId: "a", view: "all" });
    expect(r.client.mutations.at(-1)).toEqual({ name: "documents:reorder", args: { documentId: "c", afterDocumentId: "a", beforeDocumentId: "b" } });
    await command("note.reorder", { id: "a", afterId: null, view: "all" });
    expect(r.client.mutations.at(-1)!.args).toEqual({ documentId: "a", afterDocumentId: null, beforeDocumentId: "b" });
    expect((await errorOf({ kind: "command", place: PLACE, name: "note.reorder", args: { id: "a", view: "all" } })).code).toBe("invalid_args");
  });

  it("folders through the outbox; a move into its own subfolder is refused", async () => {
    expect(await errorOf({ kind: "command", place: PLACE, name: "folder.move", args: { id: "f1", parentId: "f3", afterId: null } })).toMatchObject({ code: "folder_descendant" });
    expect((await errorOf({ kind: "command", place: PLACE, name: "folder.move", args: { id: "f1", parentId: "f1", afterId: null } })).code).toBe("folder_self");
    await command("folder.rename", { id: "f1", name: " Travel " });
    await command("folder.setColor", { id: "f1", color: null });
    await command("folder.move", { id: "f3", parentId: null, afterId: "f1" });
    await command("folder.delete", { id: "f2" });
    expect(r.outbox.entries.map((e) => [e.name, e.args])).toEqual([
      ["organization.renameFolder", { folderId: "f1", name: "Travel" }],
      ["organization.setFolderColor", { folderId: "f1", color: null }],
      ["organization.moveFolder", { folderId: "f3", parentFolderId: null, afterFolderId: "f1" }],
      ["organization.deleteFolder", { folderId: "f2" }],
    ]);
  });

  it("trash.empty says how many stay", async () => {
    r.client.answer("documents:trashSummary", { total: 14, deletable: 12 });
    r.client.mutate = () => ({ scheduled: 12, continuing: false });
    expect(await command("trash.empty", {})).toEqual({ deleted: 12, skipped: 2, continuing: false });
  });

  it("template.create goes through the sync engine as a template", async () => {
    const res = (await command("template.create", { title: "Trip" })) as { id: string };
    expect(r.engine.created[0]).toMatchObject({ id: res.id, kind: "template", title: "Trip" });
  });

  it("notifications, invitations, Changes and proposals", async () => {
    r.client.mutate = (name) => (name === "sharing:acceptPageInvite" ? { documentId: "d7" } : null);
    await command("notification.markRead", { ids: ["n1"], read: true });
    await command("notification.markRead", { ids: ["n1"], read: false });
    await command("notification.markAllRead");
    await command("notification.remove", { ids: ["n1"] });
    await command("invite.accept", { inviteId: "inv1" });
    expect(await command("pageInvite.accept", { inviteId: "pi1" })).toEqual({ noteId: "d7" });
    await command("changes.markSeen", { ids: ["d2"] });
    await command("proposal.accept", { id: "pr1" });
    await command("proposal.reject", { id: "pr2" });
    expect(r.client.mutations.map((m) => m.name)).toEqual([
      "notifications:markRead",
      "notifications:markUnread",
      "notifications:markRead",
      "notifications:remove",
      "workspaces:acceptInvite",
      "sharing:acceptPageInvite",
      "changes:markSeen",
      "proposals:accept",
      "proposals:reject",
    ]);
    expect(r.client.mutations[2]!.args).toEqual({});
  });
});
