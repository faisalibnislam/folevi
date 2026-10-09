// The editor and the sync engine when changes cross: remote changes the editor hasn't shown yet, a batch
// that may have landed without an answer, toggles opened and closed, and undo after "Edited elsewhere".
import { describe, expect, test, vi } from "vitest";
import type { ConvexReactClient } from "convex/react";
import { Editor } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { rankSequence, SCHEMA_VERSION, sync, type SyncOp, type WireBlock, type WireScope } from "@folevi/editor-schema";
import { SyncEngine } from "@/lib/sync/engine";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap } from "@/components/editor/plugins";
import { blocksToDoc, diffBlocks, docToBlocks, localChanges } from "@/components/editor/convert";
import { remoteTransaction } from "@/components/editor/remoteApply";

const PERSONAL: WireScope = { kind: "personal" };
const DOC = "doc-1";
const ranks = rankSequence(10);
const para = (id: string, text: string, i = 0, extra: Partial<WireBlock> = {}): WireBlock => ({
  id,
  type: "paragraph",
  parentId: null,
  rank: ranks[i]!,
  schemaVersion: SCHEMA_VERSION,
  text: text ? [{ type: "text", text }] : [],
  props: {},
  ...extra,
});
const toggle = (id: string, text: string, collapsed: boolean, i = 0): WireBlock => ({ ...para(id, text, i), type: "toggle", props: { collapsed } });
const make = (blocks: readonly WireBlock[]) => new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, UndoRedo, BlockIdentity, BlockKeymap], content: blocksToDoc(blocks) });
const lines = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(n.textContent));
  return out;
};
const posIn = (e: Editor, id: string, offset: number) => {
  let at = -1;
  e.state.doc.forEach((n, o) => {
    if (n.attrs.id === id) at = o + 1 + offset;
  });
  return at;
};
const textOf = (b: WireBlock | undefined) => (b?.text[0] as { text?: string } | undefined)?.text;
const offline = () => ({ mutation: vi.fn(async () => []) }) as unknown as ConvexReactClient;

/** The editor's save (Editor.tsx flushLocal): its changes against what it last showed. */
function save(engine: SyncEngine, ed: Editor, shown: Map<string, WireBlock>): Map<string, WireBlock> {
  const { next, upserts, deletes } = localChanges(ed.state.doc, shown, ed.schema);
  engine.batch(() => {
    for (const u of upserts) engine.upsertBlock(DOC, u.block, u.fields, engine.unshownRevision(u.block.id));
    for (const d of deletes) engine.deleteBlock(DOC, d, engine.unshownRevision(d));
  });
  return new Map(next.map((b) => [b.id, b]));
}
const showing = (engine: SyncEngine) => {
  engine.markShown(DOC);
  return new Map(engine.documentBlocks(DOC).map((b) => [b.id, b]));
};

describe("a remote change the editor hasn't shown yet", () => {
  test("saving meanwhile (an input method composing) neither undoes it nor deletes a block it added", async () => {
    const engine = await SyncEngine.open(offline(), "acct-unshown", PERSONAL, "web-u");
    engine.setOnline(false);
    engine.reconcileDocument(DOC, [{ ...para("X", "hello"), revision: 2 }]);
    const ed = make(engine.documentBlocks(DOC));
    let shown = showing(engine);
    // B's edit of X and B's new block R reach the engine; the editor's apply waits for the composition.
    engine.reconcileDocument(DOC, [{ ...para("X", "hello brave"), revision: 3 }, { ...para("R", "from B", 1), revision: 1 }]);
    ed.commands.setTextSelection(posIn(ed, "X", 5));
    ed.commands.insertContent("!");
    shown = save(engine, ed, shown);
    const ops = engine.state.pending.map((op) => (op.kind === "block.upsert" ? `${op.kind} ${op.block.id} @${op.baseRevision}` : op.kind === "block.delete" ? `${op.kind} ${op.blockId}` : op.kind));
    // X is saved as based on the version the editor showed (the server will ask), and R is left alone.
    expect(ops).toEqual(["block.upsert X @2"]);
    // Once shown, edits are based on the newest version again.
    shown = showing(engine);
    expect(engine.unshownRevision("X")).toBeUndefined();
    expect(shown.has("R")).toBe(true);
  });

  test("deletes go deepest first, so a parent's delete follows everything under it", () => {
    const blocks = [para("P", "parent"), para("C", "child", 0, { parentId: "P" }), para("G", "grandchild", 0, { parentId: "C" }), para("Q", "next", 1)];
    const ed = make(blocks);
    const shown = new Map(blocks.map((b) => [b.id, b]));
    ed.commands.setContent(blocksToDoc([para("Q", "next", 1)]));
    expect(localChanges(ed.state.doc, shown, ed.schema).deletes).toEqual(["G", "C", "P"]);
  });
});

describe("a batch that may have landed without an answer", () => {
  test("typing after it is saved too (not merged into the op the server already has)", async () => {
    const server = new Map<string, WireBlock & { revision: number }>();
    const seen = new Set<string>();
    let calls = 0;
    const client = {
      mutation: vi.fn(async (_fn: unknown, args: { ops: SyncOp[] }) => {
        calls++;
        const results = args.ops.map((op) => {
          if (op.kind !== "block.upsert") throw new Error("unexpected op");
          expect("sent" in op).toBe(false);
          const row = server.get(op.block.id);
          if (seen.has(op.opId)) return { opId: op.opId, status: "duplicate", revision: row!.revision, block: row };
          seen.add(op.opId);
          if (row && op.baseRevision !== row.revision) return { opId: op.opId, status: "conflict", revision: row.revision, block: row, conflict: { reason: "content", server: row, client: op.block } };
          const next = { ...op.block, revision: (row?.revision ?? 0) + 1 };
          server.set(op.block.id, next);
          return { opId: op.opId, status: "applied", revision: next.revision, block: next };
        });
        // The first batch lands, but its answer never comes back (a timeout).
        if (calls === 1) throw new Error("timeout");
        return results;
      }),
    } as unknown as ConvexReactClient;
    const engine = await SyncEngine.open(client, "acct-resend", PERSONAL, "web-r");
    engine.setOnline(true);
    const ed = make([para("b1", "")]);
    ed.commands.setTextSelection(1);
    let shown = new Map<string, WireBlock>();
    ed.commands.insertContent("Hello");
    shown = save(engine, ed, shown);
    await engine.flush();
    ed.commands.insertContent(" world");
    shown = save(engine, ed, shown);
    await engine.flush();
    const id = engine.documentBlocks(DOC)[0]!.id;
    expect(textOf(server.get(id))).toBe("Hello world");
    expect(engine.state.conflicts).toEqual([]);
    expect(engine.status()).toBe("saved");
  });

  test("ops in flight when the page closed come back as sent", async () => {
    const first = await SyncEngine.open(offline(), "acct-reload", PERSONAL, "web-l");
    first.setOnline(true);
    first.state = sync.takeBatch(sync.localUpsert(first.state, { opId: "op-hello-0001", documentId: DOC, block: para("b1", "Hello"), fields: ["content", "position"] }));
    first.clearErrors();
    await first.persisted();
    first.dispose();
    const reopened = await SyncEngine.open(offline(), "acct-reload", PERSONAL, "web-l");
    expect(reopened.state.pending.map((op) => [op.opId, op.sent])).toEqual([["op-hello-0001", true]]);
    reopened.upsertBlock(DOC, para("b1", "Hello world"), ["content"]);
    expect(reopened.state.pending.map((op) => op.opId)).toHaveLength(2);
    reopened.dispose();
  });
});

describe("toggles opened and closed", () => {
  test("a remote change elsewhere keeps a toggle opened or closed here; one that closes it is taken", () => {
    const t = toggle("T", "details", false);
    const ed = make([t, para("A", "a", 1)]);
    const shown = new Map([t, para("A", "a", 1)].map((b) => [b.id, b]));
    let pos = -1;
    ed.state.doc.forEach((n, o) => {
      if (n.attrs.id === "T") pos = o;
    });
    // Closed here and not saved (someone who can only read).
    ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...ed.state.doc.nodeAt(pos)!.attrs, collapsed: true }));
    const other = remoteTransaction(ed.state, [t, para("A", "ab", 1)], shown);
    if (other) ed.view.dispatch(other.setMeta("remote", true));
    expect(ed.state.doc.nodeAt(pos)!.attrs.collapsed).toBe(true);
    expect(lines(ed)).toEqual(["details", "ab"]);
    // Someone opens and closes it (the remote change is to the toggle itself): theirs.
    ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...ed.state.doc.nodeAt(pos)!.attrs, collapsed: false }));
    const closed = remoteTransaction(ed.state, [toggle("T", "details", true), para("A", "ab", 1)], shown);
    if (closed) ed.view.dispatch(closed.setMeta("remote", true));
    expect(ed.state.doc.nodeAt(pos)!.attrs.collapsed).toBe(true);
  });

  test("opening or closing is saved as that alone, apart from the text", () => {
    const before = toggle("T", "details", false);
    const ed = make([before]);
    const prev = new Map([[before.id, before]]);
    ed.view.dispatch(ed.state.tr.setNodeMarkup(0, undefined, { ...ed.state.doc.nodeAt(0)!.attrs, collapsed: true }));
    expect(diffBlocks(prev, docToBlocks(ed.state.doc, prev), ed.schema).upserts.map((u) => u.fields)).toEqual([["collapsed"]]);
    ed.commands.setTextSelection(3);
    ed.commands.insertContent("!");
    expect(diffBlocks(prev, docToBlocks(ed.state.doc, prev), ed.schema).upserts.map((u) => u.fields)).toEqual([["content", "collapsed"]]);
  });
});

describe("undo after Edited elsewhere brought a block back", () => {
  test("undoing my delete keeps my version beside theirs, and the question is answered", async () => {
    const engine = await SyncEngine.open(offline(), "acct-undo", PERSONAL, "web-d");
    engine.setOnline(false);
    engine.reconcileDocument(DOC, [{ ...para("A", "a"), revision: 1 }, { ...para("X", "mine", 1), revision: 1 }, { ...para("B", "b", 2), revision: 1 }]);
    const ed = make(engine.documentBlocks(DOC));
    let shown = showing(engine);
    let at = -1;
    let size = 0;
    ed.state.doc.forEach((n, o) => {
      if (n.attrs.id === "X") [at, size] = [o, n.nodeSize];
    });
    ed.view.dispatch(ed.state.tr.delete(at, at + size));
    shown = save(engine, ed, shown);
    // The delete comes back refused (someone edited X): X is back with their text.
    const [op] = engine.state.pending;
    engine.state = sync.applyResults(sync.takeBatch({ ...engine.state, connection: "online" }), [
      { opId: op!.opId, status: "conflict", revision: 2, block: { ...para("X", "theirs", 1), revision: 2 }, conflict: { reason: "content", server: { ...para("X", "theirs", 1), revision: 2 }, client: null } },
    ]);
    expect(engine.state.conflicts.map((c) => c.reason)).toEqual(["edited"]);
    const back = remoteTransaction(ed.state, engine.documentBlocks(DOC), shown);
    if (back) ed.view.dispatch(back.setMeta("remote", true).setMeta("addToHistory", false));
    shown = showing(engine);
    ed.commands.undo();
    expect(lines(ed)).toEqual(["a", "theirs", "mine", "b"]);
    shown = save(engine, ed, shown);
    expect(engine.state.conflicts).toEqual([]);
    expect(engine.documentBlocks(DOC).map((b) => textOf(b)).sort()).toEqual(["a", "b", "mine", "theirs"]);
  });

  test("Delete anyway also deletes lines written under it meanwhile, deepest first", async () => {
    const engine = await SyncEngine.open(offline(), "acct-anyway", PERSONAL, "web-a");
    engine.setOnline(false);
    engine.reconcileDocument(DOC, [{ ...para("P", "parent"), revision: 1 }]);
    engine.deleteBlock(DOC, "P");
    const [op] = engine.state.pending;
    engine.state = sync.applyResults(sync.takeBatch({ ...engine.state, connection: "online" }), [
      { opId: op!.opId, status: "conflict", revision: 1, block: { ...para("P", "parent"), revision: 1 }, conflict: { reason: "content", server: { ...para("P", "parent"), revision: 1 }, client: null } },
    ]);
    engine.state = { ...engine.state, connection: "offline" };
    engine.reconcileDocument(DOC, [{ ...para("P", "parent"), revision: 1 }, { ...para("C", "child", 0, { parentId: "P" }), revision: 1 }, { ...para("G", "grandchild", 0, { parentId: "C" }), revision: 1 }]);
    engine.resolveConflict(engine.state.conflicts[0]!.id, "mine");
    expect(engine.state.pending.map((o) => (o.kind === "block.delete" ? o.blockId : o.kind))).toEqual(["G", "C", "P"]);
  });
});
