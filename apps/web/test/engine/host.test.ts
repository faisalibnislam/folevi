// The bridge host (src/lib/engine/host.ts): the handshake, errors, place routing, live views with windowed lists
// and diffs, commands, editor commands, events, and that decrypted answers never reach the device.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeHost } from "@/lib/engine/host";
import { registerNote, markNoteReady, resetNoteHost } from "@/lib/engine/noteHost";
import { nativeToast } from "@/lib/engine/toasts";
import { applyDiff, emptyNativeList, nativeRows } from "@/lib/engine/diff";
import { forgetCatchUps } from "@/lib/engine/catchUp";
import { PROTOCOL_VERSION, schemaHash, type HomeValue, type ListDiff, type Reply } from "@/lib/engine/protocol";
import { Posts, pagedList, rig, summary, type Rig } from "./fakes";

const PLACE = "acct:user_1";
let posts: Posts;
let host: BridgeHost;
let r: Rig;
let n = 0;

const send = async (m: Record<string, unknown>): Promise<Reply> => JSON.parse(await host.handle(JSON.stringify({ v: 1, id: String(++n), ...m }))) as Reply;
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
/** Lets watchers' async kept reads land, then flushes. */
const settle = async () => {
  await new Promise((res) => setTimeout(res, 0));
  host.flush();
};

beforeEach(() => {
  posts = new Posts();
  host = new BridgeHost({ post: posts.post, schedule: () => undefined, build: "test", marker: { platform: "ios", protocol: 1, place: PLACE }, queryTimeoutMs: 50 });
  r = rig(PLACE);
  n = 0;
});

afterEach(() => {
  host.dispose();
  resetNoteHost();
  forgetCatchUps();
});

describe("handshake and errors", () => {
  it("hello answers the protocol, hash and names, ready or not", async () => {
    const before = (await ok({ kind: "hello", app: { platform: "ios", version: "1.1.00", build: "1", protocol: PROTOCOL_VERSION } })) as { ready: boolean; schemaHash: string; place: string; views: string[] };
    expect(before.ready).toBe(false);
    expect(before.schemaHash).toBe(schemaHash());
    expect(before.place).toBe(PLACE);
    expect(before.views).toContain("home");
    host.attach(r.deps());
    const after = (await ok({ kind: "hello", app: { platform: "ios", version: "1.1.00", build: "1", protocol: 1 } })) as { ready: boolean };
    expect(after.ready).toBe(true);
  });

  it("refuses another protocol, bad JSON, missing ids, unknown kinds", async () => {
    expect((await errorOf({ kind: "hello", app: { protocol: 2 } })).code).toBe("protocol_mismatch");
    const v2 = JSON.parse(await host.handle(JSON.stringify({ v: 2, id: "x", kind: "hello" }))) as Reply;
    expect(!v2.ok && v2.error.code).toBe("protocol_mismatch");
    const bad = JSON.parse(await host.handle("{nope")) as Reply;
    expect(!bad.ok && bad.error.code).toBe("invalid_message");
    const noId = JSON.parse(await host.handle({ v: 1, kind: "hello" })) as Reply;
    expect(!noId.ok && noId.error.code).toBe("invalid_message");
    expect((await errorOf({ kind: "dance" })).code).toBe("invalid_message");
  });

  it("answers engine_not_ready until the data layer is attached, then says engine.ready", async () => {
    expect((await errorOf({ kind: "watch", sub: "a", place: PLACE, name: "home", args: {} })).code).toBe("engine_not_ready");
    expect((await errorOf({ kind: "command", place: PLACE, name: "engine.refresh", args: {} })).code).toBe("engine_not_ready");
    host.attach(r.deps());
    host.flush();
    expect(posts.events("engine.ready")[0]!.data).toEqual({ place: PLACE, protocol: 1, revision: expect.any(Number) });
    expect(posts.events("gate.changed")[0]!.data).toEqual({ gate: null });
  });

  it("refuses messages for another place, unknown views, commands and subscriptions, and bad args", async () => {
    host.attach(r.deps());
    const mismatch = await errorOf({ kind: "watch", sub: "a", place: "acct:someone_else", name: "home", args: {} });
    expect(mismatch).toMatchObject({ code: "place_mismatch", data: { expected: PLACE, got: "acct:someone_else" } });
    expect((await errorOf({ kind: "watch", sub: "a", place: PLACE, name: "nope", args: {} })).code).toBe("unknown_view");
    expect((await errorOf({ kind: "command", place: PLACE, name: "nope", args: {} })).code).toBe("unknown_command");
    expect((await errorOf({ kind: "editor", name: "nope" })).code).toBe("unknown_editor_command");
    expect((await errorOf({ kind: "window", sub: "zzz", window: { start: 0, count: 10 } })).code).toBe("unknown_subscription");
    expect((await errorOf({ kind: "watch", sub: "a", place: PLACE, name: "notes.list", args: {} })).code).toBe("invalid_args");
    expect((await errorOf({ kind: "watch", sub: "a", place: PLACE, name: "notes.list", args: { view: "folder" } })).code).toBe("invalid_args");
    expect((await errorOf({ kind: "watch", sub: "a", place: PLACE, name: "home", args: { spaec: "personal" } })).code).toBe("invalid_args");
    expect((await errorOf({ kind: "command", place: PLACE, name: "note.star", args: { ids: "doc_1", starred: true } })).code).toBe("invalid_args");
    expect((await errorOf({ kind: "command", place: PLACE, name: "note.star", args: { ids: ["doc_1"] } })).code).toBe("invalid_args");
  });

  it("passes server errors through with their own code and message", async () => {
    host.attach(r.deps());
    const { ConvexError } = await import("convex/values");
    r.client.mutate = () => {
      throw new ConvexError({ code: "forbidden", message: "You can't change this note." });
    };
    expect(await errorOf({ kind: "command", place: PLACE, name: "note.archive", args: { ids: ["doc_1"], archived: true } })).toEqual({ code: "forbidden", message: "You can't change this note." });
  });
});

describe("value views", () => {
  beforeEach(() => {
    r.client.answer("documents:recentNotes", [summary(1), summary(2, { homeFolder: { id: "f1", name: "Trips", color: "moss" } })]);
    r.client.answer("documents:list", pagedList(() => [summary(1, { starred: true })]));
    r.client.answer("organization:draftCount", 3);
    r.client.answer("changes:list", { notes: [{}, {}] });
    r.client.answer("proposals:count", 1);
    r.client.answer("study:summary", { due: 2, new: 1, hasCards: true, later: 0, total: 3 });
    r.client.answer("organization:sidebar", { folders: [{ id: "f1", name: "Trips", color: "moss", parentFolderId: null, rank: "a" }, { id: "f2", name: "Japan", color: null, parentFolderId: "f1", rank: "a" }], tags: [{ id: "t1", name: "ideas", color: "marigold" }] });
    r.client.answer("organization:index", { folders: [{ id: "f1", name: "Trips", color: "moss", parentFolderId: null, rank: "a", createdAt: 0, updatedAt: 5, documentCount: 4, previews: [{ cover: { kind: "none" }, title: "Kyoto", excerpt: "Temples" }] }, { id: "f2", name: "Japan", color: null, parentFolderId: "f1", rank: "a", createdAt: 0, updatedAt: 5, documentCount: 2, previews: [] }], tags: [] });
    host.attach(r.deps());
  });

  it("home: the first update is the whole value; a change sends a new one; no change sends nothing", async () => {
    expect(await ok({ kind: "watch", sub: "home", place: PLACE, name: "home", args: {} })).toEqual({ sub: "home" });
    await settle();
    const first = posts.updates("home");
    expect(first).toHaveLength(1);
    const home = first[0]!.value as HomeValue;
    expect(first[0]!.rev).toBe(1);
    expect(home.recents.map((x) => x.id)).toEqual(["doc_1", "doc_2"]);
    expect(home.recents[1]!.folder).toEqual({ id: "f1", name: "Trips", color: "moss" });
    expect(home.rows.map((x) => [x.id, x.count])).toEqual([["notes", null], ["drafts", 3], ["shared", null], ["changes", 3], ["reviews", 3]]);
    expect(home.folders).toEqual([expect.objectContaining({ id: "f1", noteCount: 4, childCount: 1, previews: [{ title: "Kyoto", excerpt: "Temples", cover: { kind: "none" } }] })]);
    expect(home.starred.rows.map((x) => x.id)).toEqual(["doc_1"]);
    expect(home.tags).toEqual([{ id: "t1", name: "ideas", color: "marigold" }]);
    expect(home.catchUp).toEqual({ available: true, state: "idle", brief: null, error: null });

    posts.clear();
    r.client.bump("documents:recentNotes");
    await settle();
    expect(posts.updates("home")).toHaveLength(0);

    r.client.answer("documents:recentNotes", [summary(3), summary(1), summary(2)]);
    await settle();
    const next = posts.updates("home");
    expect(next).toHaveLength(1);
    expect(next[0]!.rev).toBe(2);
    expect((next[0]!.value as HomeValue).recents.map((x) => x.id)).toEqual(["doc_3", "doc_1", "doc_2"]);
  });

  it("unwatch stops the view's queries", async () => {
    await ok({ kind: "watch", sub: "home", place: PLACE, name: "home", args: {} });
    await settle();
    expect(r.client.watching("documents:recentNotes")).toBe(1);
    await ok({ kind: "unwatch", sub: "home" });
    expect(r.client.watching("documents:recentNotes")).toBe(0);
    expect(host.subscriptions()).toEqual([]);
  });

  it("folders.tree: nested folders, flat and depth first, with counts and a waiting new folder", async () => {
    await ok({ kind: "command", place: PLACE, name: "folder.create", args: { name: "Kyoto", parentId: "f2" } });
    await ok({ kind: "watch", sub: "tree", place: PLACE, name: "folders.tree", args: {} });
    await settle();
    const tree = posts.updates("tree")[0]!.value as { folders: { id: string; depth: number; parentId: string | null; noteCount: number | null; sync: string }[] };
    expect(tree.folders.map((f) => [f.depth, f.parentId === null ? null : f.parentId.length > 0])).toEqual([[0, null], [1, true], [2, true]]);
    expect(tree.folders[0]).toMatchObject({ id: "f1", noteCount: 4 });
    expect(tree.folders[2]).toMatchObject({ sync: "waiting", noteCount: 0 });
  });

  it("sync.status is a view and an event", async () => {
    await ok({ kind: "watch", sub: "sync", place: PLACE, name: "sync.status", args: {} });
    host.flush();
    expect(posts.updates("sync")[0]!.value).toMatchObject({ state: "saved", label: "Saved", pending: 0, online: true });
    expect(posts.events("sync.status")[0]!.data).toMatchObject({ state: "saved" });
    posts.clear();
    await ok({ kind: "command", place: PLACE, name: "note.create", args: {} });
    host.flush();
    expect(posts.updates("sync")[0]!.value).toMatchObject({ state: "saving", pending: 1 });
    expect(posts.events("sync.status")).toHaveLength(1);
  });

  it("session describes the place, spaces and capabilities", async () => {
    r.encrypted.add("ws_vault");
    r.locked.add("ws_vault");
    const value = (await ok({ kind: "query", place: PLACE, name: "session", args: {} })) as { place: string; spaces: { id: string; encrypted: boolean; locked: boolean }[]; space: string };
    expect(value.place).toBe(PLACE);
    expect(value.space).toBe("personal");
    expect(value.spaces.map((s) => [s.id, s.encrypted, s.locked])).toEqual([["personal", false, false], ["ws1", false, false], ["ws_vault", true, true]]);
  });

  it("offline cold start: the kept answer, marked stale, then the live one", async () => {
    r.client.answer("documents:recentNotes", undefined);
    r.kept.store.set(r.kept.key("documents:recentNotes", { scope: { kind: "personal" }, limit: 10 }), [summary(9)]);
    await ok({ kind: "watch", sub: "home", place: PLACE, name: "home", args: {} });
    await settle();
    const kept = posts.updates("home").at(-1)!;
    expect(kept.stale).toBe(true);
    expect((kept.value as HomeValue).recents.map((x) => x.id)).toEqual(["doc_9"]);
    posts.clear();
    r.client.answer("documents:recentNotes", [summary(1)]);
    await settle();
    const live = posts.updates("home").at(-1)!;
    expect(live.stale).toBeUndefined();
    expect((live.value as HomeValue).recents.map((x) => x.id)).toEqual(["doc_1"]);
  });

  it("an encrypted space's decrypted answers are never written to the device; a Standard space's are", async () => {
    r.encrypted.add("ws_vault");
    await ok({ kind: "watch", sub: "vault", place: PLACE, name: "home", args: { space: "ws_vault" } });
    await settle();
    expect(posts.updates("vault")).toHaveLength(1);
    const scopes = r.kept.writes.map((w) => JSON.stringify((w.args as { scope?: unknown }).scope ?? null));
    expect(scopes.some((s) => s.includes("ws_vault"))).toBe(false);
    await ok({ kind: "watch", sub: "personal", place: PLACE, name: "home", args: { space: "personal" } });
    await settle();
    expect(r.kept.writes.some((w) => w.name === "documents:recentNotes" && JSON.stringify(w.args).includes("personal"))).toBe(true);
  });

  it("a locked encrypted space shows nothing readable", async () => {
    r.encrypted.add("ws_vault");
    r.locked.add("ws_vault");
    await ok({ kind: "watch", sub: "vault", place: PLACE, name: "home", args: { space: "ws_vault" } });
    await settle();
    const v = posts.updates("vault")[0]!.value as HomeValue;
    expect(v.recents).toEqual([]);
    expect(v.folders).toEqual([]);
    expect(v.recentsLoaded).toBe(false);
  });

  it("a view's error is an update with the error", async () => {
    const { ConvexError } = await import("convex/values");
    r.client.answer("documents:get", () => new ConvexError({ code: "forbidden", message: "No access." }));
    await ok({ kind: "watch", sub: "meta", place: PLACE, name: "note.meta", args: { id: "doc_1" } });
    host.flush();
    expect(posts.updates("meta")[0]!.error).toEqual({ code: "forbidden", message: "No access." });
  });
});

describe("windowed lists", () => {
  let docs: ReturnType<typeof summary>[];
  beforeEach(() => {
    docs = Array.from({ length: 450 }, (_, i) => summary(i));
    r.client.answer("documents:list", pagedList(() => docs));
    r.client.answer("organization:sidebar", { folders: [], tags: [] });
    host.attach(r.deps());
  });

  const replay = (sub: string) => {
    let list = emptyNativeList();
    for (const u of posts.updates(sub)) if (u.diff) list = applyDiff(list, u.diff);
    return list;
  };

  it("sends one window, loads pages as the window moves, and stays in step with native", async () => {
    await ok({ kind: "watch", sub: "all", place: PLACE, name: "notes.list", args: { view: "all" }, window: { start: 0, count: 50 } });
    await settle();
    const first = posts.updates("all")[0]!.diff!;
    expect(first).toMatchObject({ reset: true, total: 200, complete: false, start: 0 });
    expect(first.order).toHaveLength(50);
    expect(Object.keys(first.upsert!)).toHaveLength(50);

    await ok({ kind: "window", sub: "all", window: { start: 380, count: 60 } });
    // Each flush asks for the next page until the window is covered.
    for (let i = 0; i < 4; i++) await settle();
    const list = replay("all");
    expect(list.total).toBe(450);
    expect(list.complete).toBe(true);
    expect(list.start).toBe(380);
    expect(nativeRows(list).map((x) => x.id)).toEqual(docs.slice(380, 440).map((d) => d.id));
    expect(r.client.watching("documents:list")).toBe(3);
  });

  it("an edit to one note sends one row; a new note sends the order, the row, and the one pushed out", async () => {
    await ok({ kind: "watch", sub: "all", place: PLACE, name: "notes.list", args: { view: "all" }, window: { start: 0, count: 10 } });
    await settle();
    posts.clear();
    docs = docs.map((d, i) => (i === 3 ? { ...d, title: "Edited" } : d));
    r.client.bump("documents:list");
    host.flush();
    const edit = posts.updates("all")[0]!.diff!;
    expect(Object.keys(edit.upsert!)).toEqual(["doc_3"]);
    expect(edit.order).toBeUndefined();
    expect(edit.reset).toBeUndefined();

    posts.clear();
    docs = [summary(999), ...docs];
    r.client.bump("documents:list");
    host.flush();
    const insert = posts.updates("all")[0]!.diff!;
    expect(insert.order![0]).toBe("doc_999");
    expect(Object.keys(insert.upsert!)).toEqual(["doc_999"]);
    expect(insert.remove).toEqual(["doc_9"]);
  });

  it("a note made on this device shows first, waiting to sync, before the server has it", async () => {
    await ok({ kind: "watch", sub: "drafts", place: PLACE, name: "notes.list", args: { view: "unsorted" }, window: { start: 0, count: 5 } });
    await settle();
    const created = (await ok({ kind: "command", place: PLACE, name: "note.create", args: { title: "On the train" } })) as { id: string };
    host.flush();
    const list = replay("drafts");
    expect(nativeRows(list)[0]).toMatchObject({ id: created.id, title: "On the train", sync: "waiting" });
  });

  it("a note moved out of a folder offline leaves the folder's list at once", async () => {
    docs = [summary(1, { folderId: "f1" }), summary(2, { folderId: "f1" })];
    await ok({ kind: "watch", sub: "f", place: PLACE, name: "notes.list", args: { view: "folder", folderId: "f1" } });
    await settle();
    host.attach(r.deps({ online: false }));
    const moved = (await ok({ kind: "command", place: PLACE, name: "note.move", args: { ids: ["doc_1"], folderId: null } })) as { queued: boolean };
    expect(moved.queued).toBe(true);
    host.flush();
    expect(nativeRows(replay("f")).map((x) => x.id)).toEqual(["doc_2"]);
  });

  it("a one-off query answers the window as a reset diff", async () => {
    const diff = (await ok({ kind: "query", place: PLACE, name: "notes.list", args: { view: "all" }, window: { start: 10, count: 5 } })) as ListDiff;
    expect(diff).toMatchObject({ reset: true, start: 10, total: 200 });
    expect(diff.order).toEqual(docs.slice(10, 15).map((d) => d.id));
  });
});

describe("commands", () => {
  beforeEach(() => host.attach(r.deps()));

  it("note.star goes in turns of 50 and merges the answers", async () => {
    r.client.mutate = (_name, args) => ({ done: args.documentIds as string[], skipped: 0 });
    const ids = Array.from({ length: 120 }, (_, i) => `doc_${i}`);
    const res = await ok({ kind: "command", place: PLACE, name: "note.star", args: { ids, starred: true } });
    expect(r.client.mutations.map((m) => [m.name, (m.args.documentIds as string[]).length, m.args.action])).toEqual([
      ["documents:bulkUpdate", 50, { kind: "star", starred: true }],
      ["documents:bulkUpdate", 50, { kind: "star", starred: true }],
      ["documents:bulkUpdate", 20, { kind: "star", starred: true }],
    ]);
    expect(res).toEqual({ done: ids, skipped: 0, queued: false });
  });

  it("offline, a star is queued and reported as done", async () => {
    host.attach(r.deps({ online: false }));
    r.client.mutate = () => new Promise(() => undefined);
    expect(await ok({ kind: "command", place: PLACE, name: "note.star", args: { ids: ["doc_1"], starred: false } })).toEqual({ done: ["doc_1"], skipped: 0, queued: true });
  });

  it("note.create goes through the sync engine, in the space asked for, and can open the note", async () => {
    const res = (await ok({ kind: "command", place: PLACE, name: "note.create", args: { space: "ws1", folderId: "f1", title: "Plan", open: true } })) as { id: string };
    expect(r.engine.created[0]).toMatchObject({ id: res.id, folderId: "f1", title: "Plan", scope: { kind: "workspace", workspaceId: "ws1" } });
    expect(r.navigations).toEqual([`/d/${res.id}?new=1`]);
    expect((await errorOf({ kind: "command", place: PLACE, name: "note.create", args: { space: "ws_unknown" } })).code).toBe("not_found");
  });

  it("note.move goes through the outbox after the folder it names", async () => {
    r.outbox.answer = () => ({ done: ["doc_1"], skipped: 0, previousFolders: {} });
    const res = await ok({ kind: "command", place: PLACE, name: "note.move", args: { ids: ["doc_1"], folderId: "f9" } });
    expect(r.outbox.entries[0]).toMatchObject({ name: "documents.bulkUpdate", keys: ["folder:f9", "note:doc_1"], args: { action: { kind: "move", folderId: "f9" } } });
    expect(res).toEqual({ done: ["doc_1"], skipped: 0, queued: false });
  });

  it("space.switch asks the page to show the space; a view that follows the space restarts with it", async () => {
    r.client.answer("documents:recentNotes", (args: { scope: { kind: string; workspaceId?: string } }) => [summary(args.scope.kind === "personal" ? 1 : 2)]);
    await ok({ kind: "watch", sub: "home", place: PLACE, name: "home", args: {} });
    await ok({ kind: "watch", sub: "pinned", place: PLACE, name: "home", args: { space: "personal" } });
    await settle();
    expect(await ok({ kind: "command", place: PLACE, name: "space.switch", args: { space: "ws1" } })).toEqual({ space: "ws1" });
    expect(r.spaceSwitches).toEqual(["ws1"]);
    posts.clear();
    host.attach(r.deps({ space: "ws1" }));
    await settle();
    const moved = posts.updates("home");
    expect(moved).toHaveLength(1);
    expect((moved[0]!.value as HomeValue).space).toBe("ws1");
    expect((moved[0]!.value as HomeValue).recents[0]!.id).toBe("doc_2");
    expect(posts.updates("pinned")).toHaveLength(0);
    expect(posts.events("place.changed")[0]!.data).toEqual({ place: PLACE, space: "ws1" });
  });

  it("catchUp.run makes the brief and Home shows it; catchUp.clear forgets it", async () => {
    r.client.act = () => ({ answer: "**Your week**", sources: [{ id: "doc_1", title: "Kyoto" }] });
    await ok({ kind: "watch", sub: "home", place: PLACE, name: "home", args: {} });
    await settle();
    const card = (await ok({ kind: "command", place: PLACE, name: "catchUp.run", args: {} })) as { state: string; brief: { text: string } };
    expect(card.state).toBe("ready");
    expect(r.client.actions[0]).toMatchObject({ name: "ai:brief", args: { scope: { kind: "personal" }, today: "2026-10-24" } });
    host.flush();
    expect((posts.updates("home").at(-1)!.value as HomeValue).catchUp.brief!.text).toBe("**Your week**");
    await ok({ kind: "command", place: PLACE, name: "catchUp.clear", args: {} });
    host.flush();
    expect((posts.updates("home").at(-1)!.value as HomeValue).catchUp.state).toBe("idle");
  });

  it("engine.refresh asks the engine to send now", async () => {
    await ok({ kind: "command", place: PLACE, name: "engine.refresh", args: {} });
    expect(r.engine.flushes).toBe(1);
  });
});

describe("editor commands and events", () => {
  beforeEach(() => host.attach(r.deps()));

  it("note.show opens the note page and replies whether it's ready; note.ready follows", async () => {
    expect(await ok({ kind: "editor", name: "note.show", args: { id: "doc_1" } })).toEqual({ id: "doc_1", ready: false });
    expect(r.navigations).toEqual(["/d/doc_1"]);
    registerNote({ noteId: "doc_1", run: () => ({ ok: true }), state: () => ({ noteId: "doc_1", focused: false, canEdit: true, block: "paragraph", marks: [], link: false, undo: false, redo: false }), panel: () => null });
    markNoteReady("doc_1", "Kyoto");
    host.flush();
    expect(posts.events("note.ready")[0]!.data).toEqual({ id: "doc_1", title: "Kyoto" });
    expect(await ok({ kind: "editor", name: "note.show", args: { id: "doc_1" } })).toEqual({ id: "doc_1", ready: true });
    expect(r.navigations).toHaveLength(1);
    await ok({ kind: "editor", name: "note.close" });
    expect(r.navigations.at(-1)).toBe("/native");
  });

  it("the open note's meta is sent as note.meta events", async () => {
    r.client.answer("documents:get", { document: { ...summary(1, { starred: true }), workspaceId: null, ownerProfileId: "prof_1" }, access: "manage", folder: null, breadcrumbs: [], inTrash: false });
    r.client.answer("organization:sidebar", { folders: [], tags: [] });
    await ok({ kind: "editor", name: "note.show", args: { id: "doc_1" } });
    host.flush();
    expect(posts.events("note.meta")[0]!.data).toMatchObject({ id: "doc_1", found: true, title: "Note 1", starred: true, canEdit: true, space: "personal" });
  });

  it("editor commands go to the open note, and are refused without one", async () => {
    expect((await errorOf({ kind: "editor", name: "format", args: { mark: "bold" } })).code).toBe("no_note");
    const calls: [string, unknown][] = [];
    registerNote({ noteId: "doc_1", run: (name, args) => (calls.push([name, args]), { ok: true }), state: () => ({ noteId: "doc_1", focused: true, canEdit: true, block: "todo", marks: [], link: false, undo: true, redo: false }), panel: () => "format" });
    expect(await ok({ kind: "editor", name: "format", args: { mark: "bold" } })).toEqual({ ok: true });
    expect(calls).toEqual([["format", { mark: "bold" }]]);
    host.flush();
    expect(posts.events("editor.panel")[0]!.data).toEqual({ panel: "format" });
  });

  it("toasts go to native with their button, and toast.action presses it", async () => {
    let pressed = 0;
    expect(nativeToast("Moved to Trips", { tone: "neutral", action: { label: "Undo", onClick: () => pressed++ } })).toBe(true);
    host.flush();
    const toast = posts.events("toast")[0]!.data as { message: string; tone: string; action: { id: string; label: string } };
    expect(toast).toMatchObject({ message: "Moved to Trips", tone: "info", undo: null, action: { label: "Undo" } });
    await ok({ kind: "command", place: PLACE, name: "toast.action", args: { id: toast.action.id } });
    expect(pressed).toBe(1);
    expect((await errorOf({ kind: "command", place: PLACE, name: "toast.action", args: { id: toast.action.id } })).code).toBe("not_found");
  });
});

describe("transport", () => {
  it("batches updates and events into one post per flush", async () => {
    host.attach(r.deps());
    host.emit("memory.relieved", { dropped: ["caches"] });
    host.emit("editor.panel", { panel: null });
    host.flush();
    expect(posts.raw).toHaveLength(1);
    expect(posts.batches[0]!.map((m) => m.kind === "event" && m.name)).toEqual(["engine.ready", "gate.changed", "memory.relieved", "editor.panel", "sync.status"]);
  });

  it("a batch over 256 KB is uploaded to /_bridge and the message names it", async () => {
    const uploads: [string, number][] = [];
    const big = new BridgeHost({ post: posts.post, schedule: () => undefined, upload: async (id, body) => void uploads.push([id, body.length]) });
    big.emit("toast", { message: "x".repeat(300 * 1024), tone: "info", undo: null, action: null });
    big.flush();
    await new Promise((res) => setTimeout(res, 0));
    expect(uploads).toHaveLength(1);
    expect(JSON.parse(posts.raw.at(-1)!)).toEqual({ bodyId: uploads[0]![0] });
    big.dispose();
  });

  it("detach stops views and says the engine is gone; attach starts them again with a whole value", async () => {
    r.client.answer("organization:sidebar", { folders: [], tags: [] });
    r.client.answer("organization:index", { folders: [], tags: [] });
    host.attach(r.deps());
    await ok({ kind: "watch", sub: "tree", place: PLACE, name: "folders.tree", args: {} });
    host.flush();
    host.detach();
    expect(r.client.watching("organization:sidebar")).toBe(0);
    host.flush();
    expect(posts.events("gate.changed").at(-1)!.data).toEqual({ gate: "loading" });
    posts.clear();
    host.attach(r.deps());
    host.flush();
    expect(posts.updates("tree")).toHaveLength(1);
    expect(posts.updates("tree")[0]!.rev).toBe(2);
  });
});
