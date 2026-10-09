// Ops sent once and queued again (no answer came back), and what the person did to a block after an op that
// came back as a conflict.
import { describe, expect, it } from "vitest";
import { sync } from "../src";
import type { OpResult, SyncOp, SyncState, WireBlock } from "../src";

const DOC = "doc-1";
const block = (id: string, text: string): WireBlock => ({ id, type: "paragraph", parentId: null, rank: "V", schemaVersion: 1, text: [{ type: "text", text }], props: {} });
const upserts = (s: SyncState) => s.pending.filter((op): op is Extract<SyncOp, { kind: "block.upsert" }> => op.kind === "block.upsert");
const textOf = (b: WireBlock) => (b.text[0] as { text: string }).text;

describe("resending", () => {
  it("never merges new typing into an op that was sent, and sends the next one after its answer", () => {
    let s = sync.localUpsert(sync.emptySyncState(), { opId: "op-hello-0001", documentId: DOC, block: block("b1", "Hello"), fields: ["content", "position"] });
    s = sync.takeBatch(s);
    expect(s.inflight[0]!.sent).toBe(true);
    // No answer (it may have landed): queued again, then the person keeps typing.
    s = sync.batchFailed(s, "server");
    s = sync.localUpsert(s, { opId: "op-world-0001", documentId: DOC, block: block("b1", "Hello world"), fields: ["content"] });
    expect(upserts(s).map((op) => [op.opId, textOf(op.block)])).toEqual([
      ["op-hello-0001", "Hello"],
      ["op-world-0001", "Hello world"],
    ]);
    // The second waits for the first's answer (sent together, it would be based on no version at all).
    s = sync.takeBatch(s);
    expect(s.inflight.map((op) => op.opId)).toEqual(["op-hello-0001"]);
    s = sync.applyResults(s, [{ opId: "op-hello-0001", status: "duplicate", revision: 1, block: { ...block("b1", "Hello"), revision: 1 } }]);
    expect(s.pending.map((op) => [op.opId, "baseRevision" in op ? op.baseRevision : null])).toEqual([["op-world-0001", 1]]);
    expect(textOf(s.blocks.b1!.block)).toBe("Hello world");
  });

  it("queues the local text again when a replay answers with something else", () => {
    // An op whose content changed after it was first sent (older builds merged typing into it).
    let s = sync.localUpsert(sync.emptySyncState(), { opId: "op-merged-001", documentId: DOC, block: block("b1", "Hello world"), fields: ["content", "position"] });
    s = sync.takeBatch(s);
    const answer: OpResult = { opId: "op-merged-001", status: "duplicate", revision: 1, block: { ...block("b1", "Hello"), revision: 1 } };
    s = sync.applyResults(s, [answer]);
    expect(textOf(s.blocks.b1!.block)).toBe("Hello world");
    expect(upserts(s).map((op) => [op.opId, textOf(op.block), op.baseRevision])).toEqual([["op-merged-001-again", "Hello world", null]]);
    // The same text with a page link's label served differently is not "something else".
    let t = sync.localUpsert(sync.emptySyncState(), {
      opId: "op-link-00001",
      documentId: DOC,
      block: { ...block("b2", ""), text: [{ type: "pageLink", documentId: "p1", label: "Old title" }] },
      fields: ["content"],
    });
    t = sync.takeBatch(t);
    t = sync.applyResults(t, [{ opId: "op-link-00001", status: "duplicate", revision: 2, block: { ...block("b2", ""), text: [{ type: "pageLink", documentId: "p1", label: "New title" }], revision: 2 } }]);
    expect(t.pending).toEqual([]);
  });

  it("a delete never cancels a sent delete, and a sent upsert stays before a delete", () => {
    let s: SyncState = { ...sync.emptySyncState(), blocks: { b1: { documentId: DOC, block: block("b1", "x"), serverRevision: 3, deleted: false } } };
    s = sync.localDelete(s, { opId: "op-delete-001", documentId: DOC, blockId: "b1" });
    s = sync.batchFailed(sync.takeBatch(s), "server");
    s = sync.localRestore(s, { opId: "op-restore-01", documentId: DOC, blockId: "b1" });
    expect(s.pending.map((op) => op.kind)).toEqual(["block.delete", "block.restore"]);

    let u: SyncState = { ...sync.emptySyncState(), blocks: { b2: { documentId: DOC, block: block("b2", "x"), serverRevision: 3, deleted: false } } };
    u = sync.localUpsert(u, { opId: "op-edit-00001", documentId: DOC, block: block("b2", "y"), fields: ["content"] });
    u = sync.batchFailed(sync.takeBatch(u), "server");
    u = sync.localDelete(u, { opId: "op-delete-002", documentId: DOC, blockId: "b2" });
    expect(u.pending.map((op) => op.kind)).toEqual(["block.upsert", "block.delete"]);
    u = sync.takeBatch(u);
    expect(u.inflight.map((op) => op.kind)).toEqual(["block.upsert"]);
  });
});

describe("conflicts and what came after", () => {
  const conflictOn = (s: SyncState, opId: string, server: WireBlock, reason: "content" | "deleted" = "content") =>
    sync.applyResults(s, [{ opId, status: "conflict", revision: 5, block: { ...server, revision: 5 }, conflict: { reason, server: { ...server, revision: 5 }, client: null } }]);

  const sentEdit = () => {
    let s: SyncState = { ...sync.emptySyncState(), blocks: { b1: { documentId: DOC, block: block("b1", "base"), serverRevision: 3, deleted: false } } };
    s = sync.localUpsert(s, { opId: "op-edit-00001", documentId: DOC, block: block("b1", "mine"), fields: ["content"] });
    return sync.takeBatch(s);
  };

  it("deleted after the edit: the question is whether to keep the other version", () => {
    let s = sentEdit();
    s = sync.localDelete(s, { opId: "op-delete-001", documentId: DOC, blockId: "b1" });
    s = conflictOn(s, "op-edit-00001", block("b1", "theirs"));
    expect(s.conflicts.map((c) => c.reason)).toEqual(["edited"]);
    expect(s.pending).toEqual([]);
  });

  it("deleted after the edit, and deleted elsewhere too: nothing to ask", () => {
    let s = sentEdit();
    s = sync.localDelete(s, { opId: "op-delete-001", documentId: DOC, blockId: "b1" });
    s = conflictOn(s, "op-edit-00001", block("b1", "theirs"), "deleted");
    expect(s.conflicts).toEqual([]);
    expect(s.blocks.b1!.deleted).toBe(true);
  });

  it("moved after the edit: the move stays whichever version is kept", () => {
    let s = sentEdit();
    s = sync.localUpsert(s, { opId: "op-move-00001", documentId: DOC, block: { ...block("b1", "mine"), rank: "a" }, fields: ["position"] });
    s = conflictOn(s, "op-edit-00001", block("b1", "theirs"));
    expect(s.conflicts[0]!.moved).toBe(true);
    const theirs = sync.resolveConflict(s, { conflictId: "op-edit-00001", choice: "theirs", opId: "op-resolve-01" });
    expect(theirs.blocks.b1!.block.rank).toBe("a");
    expect(textOf(theirs.blocks.b1!.block)).toBe("theirs");
  });

  it("a delete taken back and edited: an ordinary conflict that shows the person's text", () => {
    let s: SyncState = { ...sync.emptySyncState(), blocks: { b1: { documentId: DOC, block: block("b1", "base"), serverRevision: 3, deleted: false } } };
    s = sync.takeBatch(sync.localDelete(s, { opId: "op-delete-001", documentId: DOC, blockId: "b1" }));
    s = sync.localRestore(s, { opId: "op-restore-01", documentId: DOC, blockId: "b1" });
    s = sync.localUpsert(s, { opId: "op-edit-00001", documentId: DOC, block: block("b1", "mine again"), fields: ["content"] });
    s = conflictOn(s, "op-delete-001", block("b1", "theirs"));
    expect(s.conflicts.map((c) => [c.reason, textOf(c.client)])).toEqual([["content", "mine again"]]);
  });
});
