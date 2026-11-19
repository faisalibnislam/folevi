// A queue longer than one run of the send loop takes (2,000 changes: a very long paste, a long time offline):
// the rest is sent in a turn of its own. It used to wait for the next edit or reconnect, with "Saving" showing.
import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
import type { ConvexReactClient } from "convex/react";
import { rankSequence, type SyncOp, type WireBlock, type WireScope } from "@folevi/editor-schema";
import { SyncEngine } from "@/lib/sync/engine";

const PERSONAL: WireScope = { kind: "personal" };

test("more queued changes than one run sends all go out without another edit", { timeout: 60_000 }, async () => {
  const batches: number[] = [];
  const client = {
    mutation: vi.fn(async (_fn: unknown, args: { ops: SyncOp[] }) => {
      batches.push(args.ops.length);
      return args.ops.map((op) => ({ opId: op.opId, status: "applied", revision: 1, ...(op.kind === "block.upsert" ? { block: { ...op.block, revision: 1 }, deleted: false } : {}) }));
    }),
  } as unknown as ConvexReactClient;
  const engine = await SyncEngine.open(client, "acct-long-queue", PERSONAL, "web-long");
  engine.setOnline(false);
  const ranks = rankSequence(2100);
  engine.batch(() => {
    for (let i = 0; i < 2100; i++) {
      const block: WireBlock = { id: `B${String(i).padStart(5, "0")}`, type: "paragraph", parentId: null, rank: ranks[i]!, schemaVersion: 1, text: [{ type: "text", text: `Line ${i}` }], props: {} };
      engine.upsertBlock("doc-long", block, ["content", "position"]);
    }
  });
  expect(engine.pendingCount()).toBe(2100);
  engine.setOnline(true);
  await engine.flush();
  for (let i = 0; i < 200 && engine.pendingCount() > 0; i++) await new Promise((r) => setTimeout(r, 25));
  expect(engine.pendingCount()).toBe(0);
  expect(batches.reduce((a, b) => a + b, 0)).toBe(2100);
  expect(batches.length).toBeGreaterThan(20);
  engine.dispose();
});
