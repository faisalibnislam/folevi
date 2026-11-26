// Spelling in the note: a wavy red line under each misspelt word, from Folevi's own checker (lib/spelling/web.ts),
// the same in every app, in ten languages (lib/spelling/languages.ts). Each line's language is found from its
// own words (the note's when the line is too short to tell), so a note can mix English and Spanish. Chinese
// is never underlined. Right-click or click a marked word for the guesses, Add to dictionary and Ignore
// (EditorContextMenu.tsx, SpellingBubble.tsx).
//
// How: the words of the note are looked up in a worker, a batch at a time, a moment after the note changes,
// and each word's answer is remembered for the page's life. The marks are decorations (the note itself never
// changes, and nothing is saved or undone); each carries aria-invalid="spelling" so screen readers say so.
// The word being typed isn't marked until the caret leaves it. Left alone: code, links, mentions, words with
// digits or inner capitals (iPhone, JavaScript), ALL CAPS, and anything that looks like part of an address or
// a file name. Spell check can be turned off in Settings, and for one note (settings.ts setNoteSpellcheck; the
// editor tells this extension its note through `storage.documentId`).
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { detectLanguage, languageFromLocale, spellChecked, type EnglishVariant, type SpellLanguage } from "@/lib/spelling/languages";
import { noteSpellcheckOn, personalWords, spellingSettings } from "@/lib/spelling/settings";
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

/** What is known of each word seen on this page, by language and word ("de\u0000Haus"): true when misspelt. */
const verdicts = new Map<string, boolean>();
const vkey = (lang: SpellLanguage, word: string) => `${lang}\u0000${word}`;

interface Found {
  word: string;
  from: number;
  to: number;
  lang: SpellLanguage;
}

/** A word in a line of text, by where it starts in that line. */
interface LineWord {
  word: string;
  at: number;
}

/** The words of each line seen, kept for as long as the line itself is (an unchanged line is the same node in every later version of the note). */
const lineWords = new WeakMap<PMNode, LineWord[]>();
/** The words of each version of the note looked at, so the two passes over one version (asking, then marking) read it once. */
let noteWords = new WeakMap<PMNode, Found[]>();

/** The words of one line of text that spelling applies to. */
function wordsOfLine(node: PMNode): LineWord[] {
  const hit = lineWords.get(node);
  if (hit) return hit;
  const out: LineWord[] = [];
  const code = node.type.schema.marks.code;
  const link = node.type.schema.marks.link;
  // Where code and links are in the line, read from the line's own pieces. (Asking the whole note "is there
  // a code mark between here and there" for every word walked the note from its top each time: a third of a
  // second per pass on a 2,000 line note, twice after every pause in typing.)
  const skipped: [number, number][] = [];
  let offset = 0;
  node.forEach((child) => {
    const end = offset + child.nodeSize;
    if ((code && code.isInSet(child.marks)) || (link && link.isInSet(child.marks))) skipped.push([offset, end]);
    offset = end;
  });
  const text = node.textBetween(0, node.content.size, undefined, ATOM);
  let s = 0;
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
    // Any part of it in code or in a link: left alone. (Words and marked pieces both run left to right.)
    const to = at + word.length;
    while (s < skipped.length && skipped[s]![1] <= at) s++;
    if (s < skipped.length && skipped[s]![0] < to) continue;
    out.push({ word, at });
  }
  lineWords.set(node, out);
  return out;
}

/** Each line's own language, when its words tell (null: too short to tell). */
let lineLanguage = new WeakMap<PMNode, SpellLanguage | null>();
/** The English the caches above were made for (American or British, from Settings). */
let cachedEnglish: string | null = null;
function cachesFor(english: string) {
  if (cachedEnglish === english) return;
  cachedEnglish = english;
  noteWords = new WeakMap();
  lineLanguage = new WeakMap();
}
function languageOfLine(node: PMNode, english: EnglishVariant): SpellLanguage | null {
  if (lineLanguage.has(node)) return lineLanguage.get(node)!;
  const lang = detectLanguage(node.textContent, english);
  lineLanguage.set(node, lang);
  return lang;
}

/** The note's language: from its first few thousand letters, else the browser's. */
export function noteLanguage(doc: PMNode, english = spellingSettings().english): SpellLanguage {
  let text = "";
  doc.descendants((node) => {
    if (text.length > 4000) return false;
    if (node.isTextblock) {
      text += `${node.textContent}\n`;
      return false;
    }
    return true;
  });
  return detectLanguage(text, english) ?? languageFromLocale(typeof navigator === "undefined" ? undefined : navigator.language, english);
}

/** The language of the line around `pos` (for the right-click guesses and ghost words). */
export function languageAt(doc: PMNode, pos: number): SpellLanguage {
  const english = spellingSettings().english;
  cachesFor(english);
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  const line = $pos.parent.isTextblock ? $pos.parent : null;
  return (line && languageOfLine(line, english)) ?? noteLanguage(doc, english);
}

/** The words of the note that spelling applies to, with where they are and their line's language. */
export function spellableWords(doc: PMNode): Found[] {
  const english = spellingSettings().english;
  cachesFor(english);
  const hit = noteWords.get(doc);
  if (hit) return hit;
  const out: Found[] = [];
  let fallback: SpellLanguage | null = null;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === "codeBlock" || node.type.spec.code) return false;
    const words = wordsOfLine(node);
    if (!words.length) return false;
    const lang = languageOfLine(node, english) ?? (fallback ??= noteLanguage(doc, english));
    if (!spellChecked(lang)) return false;
    const start = pos + 1;
    for (const w of words) out.push({ word: w.word, from: start + w.at, to: start + w.at + w.word.length, lang });
    return false;
  });
  noteWords.set(doc, out);
  return out;
}

function marks(state: EditorState): DecorationSet {
  const found = spellableWords(state.doc).filter((w) => verdicts.get(vkey(w.lang, w.word)) === true);
  return DecorationSet.create(
    state.doc,
    found.map((w) => Decoration.inline(w.from, w.to, { class: "fb-misspelt", "aria-invalid": "spelling" }, { word: w.word, lang: w.lang })),
  );
}

/** The first misspelt word after `pos` (from the note's start when there is none after it). */
export function nextMisspelt(state: EditorState, pos: number): { from: number; to: number } | null {
  const set = key.getState(state);
  if (!set) return null;
  const all = set.find().sort((a, b) => a.from - b.from);
  const hit = all.find((d) => d.from >= pos) ?? all[0];
  return hit ? { from: hit.from, to: hit.to } : null;
}

/** For tests and the popover: the misspelt word at `pos`, if one is marked there. */
export function misspeltAt(state: EditorState, pos: number): { word: string; lang: SpellLanguage; from: number; to: number } | null {
  const set = key.getState(state);
  const hit = set?.find(pos, pos).find((d) => d.from <= pos && d.to >= pos);
  if (!hit) return null;
  const spec = hit.spec as { word: string; lang: SpellLanguage };
  return { word: spec.word, lang: spec.lang, from: hit.from, to: hit.to };
}

export interface SpellcheckStorage {
  /** The note this editor shows (for its own spell check switch). */
  documentId: string | null;
}

export const Spellcheck = Extension.create<object, SpellcheckStorage>({
  name: "spellcheck",
  addStorage() {
    return { documentId: null };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const storage = this.storage;
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
            if (!set || set === DecorationSet.empty || !editor.isEditable || !ownSpelling() || !noteSpellcheckOn(storage.documentId)) return null;
            // The word the caret is in (or at the end of) is still being written.
            const sel = state.selection;
            if (!sel.empty) return set;
            const here = set.find(sel.from, sel.from);
            return here.length ? set.remove(here) : set;
          },
        },
        view(view) {
          if (typeof window === "undefined") return {};
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
            if (gone) return;
            // Off (in Settings, or for this note): the marks are taken away.
            if (!editor.isEditable || !ownSpelling() || !noteSpellcheckOn(storage.documentId)) return redraw();
            if (asking) {
              again = true;
              return;
            }
            const ignored = new Set(personalWords().ignored);
            const unknown = new Map<SpellLanguage, Set<string>>();
            let count = 0;
            for (const w of spellableWords(view.state.doc)) {
              if (verdicts.has(vkey(w.lang, w.word))) continue;
              if (ignored.has(w.word)) {
                verdicts.set(vkey(w.lang, w.word), false);
                continue;
              }
              let words = unknown.get(w.lang);
              if (!words) unknown.set(w.lang, (words = new Set()));
              if (!words.has(w.word)) count++;
              words.add(w.word);
            }
            if (!count) return redraw();
            asking = true;
            // One language at a time, the most words first.
            const [lang, all] = [...unknown].sort((a, b) => b[1].size - a[1].size)[0]!;
            const batch = [...all].slice(0, BATCH);
            const wrong = await misspeltAmong(lang, batch).catch(() => null);
            asking = false;
            if (gone) return;
            // No answer (the dictionary didn't load): nothing is marked, and the next change asks again.
            if (wrong) {
              const bad = new Set(wrong);
              for (const w of batch) verdicts.set(vkey(lang, w), bad.has(w));
              redraw();
            }
            if (wrong && (again || count > batch.length)) {
              again = false;
              schedule(0);
            }
          };
          const schedule = (wait = WAIT) => {
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => void look(), wait);
          };
          // A word was learnt or ignored, or a setting changed: what is known is asked again.
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
