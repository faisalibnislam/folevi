import { afterEach, describe, expect, test, vi } from "vitest";
import type { ConvexReactClient } from "convex/react";
import { ConvexError } from "convex/values";
import type { WireScope } from "@folevi/editor-schema";
import { Outbox, type OutboxName } from "@/lib/sync/outbox";
import { SyncEngine } from "@/lib/sync/engine";
import { localDb, outboxKeys } from "@/lib/sync/db";

const PERSONAL: WireScope = { kind: "personal" };

type Sent = { name: OutboxName; args: Record<string, unknown> };

/** An outbox whose server answers with `answer` (throw to refuse), opened with nothing sent yet. */
async function open(accountKey: string, answer: (call: Sent, n: number) => unknown = () => null) {
  const sent: Sent[] = [];
  const send = vi.fn(async (name: OutboxName, args: Record<string, unknown>) => {
    sent.push({ name, args });
    return answer({ name, args }, sent.length);
  });
  const outbox = new Outbox(send, accountKey);
  outbox.setOnline(false);
  await outbox.reload();
  return { outbox, sent, send };
}

const folder = (outbox: Outbox, id: string, name: string, parentFolderId?: string) =>
  outbox.enqueue("organization.createFolder", { scope: PERSONAL, name, id, ...(parentFolderId ? { parentFolderId } : {}) }, { keys: [`folder:${id}`, ...(parentFolderId ? [`folder:${parentFolderId}`] : [])], label: `New folder “${name}”`, creates: [id] });

const rename = (outbox: Outbox, folderId: string, name: string) => outbox.enqueue("organization.renameFolder", { folderId, name }, { keys: [`folder:${folderId}`], label: "Rename" });

const refused = (code: string, message: string) => new ConvexError({ code, message });

/** Records the delays the outbox asks for before trying again, and waits a few milliseconds instead. */
function quickRetries(outbox: Outbox): number[] {
  const delays: number[] = [];
  const schedule = outbox.scheduleFlush.bind(outbox);
  vi.spyOn(outbox, "scheduleFlush").mockImplementation((delay = 0) => {
    delays.push(delay);
    schedule(Math.min(delay, 5));
  });
  return delays;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("outbox", () => {
  test("changes wait on the device, in order, across a reopen, and go one at a time once online", async () => {
    const first = await open("outbox-order");
    folder(first.outbox, "F1", "Trips");
    rename(first.outbox, "F1", "Travel");
    folder(first.outbox, "F2", "Work");
    await first.outbox.persisted();
    expect(first.send).not.toHaveBeenCalled();
    first.outbox.dispose();

    // The tab closed: a new one finds them all, oldest first.
    const { outbox, sent } = await open("outbox-order");
    expect(outbox.entries.map((e) => e.label)).toEqual(["New folder “Trips”", "Rename", "New folder “Work”"]);
    outbox.setOnline(true);
    await vi.waitFor(() => expect(outbox.entries).toHaveLength(0));
    expect(sent.map((s) => [s.name, s.args.name])).toEqual([
      ["organization.createFolder", "Trips"],
      ["organization.renameFolder", "Travel"],
      ["organization.createFolder", "Work"],
    ]);
    await outbox.persisted();
    expect(await (await localDb("outbox-order")).getAll("meta", outboxKeys())).toEqual([]);
  });

  test("a change whose answer was lost is sent again as it was (same ids), and then counts as done", async () => {
    const { outbox, sent } = await open("outbox-lost", (_call, n) => {
      if (n === 1) throw new Error("Connection lost while waiting for the answer");
      return { id: "F1" };
    });
    const delays = quickRetries(outbox);
    const { result } = folder(outbox, "F1", "Trips");
    outbox.setOnline(true);
    await expect(result).resolves.toEqual({ id: "F1" });
    // It waited (the whole queue does), then went again with the same arguments: the server takes that as a replay.
    expect(delays).toContain(2_000);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.args).toEqual(sent[0]!.args);
    expect(sent[1]!.args.id).toBe("F1");
    expect(outbox.entries).toHaveLength(0);
  });

  test("retries back off, doubling up to a minute, and being busy is never a refusal", async () => {
    let calls = 0;
    const { outbox, sent } = await open("outbox-backoff", () => {
      if (++calls < 9) throw new ConvexError({ code: "rate_limited", message: "Slow down" });
      return null;
    });
    const delays = quickRetries(outbox);
    folder(outbox, "F1", "Trips");
    outbox.setOnline(true);
    await vi.waitFor(() => expect(outbox.entries).toHaveLength(0));
    expect(sent).toHaveLength(9);
    expect(delays.filter((d) => d > 0)).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });

  test("a server error that keeps happening is set aside after five tries", async () => {
    const { outbox, sent } = await open("outbox-server", () => {
      throw new Error("[Request ID: x] Server Error");
    });
    quickRetries(outbox);
    folder(outbox, "F1", "Trips");
    outbox.setOnline(true);
    await vi.waitFor(() => expect(outbox.entries[0]?.failed?.code).toBe("server"));
    expect(sent).toHaveLength(5);
  });

  test("a refused change is kept and marked; later changes to the same thing wait, others go; retry and discard", async () => {
    let refuse = true;
    const { outbox, sent } = await open("outbox-refused", ({ name, args }) => {
      if (refuse && name === "organization.createFolder" && args.id === "F1") throw refused("invalid_argument", "Folders can be nested up to 5 levels deep.");
      return null;
    });
    const { result } = folder(outbox, "F1", "Too deep");
    rename(outbox, "F1", "Still too deep");
    folder(outbox, "F2", "Fine");
    outbox.setOnline(true);
    await vi.waitFor(() => expect(sent.map((s) => s.args.name)).toEqual(["Too deep", "Fine"]));
    await expect(result).rejects.toBeInstanceOf(ConvexError);
    expect(outbox.entries.map((e) => [e.label, e.failed?.message ?? null])).toEqual([
      ["New folder “Too deep”", "Folders can be nested up to 5 levels deep."],
      ["Rename", null],
    ]);
    expect(outbox.status()).toBe("failed");
    // Nothing is sent again on its own.
    outbox.scheduleFlush(0);
    await new Promise((r) => setTimeout(r, 30));
    expect(sent).toHaveLength(2);

    // Retry: sent again, and what waited behind it follows.
    refuse = false;
    outbox.retry(outbox.entries[0]!.id);
    await vi.waitFor(() => expect(outbox.entries).toHaveLength(0));
    expect(sent.map((s) => s.args.name)).toEqual(["Too deep", "Fine", "Too deep", "Still too deep"]);
  });

  test("discarding a refused change lets the next one go (and is never done without being asked)", async () => {
    const { outbox, sent } = await open("outbox-discard", ({ name }) => {
      if (name === "comments.create") throw refused("forbidden", "You can't comment on this document.");
      return null;
    });
    outbox.enqueue("comments.create", { documentId: "D", body: [], threadId: "T", commentId: "C" }, { keys: ["thread:T", "comment:C"], label: "Comment" });
    outbox.enqueue("comments.reply", { threadId: "T", body: [], commentId: "R" }, { keys: ["thread:T", "comment:R"], label: "Reply" });
    outbox.setOnline(true);
    await vi.waitFor(() => expect(outbox.entries[0]?.failed?.code).toBe("forbidden"));
    expect(sent).toHaveLength(1);
    outbox.discard(outbox.entries[0]!.id);
    await vi.waitFor(() => expect(outbox.entries).toHaveLength(0));
    expect(sent.map((s) => s.name)).toEqual(["comments.create", "comments.reply"]);
  });

  test("a delete that already landed (not found) counts as done", async () => {
    const { outbox } = await open("outbox-done", () => {
      throw refused("not_found", "Folder not found.");
    });
    const { result } = outbox.enqueue("organization.deleteFolder", { folderId: "F1" }, { keys: ["folder:F1"], label: "Delete" });
    outbox.setOnline(true);
    await expect(result).resolves.toBeNull();
    expect(outbox.entries).toHaveLength(0);
  });

  test("signed out: nothing more is sent until the session is back", async () => {
    let signedIn = false;
    const { outbox, sent } = await open("outbox-auth", () => {
      if (!signedIn) throw refused("unauthenticated", "Sign in again.");
      return null;
    });
    folder(outbox, "F1", "Trips");
    folder(outbox, "F2", "Work");
    outbox.setOnline(true);
    await vi.waitFor(() => expect(outbox.authRequired).toBe(true));
    expect(sent).toHaveLength(1);
    expect(outbox.entries.every((e) => !e.failed)).toBe(true);
    signedIn = true;
    outbox.authRefreshed();
    await vi.waitFor(() => expect(outbox.entries).toHaveLength(0));
    expect(sent.map((s) => s.args.name)).toEqual(["Trips", "Trips", "Work"]);
  });

  test("a comment on a line still on its way waits for the line; changes to other things don't", async () => {
    const { outbox, sent } = await open("outbox-after");
    let lineQueued = true;
    outbox.setWaits((after) => lineQueued && after.blockId === "B1");
    outbox.enqueue("comments.create", { documentId: "D", blockId: "B1", body: [], threadId: "T", commentId: "C" }, { keys: ["thread:T", "comment:C"], label: "Comment", after: [{ documentId: "D", blockId: "B1" }] });
    outbox.enqueue("comments.reply", { threadId: "T", body: [], commentId: "R" }, { keys: ["thread:T", "comment:R"], label: "Reply" });
    folder(outbox, "F1", "Trips");
    outbox.setOnline(true);
    await vi.waitFor(() => expect(sent.map((s) => s.name)).toEqual(["organization.createFolder"]));
    expect(outbox.waitsForPages()).toBe(true);
    lineQueued = false;
    outbox.scheduleFlush(0);
    await vi.waitFor(() => expect(outbox.entries).toHaveLength(0));
    expect(sent.map((s) => s.name)).toEqual(["organization.createFolder", "comments.create", "comments.reply"]);
  });

  test("ids made offline hold back page edits that name them until the change that makes them is done", async () => {
    const { outbox } = await open("outbox-holds");
    const released = vi.fn();
    outbox.onReleased = released;
    folder(outbox, "F1", "Trips");
    outbox.enqueue("collections.addRow", { collectionId: "K", id: "R1", documentId: "P1" }, { keys: ["collection:K"], label: "New row", creates: ["P1"] });
    const update = { opId: "o1", kind: "document.update" as const, documentId: "N", patch: { folderId: "F1" }, baseRevision: null };
    const create = { opId: "o2", kind: "document.create" as const, document: { id: "N2", parentDocumentId: null, folderId: "F1", kind: "document" as const, title: "", icon: null } };
    const onRowPage = { opId: "o3", kind: "block.upsert" as const, documentId: "P1", block: { id: "b", type: "paragraph", parentId: null, rank: "V", schemaVersion: 1, text: [], props: {} }, baseRevision: null, fields: ["content" as const] };
    const elsewhere = { opId: "o4", kind: "document.update" as const, documentId: "N", patch: { title: "Hi" }, baseRevision: null };
    expect([update, create, onRowPage, elsewhere].map((op) => outbox.holds(op))).toEqual([true, true, true, false]);
    outbox.setOnline(true);
    await vi.waitFor(() => expect(outbox.entries).toHaveLength(0));
    expect(released).toHaveBeenCalled();
    expect(outbox.holds(update)).toBe(false);
  });
  test("a change that can't wait in the outbox goes after the queued changes to the same thing", async () => {
    const { outbox } = await open("outbox-settled");
    outbox.enqueue("collections.updateView", { collectionId: "K", viewId: "V", name: "All" }, { keys: ["collection:K"], label: "View" });
    let other = false;
    void outbox.settled("collection:Other").then(() => (other = true));
    let mine = false;
    const after = outbox.settled("collection:K").then(() => (mine = true));
    await new Promise((r) => setTimeout(r, 20));
    expect([other, mine]).toEqual([true, false]);
    outbox.setOnline(true);
    await after;
    expect(outbox.entries).toHaveLength(0);
  });
});

describe("the engine and the outbox together", () => {
  test("a note filed in a folder made offline is sent after the folder; the rest of the queue doesn't wait", async () => {
    const pushes: { kind: string; id: string }[][] = [];
    const client = {
      mutation: vi.fn(async (_fn: unknown, args: { ops: { opId: string; kind: string; document?: { id: string }; documentId?: string; block?: { id: string } }[] }) => {
        pushes.push(args.ops.map((o) => ({ kind: o.kind, id: o.document?.id ?? o.block?.id ?? o.documentId ?? "" })));
        return args.ops.map((o) => ({ opId: o.opId, status: "applied", revision: 1, ...(o.block ? { block: { ...o.block, revision: 1 } } : {}) }));
      }),
    } as unknown as ConvexReactClient;
    const engine = await SyncEngine.open(client, "outbox-engine", PERSONAL, "web-outbox");
    engine.setOnline(true);
    await new Promise((r) => setTimeout(r, 30));
    const { outbox } = await open("outbox-engine-queue");
    engine.setHold((op) => outbox.holds(op));
    outbox.onReleased = () => engine.scheduleFlush(0);
    folder(outbox, "F1", "Trips");

    engine.createDocument({ id: "N1", parentDocumentId: null, folderId: "F1", kind: "document", title: "Packing", icon: null });
    engine.upsertBlock("N1", { id: "b1", type: "paragraph", parentId: null, rank: "V", schemaVersion: 1, text: [{ type: "text", text: "Socks" }], props: {} }, ["content", "position"]);
    engine.createDocument({ id: "N2", parentDocumentId: null, folderId: null, kind: "document", title: "Elsewhere", icon: null });
    await engine.flush();
    expect(pushes.flat().map((o) => o.id)).toEqual(["N2"]);
    expect(engine.state.pending.map((op) => op.kind)).toEqual(["document.create", "block.upsert"]);

    outbox.setOnline(true);
    await vi.waitFor(() => expect(engine.state.pending).toHaveLength(0));
    expect(pushes.flat().map((o) => o.id)).toEqual(["N2", "N1", "b1"]);
  });
});
