import { describe, expect, test, vi } from "vitest";
import type { ConvexReactClient } from "convex/react";
import { sync, type SyncOp } from "@folevi/editor-schema";
import { SyncEngine, mergeSyncStates } from "@/lib/sync/engine";
import { ACCOUNT_SYNC_KEY, localDb } from "@/lib/sync/db";

const block = (id: string, text: string) => ({ id, type: "paragraph", parentId: null, rank: "V", schemaVersion: 1, text: [{ type: "text" as const, text }], props: {} });

function recordingClient(respond: (ops: SyncOp[]) => unknown[]) {
  const calls: { workspaceId: string; ops: SyncOp[] }[] = [];
  const client = {
    mutation: vi.fn(async (_fn: unknown, args: { workspaceId: string; ops: SyncOp[] }) => {
      calls.push(args);
      return respond(args.ops);
    }),
  } as unknown as ConvexReactClient;
  return { client, calls };
}

const applied = (ops: SyncOp[]) =>
  ops.map((o) => ({
    opId: o.opId,
    status: "applied",
    revision: 1,
    ...(o.kind === "block.upsert" ? { block: { ...o.block, revision: 1 } } : {}),
  }));

describe("account-wide sync queue (docs/SYNC_PROTOCOL.md §Routing)", () => {
  test("edits to pages of several workspaces share one durable queue and one batch", async () => {
    const { client, calls } = recordingClient(applied);
    const engine = await SyncEngine.open(client, "acct-route-1", "ws-mine", "web-dev-r1");
    engine.setOnline(false);
    engine.upsertBlock("doc-in-my-workspace", block("b1", "mine"), ["content", "position"]);
    engine.upsertBlock("doc-shared-from-elsewhere", block("b2", "theirs"), ["content", "position"]);
    await engine.persisted();
    const db = await localDb("acct-route-1");
    expect(await db.getAllKeys("syncState")).toEqual([ACCOUNT_SYNC_KEY]);
    engine.setOnline(true);
    await engine.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ops.map((o) => (o as { documentId: string }).documentId)).toEqual(["doc-in-my-workspace", "doc-shared-from-elsewhere"]);
    expect(engine.status()).toBe("saved");
  });

  test("a queued page create keeps the workspace it was created in, even after switching", async () => {
    const { client, calls } = recordingClient(applied);
    const engine = await SyncEngine.open(client, "acct-route-2", "ws-team", "web-dev-r2");
    engine.setOnline(false);
    engine.createDocument({ id: "doc-new", parentDocumentId: null, folderId: null, kind: "document", title: "Team notes", icon: null });
    engine.createDocument({ id: "doc-child", parentDocumentId: "doc-new", folderId: null, kind: "document", title: "Child", icon: null });
    engine.setWorkspace("ws-personal");
    engine.setOnline(true);
    await engine.flush();
    const [create, child] = calls[0]!.ops as Extract<SyncOp, { kind: "document.create" }>[];
    expect(calls[0]!.workspaceId).toBe("ws-personal"); // routing only
    expect(create!.document.workspaceId).toBe("ws-team");
    expect(child!.document.workspaceId).toBeUndefined(); // nested pages follow their parent server-side
  });

  test("per-workspace queues from older builds are folded in once, in order, with creates stamped", async () => {
    const accountKey = "acct-route-3";
    const legacyA = sync.localUpsert(sync.emptySyncState(), { opId: "op-a1", documentId: "doc-a", block: block("ba", "a"), fields: ["content", "position"] });
    const legacyB = {
      ...sync.emptySyncState(),
      pending: [{ opId: "op-b1", kind: "document.create", document: { id: "doc-b", parentDocumentId: null, folderId: null, kind: "document", title: "B", icon: null } } as SyncOp],
    };
    const db = await localDb(accountKey);
    await db.put("syncState", legacyA, "ws-a");
    await db.put("syncState", legacyB, "ws-b");
    const { client } = recordingClient(applied);
    const engine = await SyncEngine.open(client, accountKey, "ws-a", "web-dev-r3");
    expect(engine.state.pending.map((o) => o.opId).sort()).toEqual(["op-a1", "op-b1"]);
    const create = engine.state.pending.find((o) => o.opId === "op-b1") as Extract<SyncOp, { kind: "document.create" }>;
    expect(create.document.workspaceId).toBe("ws-b");
    expect(engine.documentBlocks("doc-a")).toHaveLength(1);
    expect((await db.getAllKeys("syncState")).sort()).toEqual([ACCOUNT_SYNC_KEY]);
  });

  test("mergeSyncStates resends in-flight ops first and de-duplicates conflicts", () => {
    const base = { ...sync.emptySyncState(), inflight: [{ opId: "x1", kind: "block.restore", documentId: "d", blockId: "b" } as SyncOp] };
    const legacy = { ...sync.emptySyncState(), pending: [{ opId: "y1", kind: "block.restore", documentId: "e", blockId: "c" } as SyncOp] };
    const merged = mergeSyncStates(base, legacy, "ws-legacy");
    expect(merged.inflight).toEqual([]);
    expect(merged.pending.map((o) => o.opId)).toEqual(["x1", "y1"]);
  });

  test("whenDocumentOnServer waits for the page's create to be acknowledged", async () => {
    const { client } = recordingClient(applied);
    const engine = await SyncEngine.open(client, "acct-route-4", "ws-1", "web-dev-r4");
    engine.setOnline(true);
    engine.createDocument({ id: "doc-fresh", parentDocumentId: null, folderId: null, kind: "document", title: "", icon: null });
    await expect(engine.whenDocumentOnServer("doc-fresh", 5_000)).resolves.toBeUndefined();
    await expect(engine.whenDocumentOnServer("doc-already-there")).resolves.toBeUndefined();

    const offline = await SyncEngine.open(recordingClient(applied).client, "acct-route-5", "ws-1", "web-dev-r5");
    offline.setOnline(false);
    offline.createDocument({ id: "doc-offline", parentDocumentId: null, folderId: null, kind: "document", title: "", icon: null });
    await expect(offline.whenDocumentOnServer("doc-offline")).rejects.toThrow(/offline/);
  });
});
