import { describe, expect, test, vi } from "vitest";
import type { ConvexReactClient } from "convex/react";
import { openDB } from "idb";
import { sync, type SyncOp, type WireScope } from "@folevi/editor-schema";
import { SyncEngine, adoptLegacyCreates, mergeSyncStates } from "@/lib/sync/engine";
import { ACCOUNT_SYNC_KEY, DB_VERSION, localDb } from "@/lib/sync/db";

const block = (id: string, text: string) => ({ id, type: "paragraph", parentId: null, rank: "V", schemaVersion: 1, text: [{ type: "text" as const, text }], props: {} });
const PERSONAL: WireScope = { kind: "personal" };
const team = (workspaceId: string): WireScope => ({ kind: "workspace", workspaceId });
type Create = Extract<SyncOp, { kind: "document.create" }>;

function recordingClient(respond: (ops: SyncOp[]) => unknown[]) {
  const calls: { scope: WireScope; ops: SyncOp[] }[] = [];
  const client = {
    mutation: vi.fn(async (_fn: unknown, args: { scope: WireScope; ops: SyncOp[] }) => {
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

const legacyCreate = (opId: string, id: string, workspaceId: string, parentDocumentId: string | null = null): SyncOp =>
  ({ opId, kind: "document.create", document: { id, parentDocumentId, folderId: null, kind: "document", title: id, icon: null, workspaceId } }) as SyncOp;

describe("account-wide sync queue (docs/SYNC_PROTOCOL.md §Routing)", () => {
  test("edits to pages of several scopes share one durable queue and one batch", async () => {
    const { client, calls } = recordingClient(applied);
    const engine = await SyncEngine.open(client, "acct-route-1", PERSONAL, "web-dev-r1");
    engine.setOnline(false);
    engine.upsertBlock("doc-in-my-personal", block("b1", "mine"), ["content", "position"]);
    engine.upsertBlock("doc-shared-from-a-workspace", block("b2", "theirs"), ["content", "position"]);
    await engine.persisted();
    const db = await localDb("acct-route-1");
    expect(await db.getAllKeys("syncState")).toEqual([ACCOUNT_SYNC_KEY]);
    engine.setOnline(true);
    await engine.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.scope).toEqual(PERSONAL);
    expect(calls[0]!.ops.map((o) => (o as { documentId: string }).documentId)).toEqual(["doc-in-my-personal", "doc-shared-from-a-workspace"]);
    expect(engine.status()).toBe("saved");
  });

  test("a queued page create keeps the scope it was created in, even after switching (Personal ↔ workspace)", async () => {
    const { client, calls } = recordingClient(applied);
    const engine = await SyncEngine.open(client, "acct-route-2", team("ws-team"), "web-dev-r2");
    engine.setOnline(false);
    engine.createDocument({ id: "doc-new", parentDocumentId: null, folderId: null, kind: "document", title: "Team notes", icon: null });
    engine.createDocument({ id: "doc-child", parentDocumentId: "doc-new", folderId: null, kind: "document", title: "Child", icon: null });
    engine.setScope(PERSONAL);
    engine.createDocument({ id: "doc-mine", parentDocumentId: null, folderId: null, kind: "document", title: "Mine", icon: null });
    engine.setOnline(true);
    await engine.flush();
    const [create, child, mine] = calls[0]!.ops as Create[];
    expect(calls[0]!.scope).toEqual(PERSONAL); // routing only
    expect(create!.document.scope).toEqual(team("ws-team"));
    expect(child!.document.scope).toBeUndefined(); // nested pages follow their parent server-side
    expect(mine!.document.scope).toEqual(PERSONAL);
    // Personal is never sent as a workspace id.
    expect(calls[0]!.ops.every((o) => o.kind !== "document.create" || !o.document.workspaceId)).toBe(true);
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
    // ws-b is still one of their team workspaces.
    const engine = await SyncEngine.open(client, accountKey, PERSONAL, "web-dev-r3", ["ws-b"]);
    expect(engine.state.pending.map((o) => o.opId).sort()).toEqual(["op-a1", "op-b1"]);
    const create = engine.state.pending.find((o) => o.opId === "op-b1") as Create;
    expect(create.document.scope).toEqual(team("ws-b"));
    expect(create.document.workspaceId).toBeUndefined();
    expect(engine.documentBlocks("doc-a")).toHaveLength(1);
    expect((await db.getAllKeys("syncState")).sort()).toEqual([ACCOUNT_SYNC_KEY]);
  });

  test("page creates queued for the old personal workspace land in Personal; team ones keep their workspace", () => {
    const state = {
      ...sync.emptySyncState(),
      inflight: [legacyCreate("op-1", "doc-1", "ws-old-personal")],
      pending: [legacyCreate("op-2", "doc-2", "ws-team"), legacyCreate("op-3", "doc-3", "ws-old-personal", "doc-1"), { opId: "op-4", kind: "block.restore", documentId: "d", blockId: "b" } as SyncOp],
    };
    const adopted = adoptLegacyCreates(state, ["ws-team"]);
    const [first] = adopted.inflight as Create[];
    const [second, nested] = adopted.pending as Create[];
    expect(first!.document.scope).toEqual(PERSONAL);
    expect(first!.document.workspaceId).toBeUndefined();
    expect(second!.document.scope).toEqual(team("ws-team"));
    expect(nested!.document.scope).toBeUndefined(); // follows its parent
    expect(nested!.document.workspaceId).toBeUndefined();
    expect(adopted.pending[2]).toBe(state.pending[2]);
    // Nothing to adopt: the same state comes back (no needless write).
    expect(adoptLegacyCreates(adopted, ["ws-team"])).toBe(adopted);
  });

  test("opening the engine with your workspaces re-stamps legacy creates before anything is sent", async () => {
    const accountKey = "acct-route-6";
    const db = await localDb(accountKey);
    await db.put("syncState", { ...sync.emptySyncState(), pending: [legacyCreate("op-p", "doc-p", "ws-old-personal")] }, ACCOUNT_SYNC_KEY);
    const { client, calls } = recordingClient(applied);
    const engine = await SyncEngine.open(client, accountKey, PERSONAL, "web-dev-r6", []);
    engine.setOnline(true);
    await engine.flush();
    const [create] = calls[0]!.ops as Create[];
    expect(create!.document.scope).toEqual(PERSONAL);
    expect(create!.document.workspaceId).toBeUndefined();
    await engine.persisted();
    expect((await db.get("syncState", ACCOUNT_SYNC_KEY))?.pending ?? []).toEqual([]);
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
    const engine = await SyncEngine.open(client, "acct-route-4", PERSONAL, "web-dev-r4");
    engine.setOnline(true);
    engine.createDocument({ id: "doc-fresh", parentDocumentId: null, folderId: null, kind: "document", title: "", icon: null });
    await expect(engine.whenDocumentOnServer("doc-fresh", 5_000)).resolves.toBeUndefined();
    await expect(engine.whenDocumentOnServer("doc-already-there")).resolves.toBeUndefined();

    const offline = await SyncEngine.open(recordingClient(applied).client, "acct-route-5", PERSONAL, "web-dev-r5");
    offline.setOnline(false);
    offline.createDocument({ id: "doc-offline", parentDocumentId: null, folderId: null, kind: "document", title: "", icon: null });
    await expect(offline.whenDocumentOnServer("doc-offline")).rejects.toThrow(/offline/);
  });
});

describe("local database upgrade to v3 (Personal is not a workspace)", () => {
  test("keeps the sync queue and waiting uploads, and rebuilds the document cache keyed by scope", async () => {
    const accountKey = "acct-upgrade-1";
    const name = `folevi-${accountKey}`;
    // A v2 database as older builds wrote it.
    const old = await openDB(name, 2, {
      upgrade(database) {
        database.createObjectStore("meta");
        database.createObjectStore("syncState");
        database.createObjectStore("documents", { keyPath: "id" }).createIndex("by_workspace", "workspaceId");
        database.createObjectStore("blocks", { keyPath: "documentId" });
        database.createObjectStore("uploads", { keyPath: "uploadId" });
      },
    });
    const queued = { ...sync.emptySyncState(), pending: [legacyCreate("op-q", "doc-q", "ws-old-personal")] };
    await old.put("syncState", queued, ACCOUNT_SYNC_KEY);
    await old.put("meta", "web-device-kept", "deviceId");
    await old.put("documents", { id: "doc-cached", workspaceId: "ws-old-personal", title: "Cached" });
    await old.put("blocks", { documentId: "doc-cached", workspaceId: "ws-old-personal", blocks: [], cachedAt: 1 });
    await old.put("uploads", { uploadId: "up-1", workspaceId: "ws-old-personal", documentId: "doc-q", blockId: "b-1", kind: "image", filename: "a.png", mimeType: "image/png", size: 3, blob: new Blob(["abc"]), attempts: 0, nextAttemptAt: 0 });
    old.close();

    const db = await localDb(accountKey);
    expect(db.version).toBe(DB_VERSION);
    expect(await db.get("syncState", ACCOUNT_SYNC_KEY)).toEqual(queued);
    expect(await db.get("meta", "deviceId")).toBe("web-device-kept");
    expect(await db.count("documents")).toBe(0);
    expect([...db.transaction("documents").store.indexNames]).toEqual(["by_scope"]);
    const upload = (await db.get("uploads", "up-1")) as unknown as Record<string, unknown>;
    expect(upload.documentId).toBe("doc-q");
    expect("workspaceId" in upload).toBe(false);
    expect(await db.get("blocks", "doc-cached")).toBeDefined();
  });
});
