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
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    engine.upsertBlock("doc-1", para("b1", "last words"), ["content", "position"]);
    const key = Object.keys(localStorage).find((k) => k.startsWith("folevi:sync-journal:acct-journal:"))!;
    expect(localStorage.getItem(key)).toContain("last words");
    // A reload: the same tab reads its own journal back (and removes it once IndexedDB has it).
    engine.dispose();
    const reopened = await SyncEngine.open(client, "acct-journal", PERSONAL, "web-j");
    expect(textOf(reopened.documentBlocks("doc-1")[0])).toBe("last words");
    await reopened.persisted();
    await new Promise((r) => setTimeout(r, 0));
    expect(localStorage.getItem(key)).toBeNull();
  });

  test("a hidden tab's journal is left alone; a closed tab's is taken over", async () => {
    const client = { mutation: vi.fn(async () => { throw new Error("offline"); }) } as unknown as ConvexReactClient;
    localStorage.setItem("folevi:sync-journal:acct-tabs:other-hidden", JSON.stringify({ ops: [{ opId: "h", kind: "block.upsert", documentId: "d", block: para("bh", "hidden tab"), baseRevision: null, fields: ["content"] }], closed: false }));
    localStorage.setItem("folevi:sync-journal:acct-tabs:other-closed", JSON.stringify({ ops: [{ opId: "c", kind: "block.upsert", documentId: "d", block: para("bc", "closed tab"), baseRevision: null, fields: ["content"] }], closed: true }));
    const engine = await SyncEngine.open(client, "acct-tabs", PERSONAL, "web-t");
    expect(engine.state.pending.map((p) => p.opId)).toEqual(["c"]);
    await engine.persisted();
    await new Promise((r) => setTimeout(r, 0));
    expect(localStorage.getItem("folevi:sync-journal:acct-tabs:other-closed")).toBeNull();
    expect(localStorage.getItem("folevi:sync-journal:acct-tabs:other-hidden")).not.toBeNull();
    engine.dispose();
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

describe("sync reducer, round four", () => {
  test("deleting a block drops its unsent edits, so the delete isn't refused as a conflict with ourselves", () => {
    let state = sync.emptySyncState();
    state.blocks = { b1: { documentId: "d", block: para("b1", "saved"), serverRevision: 5, deleted: false } };
    state = sync.localUpsert(state, { opId: "u", documentId: "d", block: para("b1", "edited"), fields: ["content"] });
    state = sync.localDelete(state, { opId: "x", documentId: "d", blockId: "b1" });
    expect(state.pending.map((p) => `${p.kind}:${p.opId}`)).toEqual(["block.delete:x"]);
    expect(state.pending[0]!.kind === "block.delete" && state.pending[0]!.baseRevision).toBe(5);
  });

  test("a block moved while its conflict is open stays where it was put, whichever version is kept", () => {
    const base = sync.emptySyncState();
    base.blocks = { b1: { documentId: "d", block: { ...para("b1", "theirs"), rank: "a" }, serverRevision: 2, deleted: false } };
    base.conflicts = [{ id: "c", documentId: "d", blockId: "b1", reason: "content", server: { ...para("b1", "theirs"), rank: "a" }, client: { ...para("b1", "mine"), rank: "z" }, moved: true }];
    const mine = sync.resolveConflict(base, { conflictId: "c", choice: "mine", opId: "m" });
    const m = mine.pending.find((p) => p.kind === "block.upsert");
    expect(m && m.kind === "block.upsert" && [m.block.rank, textOf(m.block), m.fields.join()]).toEqual(["z", "mine", "content,position"]);
    const theirs = sync.resolveConflict(base, { conflictId: "c", choice: "theirs", opId: "t" });
    const t = theirs.pending.find((p) => p.kind === "block.upsert");
    expect(t && t.kind === "block.upsert" && [t.block.rank, textOf(t.block), t.fields.join()]).toEqual(["z", "theirs", "position"]);
  });
});

describe("unload journal, round five", () => {
  test("a closing tab's journal stays marked closed when the page then turns hidden", async () => {
    const client = { mutation: vi.fn(async () => { throw new Error("offline"); }) } as unknown as ConvexReactClient;
    const engine = await SyncEngine.open(client, "acct-close", PERSONAL, "web-cl");
    engine.setOnline(false);
    engine.upsertBlock("doc-1", para("b1", "typed"), ["content", "position"]);
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    engine.upsertBlock("doc-1", para("b1", "typed more"), ["content"]);
    const key = Object.keys(localStorage).find((k) => k.startsWith("folevi:sync-journal:acct-close:"))!;
    expect(JSON.parse(localStorage.getItem(key)!).closed).toBe(true);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    engine.dispose();
  });

  test("ops taken over from another tab bring the uploads they wait for; unknown ones stop blocking", () => {
    const state = sync.emptySyncState();
    const upload = { uploadId: "u1", documentId: "d", blockId: "img", attempts: 0, state: "queued" as const };
    const merged = mergeJournal(
      state,
      [
        { opId: "a", kind: "block.upsert", documentId: "d", block: para("img", ""), baseRevision: null, fields: ["content"], blockedBy: "u1" },
        { opId: "b", kind: "block.upsert", documentId: "d", block: para("img2", ""), baseRevision: null, fields: ["content"], blockedBy: "gone" },
      ],
      [upload],
    );
    expect(merged.uploads.map((u) => u.uploadId)).toEqual(["u1"]);
    const [a, b] = merged.pending as Extract<(typeof merged.pending)[number], { kind: "block.upsert" }>[];
    expect(a!.blockedBy).toBe("u1");
    expect(b!.blockedBy).toBeUndefined();
  });
});

describe("find", () => {
  test("case-insensitive matches land on the right characters when lower-casing changes the length", async () => {
    const { findMatches } = await import("@/components/editor/findReplace");
    const e = new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS], content: blocksToDoc([para("A", "İstanbul foo bar")]) });
    const [m] = findMatches(e.state.doc, "foo", false);
    expect(e.state.doc.textBetween(m!.from, m!.to)).toBe("foo");
    e.destroy();
  });
});
