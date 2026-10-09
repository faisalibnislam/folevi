import { describe, expect, test, vi } from "vitest";
import type { ConvexReactClient } from "convex/react";
import { sync, type SyncState, type WireBlock, type WireScope } from "@folevi/editor-schema";
import { SyncEngine } from "@/lib/sync/engine";
import { ACCOUNT_SYNC_KEY, SYNC_BLOCK_PREFIX, localDb, syncBlockKeys } from "@/lib/sync/db";

const PERSONAL: WireScope = { kind: "personal" };
const offline = { mutation: vi.fn(async () => Promise.reject(new Error("offline"))) } as unknown as ConvexReactClient;
const block = (id: string, text: string, rank = "V"): WireBlock => ({ id, type: "paragraph", parentId: null, rank, schemaVersion: 1, text: [{ type: "text", text }], props: {} });
const texts = (engine: SyncEngine, documentId: string) => engine.documentBlocks(documentId).map((b) => (b.text[0] as { text: string }).text);

async function open(accountKey: string) {
  const engine = await SyncEngine.open(offline, accountKey, PERSONAL, "web-dev");
  engine.setOnline(false);
  return engine;
}

describe("sync state on the device", () => {
  test("a state saved the old way (blocks inside the account record) loads, and moves to a record per block on its first save", async () => {
    const old: SyncState = sync.emptySyncState();
    old.blocks.a = { documentId: "doc", block: block("a", "kept", "M"), serverRevision: 3, deleted: false };
    old.blocks.b = { documentId: "doc", block: block("b", "queued", "V"), serverRevision: null, deleted: false };
    old.pending.push({ opId: "op1", kind: "block.upsert", documentId: "doc", block: block("b", "queued", "V"), baseRevision: null, fields: ["content", "position"] });
    await (await localDb("acct-old-layout")).put("syncState", old, ACCOUNT_SYNC_KEY);

    const engine = await open("acct-old-layout");
    expect(texts(engine, "doc")).toEqual(["kept", "queued"]);
    expect(engine.state.pending).toHaveLength(1);
    engine.batch(() => engine.upsertBlock("doc", block("c", "new", "Z"), ["content", "position"]));
    await engine.persisted();

    const db = await localDb("acct-old-layout");
    expect((await db.get("syncState", ACCOUNT_SYNC_KEY))!.blocks).toEqual({});
    expect((await db.getAllKeys("meta", syncBlockKeys())).sort()).toEqual(["a", "b", "c"].map((id) => SYNC_BLOCK_PREFIX + id));
    engine.dispose();
    const reopened = await open("acct-old-layout");
    expect(texts(reopened, "doc")).toEqual(["kept", "queued", "new"]);
    expect(reopened.state.pending).toHaveLength(2);
    expect(reopened.state.blocks.a!.serverRevision).toBe(3);
    reopened.dispose();
  });

  test("each save writes only what changed, and a reopened engine has every change, deletes included", async () => {
    const engine = await open("acct-incremental");
    engine.batch(() => {
      for (const [id, text, rank] of [["a", "one", "M"], ["b", "two", "V"], ["c", "three", "Z"]] as const) engine.upsertBlock("doc", block(id, text, rank), ["content", "position"]);
    });
    await engine.persisted();
    const db = await localDb("acct-incremental");
    const puts = vi.spyOn(IDBObjectStore.prototype, "put");
    engine.batch(() => engine.upsertBlock("doc", block("b", "two, edited", "V"), ["content"]));
    engine.batch(() => engine.deleteBlock("doc", "c"));
    await engine.persisted();
    // The edited block and the account record (twice: two saves at most), never the untouched block.
    const keys = puts.mock.calls.map((call) => String(call[1]));
    puts.mockRestore();
    expect(keys).not.toContain(`${SYNC_BLOCK_PREFIX}a`);
    expect(keys).toContain(`${SYNC_BLOCK_PREFIX}b`);
    expect(await db.get("meta", `${SYNC_BLOCK_PREFIX}c`)).toBeUndefined();
    engine.dispose();
    const reopened = await open("acct-incremental");
    expect(texts(reopened, "doc")).toEqual(["one", "two, edited"]);
    reopened.dispose();
  });

  test("a batch changes a private copy: the state it started from is untouched, and listeners hear once", async () => {
    const engine = await open("acct-batch");
    engine.batch(() => engine.upsertBlock("doc", block("a", "one", "M"), ["content", "position"]));
    const before = engine.state;
    const blocksBefore = { ...before.blocks };
    const pendingBefore = [...before.pending];
    let heard = 0;
    engine.subscribe(() => heard++);
    engine.batch(() => {
      engine.upsertBlock("doc", block("a", "one, edited", "M"), ["content"]);
      engine.upsertBlock("doc", block("b", "two", "V"), ["content", "position"]);
      engine.deleteBlock("doc", "a");
    });
    expect(before.blocks).toEqual(blocksBefore);
    expect(before.pending).toEqual(pendingBefore);
    expect(engine.state).not.toBe(before);
    expect(texts(engine, "doc")).toEqual(["two"]);
    expect(heard).toBe(1);
    // After the batch the state is an ordinary one again: a later change copies it.
    const after = engine.state;
    engine.upsertBlock("doc", block("c", "three", "Z"), ["content", "position"]);
    expect(after.blocks.c).toBeUndefined();
    // An empty batch changes nothing.
    const now = engine.state;
    engine.batch(() => undefined);
    expect(engine.state).toBe(now);
    engine.dispose();
  });
});
