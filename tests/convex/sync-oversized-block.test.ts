// A block too large to store. The backend keeps a block as one document of at most 1 MiB; a table had no
// size limit, so one could be made that the write failed on. That failure had no code: the whole batch failed
// with it and was sent again for ever, with every later change waiting behind it. validateWireBlock now says
// such a block is too large, so it is refused on its own and the rest of the batch goes through.
import { describe, expect, test } from "vitest";
import { LIMITS, MAX_BLOCK_BYTES, SCHEMA_VERSION, jsonBytes, type SyncOp, type WireBlock } from "@folevi/editor-schema";
import { api } from "../../convex/_generated/api";
import { para, person, PERSONAL, setup, ulid } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const push = (p: Person, ops: SyncOp[]) => p.as.mutation(api.sync.push, { scope: PERSONAL, deviceId: "device-oversized", ops: ops as never });
const upsert = (documentId: string, block: WireBlock, baseRevision: number | null): SyncOp => ({ opId: ulid(), kind: "block.upsert", documentId, block, baseRevision, fields: ["content", "position"] });

async function newPage(p: Person) {
  const id = ulid();
  await push(p, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title: "Plan", icon: null } as never }]);
  return id;
}

/** A table with every cell of the largest shape holding `cell`. */
const table = (id: string, rank: string, cell: string): WireBlock =>
  ({
    id,
    type: "table",
    parentId: null,
    rank,
    schemaVersion: SCHEMA_VERSION,
    text: [],
    props: { headerRow: true, rows: Array.from({ length: LIMITS.maxTableRows }, () => Array.from({ length: LIMITS.maxTableColumns }, () => [{ type: "text", text: cell }])) },
  }) as unknown as WireBlock;

describe("a block too large to store", () => {
  test("is refused on its own, with a code, and the changes sent with it are applied", async () => {
    const t = setup();
    const a = await person(t, "oversized@example.com");
    const doc = await newPage(a);
    // The audit's table: 200 rows by 20 columns of 300 characters, 1.3 MB.
    const huge = table(ulid(), "b", "x".repeat(300));
    expect(jsonBytes(huge)).toBeGreaterThan(1024 * 1024);
    const before = para(ulid(), "typed before the table");
    const after = { ...para(ulid(), "typed after the table"), rank: "c" };
    const results = await push(a, [upsert(doc, before, null), upsert(doc, huge, null), upsert(doc, after, null)]);
    expect(results.map((r) => r.status)).toEqual(["applied", "rejected", "applied"]);
    expect(results[1]!.error).toMatchObject({ code: "invalid_block", message: expect.stringMatching(/too large/) });
    const blocks = (await a.as.query(api.blocks.list, { documentId: doc }))!.blocks;
    expect(blocks.map((b) => b.id).sort()).toEqual([before.id, after.id].sort());
    // Sent again as it is (a retry): the same answer, not an error that fails the batch.
    const again = await push(a, [upsert(doc, huge, null)]);
    expect(again[0]!.status).toBe("rejected");
  });

  test("a large table that can be stored still is, and a later change that would pass the limit leaves it as it was", async () => {
    const t = setup();
    const a = await person(t, "large-table@example.com");
    const doc = await newPage(a);
    // About 500 KB: more than the editor lets a table grow to, well inside what is stored.
    const large = table(ulid(), "b", "y".repeat(100));
    expect(jsonBytes(large)).toBeLessThan(MAX_BLOCK_BYTES);
    const [made] = await push(a, [upsert(doc, large, null)]);
    expect(made!.status).toBe("applied");
    const [grown] = await push(a, [upsert(doc, table(large.id, "b", "y".repeat(300)), 1)]);
    expect(grown!.status).toBe("rejected");
    expect(grown!.error?.code).toBe("invalid_block");
    const kept = (await a.as.query(api.blocks.list, { documentId: doc }))!.blocks.find((b) => b.id === large.id)!;
    expect(jsonBytes(kept.props)).toBeLessThan(MAX_BLOCK_BYTES);
    expect(((kept.props as { rows: { text: string }[][][] }).rows[0]![0]![0]!.text ?? "").length).toBe(100);
  });
});
