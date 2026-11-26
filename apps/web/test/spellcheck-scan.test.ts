// The spelling extension's word scan (components/editor/spellcheck.ts), after editor audit M14 / S17: it read
// "is this word in code or a link" from the whole note for every word, which walked the note from its top
// each time (a third of a second per pass on a 2,000 line note, twice after every pause in typing). It now
// reads each line's own pieces and remembers each line's words. Same words, same places.
import { describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { spellableWords } from "@/components/editor/spellcheck";

/** The words and where they are (each also carries its line's language, tested in spelling-languages.test.ts). */
const plain = (doc: PMNode) => spellableWords(doc).map(({ word, from, to }) => ({ word, from, to }));

const WORD = /[\p{L}\p{M}][\p{L}\p{M}\p{N}'\u2019-]*/gu;
const ATOM = "\ufffc";

/** The scan as it was before the change, word for word: what the new one has to agree with. */
function reference(doc: PMNode): { word: string; from: number; to: number }[] {
  const out: { word: string; from: number; to: number }[] = [];
  const code = doc.type.schema.marks.code;
  const link = doc.type.schema.marks.link;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === "codeBlock" || node.type.spec.code) return false;
    const text = node.textBetween(0, node.content.size, undefined, ATOM);
    const start = pos + 1;
    for (const m of text.matchAll(WORD)) {
      let word = m[0];
      let at = m.index;
      const lead = /^['\u2019-]+/.exec(word)?.[0].length ?? 0;
      word = word.slice(lead).replace(/['\u2019-]+$/, "");
      at += lead;
      if (word.length < 2 || /\p{N}/u.test(word)) continue;
      if (/\p{Lu}/u.test(word.slice(1))) continue;
      const before = text[at - 1] ?? " ";
      const after = text[at + word.length] ?? " ";
      const next = text[at + word.length + 1] ?? " ";
      if (/[@#/\\_.:]/.test(before) || /[@/\\_:]/.test(after) || (after === "." && /[\p{L}\p{N}]/u.test(next))) continue;
      const from = start + at;
      const to = from + word.length;
      if ((code && doc.rangeHasMark(from, to, code)) || (link && doc.rangeHasMark(from, to, link))) continue;
      out.push({ word, from, to });
    }
    return false;
  });
  return out;
}

const t = (text: string, ...marks: { type: string; attrs?: Record<string, unknown> }[]): JSONContent => ({ type: "text", text, ...(marks.length ? { marks } : {}) });
const CODE = { type: "code" };
const LINK = { type: "link", attrs: { href: "https://example.com/a" } };
const BOLD = { type: "bold" };
const para = (id: string, content: JSONContent[], type = "paragraph"): JSONContent => ({ type, attrs: { id, depth: 0 }, content });

function docOf(content: JSONContent[]): { editor: Editor; doc: PMNode } {
  const editor = new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS], content: { type: "doc", content } });
  return { editor, doc: editor.state.doc };
}

describe("the words spelling looks at", () => {
  test("the same as before, on text with code, links, mentions, breaks and words that straddle them", () => {
    const { editor, doc } = docOf([
      para("a", [t("Teh quick "), t("brwn", BOLD), t(" fox reads "), t("getValue", CODE), t(" and a "), t("linked wrod", LINK), t(" then stops.")]),
      // A word half in code, half out; a word half linked; a word split by bold only (one word still).
      para("b", [t("pre"), t("fix", CODE), t(" mid"), t("dle", LINK), t(" bo"), t("ld", BOLD), t(" end")]),
      // A page link in the middle of a line, a hard break, quotes and hyphens at the edges of words.
      para("c", [t("see "), { type: "pageLink", attrs: { documentId: "D1", label: "Other" } }, t(" 'quoted' -dash- it\u2019s"), { type: "hardBreak" }, t("next lyne")]),
      // Left alone: addresses, file names, tags, handles, digits, inner capitals, ALL CAPS.
      para("d", [t("mail me@exmple.com or see notes.txt, #tagg, @handel, v2beta, iPhone, NASA, snake_case, path/to")]),
      { type: "codeBlock", attrs: { id: "e", depth: 0, language: "plaintext" }, content: [t("cosnt nothing = here;")] },
      para("f", [t("A heading with a tpyo")], "heading"),
      para("g", []),
      para("h", [t("code first", CODE), t(" then prose, then "), t("code", CODE), t("joined")]),
    ]);
    const now = plain(doc);
    expect(now).toEqual(reference(doc));
    // (And it finds what it should: the fixture isn't empty of words.)
    expect(now.map((w) => w.word)).toEqual(expect.arrayContaining(["Teh", "brwn", "then", "bold", "quoted", "dash", "it\u2019s", "lyne", "tpyo"]));
    expect(now.map((w) => w.word)).not.toContain("getValue");
    expect(now.map((w) => w.word)).not.toContain("wrod");
    expect(now.map((w) => w.word)).not.toContain("prefix");
    expect(now.map((w) => w.word)).not.toContain("cosnt");
    editor.destroy();
  });

  test("an edit keeps the other lines' words and moves them with the text", () => {
    const { editor } = docOf([para("a", [t("frist line")]), para("b", [t("second "), t("coded", CODE), t(" lyne")]), para("c", [t("thrid line")])]);
    const before = plain(editor.state.doc);
    expect(spellableWords(editor.state.doc)).toBe(spellableWords(editor.state.doc));
    editor.view.dispatch(editor.state.tr.insertText("xx ", 1));
    const after = plain(editor.state.doc);
    expect(after).toEqual(reference(editor.state.doc));
    expect(after.find((w) => w.word === "thrid")!.from).toBe(before.find((w) => w.word === "thrid")!.from + 3);
    editor.destroy();
  });

  test("a 2,000 line note is read in a fraction of the time it took", () => {
    const words = ["writing", "about", "the", "garden", "tomorow", "and", "wether", "we", "shoud", "plant", "more", "of", "them", "there"];
    const lines: JSONContent[] = [];
    for (let i = 0; i < 2000; i++) {
      const content: JSONContent[] = [t(`${words.join(" ")} `)];
      if (i % 9 === 0) content.push(t("inlineCode", CODE), t(" after"));
      if (i % 13 === 0) content.push(t(" a link", LINK));
      lines.push(para(`L${i}`, content));
    }
    const { editor, doc } = docOf(lines);
    // Timings on a shared machine wander: each is the fastest of a few runs, and the margins are wide. (A cache is
    // per version of the note, so each run reads a copy of it.)
    const fastest = (run: () => void, times = 5) => {
      let best = Infinity;
      for (let i = 0; i < times; i++) {
        const t = performance.now();
        run();
        best = Math.min(best, performance.now() - t);
      }
      return best;
    };
    const copy = () => editor.state.doc.type.create(doc.attrs, doc.content);
    const slow = fastest(() => reference(copy()));
    const old = reference(doc);
    const now = plain(doc);
    expect(now).toEqual(old);
    expect(now.length).toBeGreaterThan(28_000);
    // Lines read for the first time (a fresh note): well under the old full read.
    const fast = fastest(() => {
      const d = copy();
      // (New line nodes too, so nothing is remembered from an earlier run.)
      plain(editor.state.doc.type.create(d.attrs, d.content.content.map((n) => n.type.create(n.attrs, n.content, n.marks))));
    });
    expect(fast).toBeLessThan(slow / 2);
    // After one key, only the line typed in is read again: a small part of the full read.
    editor.view.dispatch(editor.state.tr.insertText("x", 1));
    const again = fastest(() => plain(editor.view.state.tr.insertText("y", 1).doc), 3);
    expect(again).toBeLessThan(slow / 4);
    editor.destroy();
  });
});
