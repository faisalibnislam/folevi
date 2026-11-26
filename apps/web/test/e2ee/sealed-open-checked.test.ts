// A sealed block is stored unread, so what opens on a device is whatever its writer sealed. Opening it gives it
// the check the server gives a Standard block (editor-schema checkedWireBlock), before anything draws or exports
// it; sealing it again under another key (openBlockExact) leaves it exactly as it was.
import { describe, expect, test } from "vitest";
import { deriveNoteKeys, randomBytes, type NoteKeys } from "@folevi/local-store/e2ee";
import { blocksToHtml, checkedDocumentCover, checkedDocumentStyle, checkedWireBlock, DEFAULT_DOCUMENT_STYLE, validateWireBlock, type WireBlock } from "@folevi/editor-schema";
import { Sealer, UNREADABLE_TEXT, isUnreadableBlock } from "@/lib/e2ee/seal";
import type { KeyRingLike } from "@/lib/e2ee/router/deps";

const DOC = "01HZZZZZZZZZZZZZZZZZZZZZZA";
const ID = "01HZZZZZZZZZZZZZZZZZZZZZZB";
const HOSTILE = 'x"><img src=x onerror=alert(origin)>';

async function sealer(): Promise<Sealer> {
  const keys: NoteKeys = await deriveNoteKeys(randomBytes(32));
  const ring = { noteKeys: async () => ({ ...keys, version: 1 }) } as unknown as KeyRingLike;
  return new Sealer(ring);
}

const block = (over: Partial<WireBlock>): WireBlock => ({ id: ID, type: "paragraph", parentId: null, rank: "", schemaVersion: 1, text: [], props: {}, ...over });

describe("opening a sealed block", () => {
  test("a valid block opens as it was sealed", async () => {
    const s = await sealer();
    const b = block({ text: [{ type: "text", text: "hello", marks: [{ type: "color", value: "moss" }] }] });
    const opened = await s.openBlock(DOC, await s.sealBlock(DOC, b));
    expect(opened).toEqual(b);
  });

  test("a mark with a colour Folevi doesn't have is dropped, the words stay", async () => {
    const s = await sealer();
    const b = block({ text: [{ type: "text", text: "words", marks: [{ type: "color", value: HOSTILE }, { type: "link", href: "javascript:alert(1)" }, { type: "bold" }] }] as never });
    const sealed = await s.sealBlock(DOC, b);
    const opened = await s.openBlock(DOC, sealed);
    expect(opened.text).toEqual([{ type: "text", text: "words", marks: [{ type: "bold" }] }]);
    // Valid once it has a place the server would give it (the place itself is never judged or changed here).
    expect(opened.rank).toBe("");
    expect(validateWireBlock({ ...opened, rank: "V" })).toEqual([]);
    expect(blocksToHtml([opened], { title: "T" })).not.toContain("<img");
    // Sealing it again under another key must not change it.
    expect(await s.openBlockExact(DOC, sealed)).toEqual(b);
  });

  test("the same in a table cell, and props Folevi doesn't have go", async () => {
    const s = await sealer();
    const rows = [[[{ type: "text", text: "cell", marks: [{ type: "highlight", value: HOSTILE }] }]]];
    const opened = await s.openBlock(DOC, await s.sealBlock(DOC, block({ type: "table", props: { rows, headerRow: true, onclick: "x" } })));
    expect((opened.props as { rows: unknown }).rows).toEqual([[[{ type: "text", text: "cell" }]]]);
    expect(opened.props).not.toHaveProperty("onclick");
  });

  test("a block that can't be made valid shows as the unreadable placeholder", async () => {
    const s = await sealer();
    const sealed = await s.sealBlock(DOC, block({ type: "bookmark", props: { url: "javascript:alert(1)" } }));
    await expect(s.openBlock(DOC, sealed)).rejects.toThrow();
    const shown = await s.openBlockOrUnreadable(DOC, sealed);
    expect(isUnreadableBlock(shown)).toBe(true);
    expect(shown.text).toEqual([{ type: "text", text: UNREADABLE_TEXT }]);
  });

  test("text over the length limit keeps its words and loses only what isn't valid", () => {
    const long = "a".repeat(30_000);
    const checked = checkedWireBlock(block({ text: [{ type: "text", text: long, marks: [{ type: "color", value: HOSTILE }] }] as never }));
    expect(checked?.text).toEqual([{ type: "text", text: long }]);
  });

  test("a newer app's block type comes back as it is", () => {
    const b = block({ type: "hologram", schemaVersion: 99, props: { depth: 3 } });
    expect(checkedWireBlock(b)).toBe(b);
  });
});

describe("a sealed note's look", () => {
  test("only the values Folevi has are kept", () => {
    expect(checkedDocumentStyle({ font: "mono", width: "wide", background: "paper", accent: "x);background:url(https://e.example/)", card: "folio", backdrop: "color:sky;x", sheet: "night" })).toEqual({ ...DEFAULT_DOCUMENT_STYLE, font: "mono", sheet: "night" });
    expect(checkedDocumentStyle(null)).toEqual(DEFAULT_DOCUMENT_STYLE);
    expect(checkedDocumentCover({ kind: "color", value: "plum" })).toEqual({ kind: "color", value: "plum" });
    expect(checkedDocumentCover({ kind: "gradient" })).toEqual({ kind: "gradient" });
    expect(checkedDocumentCover({ kind: "color", value: "x);position:fixed" })).toEqual({ kind: "none" });
    expect(checkedDocumentCover({ kind: "art", value: "art-03" })).toEqual({ kind: "art", value: "art-03" });
    expect(checkedDocumentCover({ kind: "art", value: "a b" })).toEqual({ kind: "none" });
    expect(checkedDocumentCover("nope")).toEqual({ kind: "none" });
  });
});
