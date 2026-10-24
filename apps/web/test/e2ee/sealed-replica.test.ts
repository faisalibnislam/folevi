// An encrypted space's replica stays encrypted at rest (lib/e2ee/replica/sealedReplicaDb.ts,
// docs/NATIVE_APP_PLAN.md §11.6): what reaches the database is ciphertext under a non-extractable device key,
// opened only when the replica loads into memory; rows an older build wrote readable are sealed on load.
import { describe, expect, test } from "vitest";
import { MemoryReplicaDb, rowKey } from "@/lib/local/store/replicaDb";
import { decodeValue, encodeValue, LOCAL_KEY_STATE, SealedReplicaDb } from "@/lib/e2ee/replica/sealedReplicaDb";
import { openReplicaDb, SpaceReplicaStore } from "@/lib/e2ee/replica/store";

const SECRET = "the surprise party is on Friday";
const doc = { id: "doc1", title: SECRET, sealed: { c: new Uint8Array([1, 2, 3]).buffer, k: 2 }, hash: new Uint8Array([9, 8, 7]) };

function rawText(db: MemoryReplicaDb): string {
  const parts: string[] = [];
  const dump = (v: unknown) => {
    if (v instanceof ArrayBuffer) parts.push(new TextDecoder().decode(v));
    else if (v instanceof Uint8Array) parts.push(new TextDecoder().decode(v));
    else if (v && typeof v === "object") for (const x of Object.values(v)) dump(x);
    else parts.push(String(v));
  };
  for (const m of [db.rows, db.notes, db.state]) for (const v of m.values()) dump(v);
  return parts.join(" ");
}

describe("the encrypted replica at rest", () => {
  test("rows and bookkeeping are ciphertext in the database and readable after loading", async () => {
    const inner = new MemoryReplicaDb();
    const db = new SealedReplicaDb(inner);
    await db.write({ rows: [[rowKey("documents", undefined, "doc1"), doc]], state: [["searchIndex", { words: [SECRET] }]] });
    expect(rawText(inner)).not.toContain("surprise");
    const key = inner.state.get(LOCAL_KEY_STATE) as CryptoKey;
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();

    const reopened = new SealedReplicaDb(inner);
    const snap = await reopened.load();
    const row = snap.rows.get(rowKey("documents", undefined, "doc1")) as typeof doc;
    expect(row.title).toBe(SECRET);
    expect(new Uint8Array(row.sealed.c)).toEqual(new Uint8Array([1, 2, 3]));
    expect(row.hash).toEqual(new Uint8Array([9, 8, 7]));
    expect(snap.state.get("searchIndex")).toEqual({ words: [SECRET] });
    // The key itself isn't handed to the replica as bookkeeping.
    expect(snap.state.has(LOCAL_KEY_STATE)).toBe(false);
  });

  test("a replica written readable by an older build is sealed on its first load", async () => {
    const inner = new MemoryReplicaDb();
    await inner.write({ rows: [[rowKey("documents", undefined, "doc1"), { id: "doc1", title: SECRET }]] });
    expect(rawText(inner)).toContain("surprise");
    const snap = await new SealedReplicaDb(inner).load();
    expect((snap.rows.get(rowKey("documents", undefined, "doc1")) as { title: string }).title).toBe(SECRET);
    expect(rawText(inner)).not.toContain("surprise");
  });

  test("deletes pass through, and the store opened over it reads what it ingested", async () => {
    const inner = new MemoryReplicaDb();
    const db = new SealedReplicaDb(inner);
    const store = new SpaceReplicaStore(db);
    await store.ingest([{ table: "documents", id: "doc1", value: { ...doc } } as never]);
    expect(rawText(inner)).not.toContain("surprise");
    const again = new SpaceReplicaStore(new SealedReplicaDb(inner));
    await again.load();
    expect(((await again.get("documents", "doc1")) as unknown as { title: string }).title).toBe(SECRET);
    await db.write({ rows: [[rowKey("documents", undefined, "doc1"), null]] });
    expect(inner.rows.size).toBe(0);
  });

  test("a trusted device's replica database is the sealed one; a public session's stays in memory", async () => {
    expect(await openReplicaDb("personal:p1", true, "p1")).toBeInstanceOf(SealedReplicaDb);
    expect(await openReplicaDb("personal:p1", false, "p1")).toBeInstanceOf(MemoryReplicaDb);
  });

  test("binary values round-trip through the encoding", () => {
    const v = { a: new Uint8Array([0, 255]).buffer, b: new Uint8Array([5]), n: [1, "x", null] };
    const back = decodeValue(encodeValue(v)) as typeof v;
    expect(new Uint8Array(back.a)).toEqual(new Uint8Array([0, 255]));
    expect(back.b).toEqual(new Uint8Array([5]));
    expect(back.n).toEqual([1, "x", null]);
  });
});
