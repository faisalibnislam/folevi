import { describe, expect, test, vi } from "vitest";
import type { ConvexReactClient } from "convex/react";
import { Editor } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { rankSequence, SCHEMA_VERSION, sync, type WireBlock, type WireScope } from "@folevi/editor-schema";
import { mergeJournal, SyncEngine } from "@/lib/sync/engine";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap } from "@/components/editor/plugins";
import { blocksToDoc } from "@/components/editor/convert";
import { remoteTransaction } from "@/components/editor/remoteApply";

const PERSONAL: WireScope = { kind: "personal" };
const ranks = rankSequence(10);
const para = (id: string, text: string, i = 0): WireBlock => ({
  id,
  type: "paragraph",
  parentId: null,
  rank: ranks[i]!,
  schemaVersion: SCHEMA_VERSION,
  text: text ? [{ type: "text", text }] : [],
  props: {},
});
const textOf = (b: WireBlock | undefined) => (b?.text[0] as { text?: string } | undefined)?.text;

describe("sync conflicts keep what the person typed", () => {
  test("edits to a conflicted block update the conflict, and Keep mine saves the newest", async () => {
    let answer: (op: { opId: string; kind: string; block?: WireBlock }) => unknown = (o) => ({ opId: o.opId, status: "applied", revision: 1, block: { ...o.block!, revision: 1 } });
    const client = { mutation: vi.fn(async (_fn: unknown, args: { ops: { opId: string; kind: string; block?: WireBlock }[] }) => args.ops.map((o) => answer(o))) } as unknown as ConvexReactClient;
    const engine = await SyncEngine.open(client, "acct-conflict", PERSONAL, "web-c");
    engine.setOnline(true);
    engine.upsertBlock("doc-1", para("b1", "first"), ["content"]);
    await engine.flush();
    // Someone else changed it meanwhile: the server refuses ours.
    answer = (o) => ({ opId: o.opId, status: "conflict", conflict: { reason: "content", server: { ...para("b1", "theirs"), revision: 2 }, client: o.block } });
    engine.upsertBlock("doc-1", para("b1", "mine"), ["content"]);
    await engine.flush();
    expect(engine.state.conflicts).toHaveLength(1);
    // The editor keeps showing (and the person keeps typing in) their own version.
    expect(textOf(engine.documentBlocks("doc-1")[0])).toBe("mine");
    engine.upsertBlock("doc-1", para("b1", "mine, and more"), ["content"]);
    expect(engine.state.pending).toHaveLength(0);
    expect(textOf(engine.documentBlocks("doc-1")[0])).toBe("mine, and more");
    engine.resolveConflict(engine.state.conflicts[0]!.id, "mine");
    const op = engine.state.pending.find((p) => p.kind === "block.upsert");
    expect(op && op.kind === "block.upsert" && textOf(op.block)).toBe("mine, and more");
  });

  test("Keep theirs shows the other version", async () => {
    const client = {
      mutation: vi.fn(async (_fn: unknown, args: { ops: { opId: string; block?: WireBlock }[] }) =>
        args.ops.map((o) => ({ opId: o.opId, status: "conflict", conflict: { reason: "content", server: { ...para("b1", "theirs"), revision: 2 }, client: o.block } })),
      ),
    } as unknown as ConvexReactClient;
    const engine = await SyncEngine.open(client, "acct-conflict-2", PERSONAL, "web-c2");
    engine.setOnline(true);
    engine.upsertBlock("doc-1", para("b1", "mine"), ["content"]);
    await engine.flush();
    engine.resolveConflict(engine.state.conflicts[0]!.id, "theirs");
    expect(textOf(engine.documentBlocks("doc-1")[0])).toBe("theirs");
  });
});

describe("the unload journal", () => {
  test("replaces an op with its newer copy and adds the ones IndexedDB never saved", () => {
    const state = { ...sync.emptySyncState() };
    state.pending = [{ opId: "a", kind: "block.upsert", documentId: "d", block: para("b1", "old"), baseRevision: null, fields: ["content"] }];
    state.blocks = { b1: { documentId: "d", block: para("b1", "old"), serverRevision: null, deleted: false } };
    const merged = mergeJournal(state, [
      { opId: "a", kind: "block.upsert", documentId: "d", block: para("b1", "newer"), baseRevision: null, fields: ["content"] },
      { opId: "b", kind: "block.upsert", documentId: "d", block: para("b2", "typed last"), baseRevision: null, fields: ["content", "position"] },
    ]);
    expect(merged.pending.map((p) => p.opId)).toEqual(["a", "b"]);
    expect(textOf(merged.blocks.b1!.block)).toBe("newer");
    expect(textOf(merged.blocks.b2!.block)).toBe("typed last");
  });

  test("changes made while the page is closing are written to localStorage and come back", async () => {
    const client = { mutation: vi.fn(async () => { throw new Error("offline"); }) } as unknown as ConvexReactClient;
    const engine = await SyncEngine.open(client, "acct-journal", PERSONAL, "web-j");
    engine.setOnline(false);
    window.dispatchEvent(new Event("pagehide"));
    engine.upsertBlock("doc-1", para("b1", "last words"), ["content", "position"]);
    expect(localStorage.getItem("folevi:sync-journal:acct-journal")).toContain("last words");
    const reopened = await SyncEngine.open(client, "acct-journal", PERSONAL, "web-j");
    expect(textOf(reopened.documentBlocks("doc-1")[0])).toBe("last words");
    expect(localStorage.getItem("folevi:sync-journal:acct-journal")).toBeNull();
  });
});

describe("remote deletes and the caret", () => {
  test("when my line is deleted elsewhere, the caret goes to the end of the line before it", () => {
    const e = new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, UndoRedo, BlockIdentity, BlockKeymap], content: blocksToDoc([para("A", "alpha", 0), para("B", "beta", 1), para("C", "gamma", 2)]) });
    let inC = 0;
    e.state.doc.forEach((n, o) => {
      if (n.attrs.id === "C") inC = o + 3;
    });
    e.commands.setTextSelection(inC);
    const tr = remoteTransaction(e.state, [para("A", "alpha", 0), para("B", "beta", 1)])!;
    e.view.dispatch(tr);
    const $head = e.state.selection.$head;
    expect($head.parent.attrs.id).toBe("B");
    expect($head.parentOffset).toBe(4);
    e.destroy();
  });
});

describe("line breaks", () => {
  test("bold text with two line breaks in a row stays one bold run", async () => {
    const { pmInline, blockToNode } = await import("@/components/editor/convert");
    const block = { ...para("b1", ""), text: [{ type: "text" as const, text: "one\n\ntwo", marks: [{ type: "bold" as const }] }] };
    const e = new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS], content: { type: "doc", content: [blockToNode(block, 0)] } });
    expect(pmInline(e.state.doc.child(0))).toEqual(block.text);
    e.destroy();
  });
});
