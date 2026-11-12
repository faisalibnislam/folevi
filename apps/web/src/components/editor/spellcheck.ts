// Spelling in the note, on the website: a wavy red line under each misspelt word, from Folevi's own checker
// (lib/spelling/web.ts says why its own, and where it applies; elsewhere this extension does nothing and the
// browser's or the Mac's own spelling stays on). Right-click a marked word for the guesses, Learn and Ignore
// (EditorContextMenu.tsx, through lib/desktop/textMenu.ts).
//
// How: the words of the note are looked up in a worker, a batch at a time, a moment after the note changes,
// and each word's answer is remembered for the page's life. The marks are decorations (the note itself never
// changes, and nothing is saved or undone). The word being typed isn't marked until the caret leaves it.
// Left alone: code, links, mentions, words with digits or inner capitals (iPhone, JavaScript), ALL CAPS,
// and anything that looks like part of an address or a file name.
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { SPELLING_CHANGED, misspeltAmong, ownSpelling } from "@/lib/spelling/web";
import "./spellcheck.css";

const key = new PluginKey<DecorationSet>("spellcheck");
/** After the last change, before the note's words are looked at. */
const WAIT = 350;
/** Words asked at once; more go in the next round. */
const BATCH = 4000;

const WORD = /[\p{L}\p{M}][\p{L}\p{M}\p{N}'\u2019-]*/gu;
/** A stand-in for mentions, dates and page links: never part of a word. */
const ATOM = "\ufffc";

/** What is known of each word seen on this page: true when misspelt. */
const verdicts = new Map<string, boolean>();

interface Found {
  word: string;
  from: number;
  to: number;
}

/** The words of the note that spelling applies to, with where they are. */
export function spellableWords(doc: PMNode): Found[] {
  const out: Found[] = [];
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
      // (Quotes and hyphens at the edges aren't the word's.)
      const lead = /^['\u2019-]+/.exec(word)?.[0].length ?? 0;
      word = word.slice(lead).replace(/['\u2019-]+$/, "");
      at += lead;
      if (word.length < 2 || /\p{N}/u.test(word)) continue;
      // iPhone, JavaScript, NASA: names and abbreviations, not slips.
      if (/\p{Lu}/u.test(word.slice(1))) continue;
      // Part of an address, a file name, a tag or a handle.
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

function marks(state: EditorState): DecorationSet {
  const found = spellableWords(state.doc).filter((w) => verdicts.get(w.word) === true);
  return DecorationSet.create(
    state.doc,
    found.map((w) => Decoration.inline(w.from, w.to, { class: "fb-misspelt" }, { word: w.word })),
  );
}

export const Spellcheck = Extension.create({
  name: "spellcheck",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set, _old, state) {
            if (tr.getMeta(key)) return marks(state);
            return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
          },
        },
        props: {
          decorations(state) {
            const set = key.getState(state);
            if (!set || set === DecorationSet.empty || !editor.isEditable) return null;
            // The word the caret is in (or at the end of) is still being written.
            const sel = state.selection;
            if (!sel.empty) return set;
            const here = set.find(sel.from, sel.from);
            return here.length ? set.remove(here) : set;
          },
        },
        view(view) {
          if (!ownSpelling()) return {};
          let timer: ReturnType<typeof setTimeout> | null = null;
          let asking = false;
          let again = false;
          let gone = false;
          const redraw = () => {
            if (gone || view.isDestroyed) return;
            view.dispatch(view.state.tr.setMeta(key, true).setMeta("addToHistory", false));
          };
          const look = async () => {
            timer = null;
            if (gone || !editor.isEditable) return;
            if (asking) {
              again = true;
              return;
            }
            const unknown = [...new Set(spellableWords(view.state.doc).map((w) => w.word))].filter((w) => !verdicts.has(w));
            if (!unknown.length) return redraw();
            asking = true;
            const batch = unknown.slice(0, BATCH);
            const wrong = await misspeltAmong(batch).catch(() => null);
            asking = false;
            if (gone) return;
            // No answer (the dictionary didn't load): nothing is marked, and the next change asks again.
            if (wrong) {
              const bad = new Set(wrong);
              for (const w of batch) verdicts.set(w, bad.has(w));
              redraw();
            }
            if (wrong && (again || unknown.length > batch.length)) {
              again = false;
              schedule(0);
            }
          };
          const schedule = (wait = WAIT) => {
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => void look(), wait);
          };
          // A word was learnt or ignored: what is known is asked again.
          const onChanged = () => {
            verdicts.clear();
            schedule(0);
          };
          window.addEventListener(SPELLING_CHANGED, onChanged);
          schedule(600);
          return {
            update(v: EditorView, prev: EditorState) {
              if (v.state.doc !== prev.doc) schedule();
            },
            destroy() {
              gone = true;
              if (timer !== null) clearTimeout(timer);
              window.removeEventListener(SPELLING_CHANGED, onChanged);
            },
          };
        },
      }),
    ];
  },
});
