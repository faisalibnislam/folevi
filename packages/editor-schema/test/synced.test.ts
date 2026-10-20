// Synced blocks (src/synced.ts): the block's shape on the wire, and reading a note with its synced content in
// place (exports, share pages, search text, Foli AI).
import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  DocumentKindValues,
  blocksToMarkdown,
  expandSyncedBlocks,
  flattenTree,
  isSyncedBlock,
  rankSequence,
  repairWireBlock,
  syncedSourceIds,
  syncedSourceOf,
  validateWireBlock,
  type WireBlock,
} from "../src";

let n = 0;
const id = () => `01JSYNCED0000000000000${String(++n).padStart(4, "0")}`;
const para = (text: string, extra: Partial<WireBlock> = {}): WireBlock => ({
  id: id(),
  type: "paragraph",
  parentId: null,
  rank: "V",
  schemaVersion: 1,
  text: [{ type: "text", text }],
  props: {},
  ...extra,
});
const synced = (sourceId: unknown, extra: Partial<WireBlock> = {}): WireBlock => ({
  id: id(),
  type: "synced",
  parentId: null,
  rank: "V",
  schemaVersion: 1,
  text: [],
  props: { sourceId },
  ...extra,
});

/** Blocks in reading order, with their depth. */
const reading = (blocks: WireBlock[]) => flattenTree(blocks).map(({ block, depth }) => `${"  ".repeat(depth)}${block.type === "synced" ? "[synced]" : (block.text[0] as { text?: string } | undefined)?.text ?? block.type}`);

describe("synced block on the wire", () => {
  it("is a known type and a document kind", () => {
    expect(BLOCK_TYPES).toContain("synced");
    expect(DocumentKindValues).toContain("synced");
  });

  it("validates with a source id and refuses one without", () => {
    expect(validateWireBlock(synced("01JSOURCE000000000000000001"))).toEqual([]);
    expect(validateWireBlock(synced("")).map((i) => i.path)).toContain("props.sourceId");
    expect(validateWireBlock(synced(42)).map((i) => i.path)).toContain("props.sourceId");
    expect(validateWireBlock(synced("not a valid id!")).map((i) => i.path)).toContain("props.sourceId");
  });

  it("carries no text", () => {
    const b = { ...synced("01JSOURCE000000000000000001"), text: [{ type: "text" as const, text: "x" }] };
    expect(validateWireBlock(b).length).toBeGreaterThan(0);
    expect(repairWireBlock(synced("01JSOURCE000000000000000001")).issues).toEqual([]);
  });

  it("names its source", () => {
    const b = synced("01JSOURCE000000000000000001");
    expect(isSyncedBlock(b)).toBe(true);
    expect(syncedSourceOf(b)).toBe("01JSOURCE000000000000000001");
    expect(syncedSourceOf(para("x"))).toBeNull();
    expect(isSyncedBlock(synced(null))).toBe(false);
    const [r1, r2, r3] = rankSequence(3);
    expect(syncedSourceIds([synced("A1", { rank: r1! }), para("x", { rank: r2! }), synced("A1", { rank: r3! }), synced("B2")])).toEqual(["A1", "B2"]);
  });
});

describe("expandSyncedBlocks", () => {
  const source = (() => {
    const [a, b] = rankSequence(2);
    const first = para("Shared first", { rank: a! });
    const child = para("Shared child", { parentId: first.id, rank: "V" });
    return [first, child, para("Shared second", { rank: b! })];
  })();

  it("puts the source's blocks where the synced block is, keeping their nesting", () => {
    const [a, b, c] = rankSequence(3);
    const note = [para("Before", { rank: a! }), synced("SRC1", { rank: b! }), para("After", { rank: c! })];
    const out = expandSyncedBlocks(note, (sid) => (sid === "SRC1" ? source : null));
    expect(reading(out)).toEqual(["Before", "Shared first", "  Shared child", "Shared second", "After"]);
  });

  it("indents the content like the synced block", () => {
    const parent = para("Parent");
    const note = [parent, synced("SRC1", { parentId: parent.id })];
    expect(reading(expandSyncedBlocks(note, () => source))).toEqual(["Parent", "  Shared first", "    Shared child", "  Shared second"]);
  });

  it("shows the same source twice as two sets of blocks with ids of their own", () => {
    const [a, b] = rankSequence(2);
    const note = [synced("SRC1", { rank: a! }), synced("SRC1", { rank: b! })];
    const out = expandSyncedBlocks(note, () => source);
    expect(reading(out)).toEqual(["Shared first", "  Shared child", "Shared second", "Shared first", "  Shared child", "Shared second"]);
    expect(new Set(out.map((b) => b.id)).size).toBe(out.length);
  });

  it("leaves out what the reader can't see, or puts the stand-in there", () => {
    const [a, b] = rankSequence(2);
    const note = [para("Mine", { rank: a! }), synced("SECRET", { rank: b! })];
    expect(reading(expandSyncedBlocks(note, () => null))).toEqual(["Mine"]);
    const out = expandSyncedBlocks(note, () => null, { missing: () => [para("Not shared")] });
    expect(reading(out)).toEqual(["Mine", "Not shared"]);
  });

  it("never nests a synced block inside one", () => {
    const [a, b] = rankSequence(2);
    const inner = synced("SRC1", { rank: a! });
    const under = para("Under the nested one", { parentId: inner.id });
    const content = [inner, under, para("Kept", { rank: b! })];
    expect(reading(expandSyncedBlocks([synced("OUTER")], (sid) => (sid === "OUTER" ? content : source)))).toEqual(["Kept"]);
  });

  it("returns the blocks unchanged when there's nothing synced", () => {
    const note = [para("Only text")];
    expect(expandSyncedBlocks(note, () => source)).toEqual(note);
  });

  it("exports the content as part of the note", () => {
    const [a, b] = rankSequence(2);
    const note = [para("Intro", { rank: a! }), synced("SRC1", { rank: b! })];
    const md = blocksToMarkdown(expandSyncedBlocks(note, () => source), { title: "Note" });
    expect(md).toContain("Intro");
    expect(md).toContain("Shared first");
    expect(md).toContain("Shared second");
    expect(md).not.toContain("unsupported");
  });
});
