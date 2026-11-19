// Local mode's sync.push with many new lines at once (a long paste, an import): how many blocks a note holds
// is counted once in a batch, not once for every new line (which read a copy of every block of the note each
// time: 2,000 pasted lines made four million copies and kept the page busy for half a minute), and the limit
// on a note's size still holds inside one batch.
import { describe, expect, test, vi } from "vitest";
import { LIMITS, rankSequence, ulid, type SyncOp, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { LocalBackend, LocalClient, MemoryStore } from "@/lib/local";

type Result = { status: string; error?: { code: string } };

async function library() {
  const store = new MemoryStore();
  const client = new LocalClient(new LocalBackend(store, { deviceId: "dev_here" }));
  await client.local.setup({ timeZone: "UTC", locale: "en", displayName: "Sam", seed: false });
  const push = (ops: SyncOp[]) => client.mutation(api.sync.push, { scope: { kind: "personal" }, deviceId: "engine-device-1", ops: ops as never }) as Promise<Result[]>;
  const documentId = ulid();
  await push([{ opId: ulid(), kind: "document.create", document: { id: documentId, parentDocumentId: null, folderId: null, kind: "document", title: "Long", icon: null } }]);
  return { store, client, push, documentId };
}

// Ranks spread over the whole note, as a paste makes them.
const ranks = rankSequence(LIMITS.maxBlocksPerDocument + 300);
let n = 0;
const line = (): WireBlock => ({ id: ulid(), type: "paragraph", parentId: null, rank: ranks[n++ % ranks.length]!, schemaVersion: 1, text: [{ type: "text", text: "A line" }], props: {} });
const create = (documentId: string, block: WireBlock): SyncOp => ({ opId: ulid(), kind: "block.upsert", documentId, block, baseRevision: null, fields: ["content", "position"] });

describe("local sync.push with many new lines", () => {
  test("the note's blocks are not read again for every new line", async () => {
    const { store, client, push, documentId } = await library();
    await push(Array.from({ length: 100 }, () => create(documentId, line())));
    const list = vi.spyOn(store, "list");
    const results = await push(Array.from({ length: 100 }, () => create(documentId, line())));
    expect(results.every((r) => r.status === "applied")).toBe(true);
    const reads = list.mock.calls.filter(([table, partition]) => table === "blocks" && partition === documentId).length;
    // (Once for the count, and the few the end of a batch makes for the note's search text and links.)
    expect(reads).toBeLessThan(10);
    client.close();
  });

  test("a note still stops at its limit inside one batch, and a deleted line makes room", { timeout: 120_000 }, async () => {
    const { client, push, documentId } = await library();
    const first = line();
    await push([create(documentId, first)]);
    for (let have = 1; have < LIMITS.maxBlocksPerDocument - 1; ) {
      const count = Math.min(100, LIMITS.maxBlocksPerDocument - 1 - have);
      await push(Array.from({ length: count }, () => create(documentId, line())));
      have += count;
    }
    // One short of the limit: the first new line fits, the second doesn't.
    const [fits, over] = await push([create(documentId, line()), create(documentId, line())]);
    expect(fits!.status).toBe("applied");
    expect(over).toMatchObject({ status: "rejected", error: { code: "limit_exceeded" } });
    // A line deleted in the same batch makes room for one more, and only one.
    const [gone, again, tooMany] = await push([{ opId: ulid(), kind: "block.delete", documentId, blockId: first.id, baseRevision: 1 }, create(documentId, line()), create(documentId, line())]);
    expect(gone!.status).toBe("applied");
    expect(again!.status).toBe("applied");
    expect(tooMany).toMatchObject({ status: "rejected", error: { code: "limit_exceeded" } });
    // Bringing the deleted line back counts too.
    const [back] = await push([{ opId: ulid(), kind: "block.restore", documentId, blockId: first.id }]);
    expect(back!.status).toBe("applied");
    const [full] = await push([create(documentId, line())]);
    expect(full).toMatchObject({ status: "rejected", error: { code: "limit_exceeded" } });
    client.close();
  });
});
