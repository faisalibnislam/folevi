// Next-word prediction in the note (docs/SPELLING_PLAN.md): gray ghost text after the caret, Tab takes it.
// After Tab the next word appears, so Tab, Tab, Tab writes on; Esc puts it away. Tab keeps its usual meaning
// (indent, the next table cell) whenever nothing is showing, and nothing shows while text is selected, in
// code, or anywhere but the end of a word.
//
// Two sources: the on-device model, which learns from the person's own notes (lib/predict/ngram.ts, in the
// spelling worker), at once; and Foli AI, for a longer continuation after a short pause, only when the
// editor was given a way to ask it (PredictionBridge: Foli AI on, an account, not an encrypted note). A Foli
// AI continuation is taken a word at a time too.
//
// Phones have no Tab: there the prediction is a button in the bar above the keyboard (iphone/NoteBars.tsx
// KeyboardBar), fed by `currentPrediction` and PREDICTION_EVENT; the ghost text is drawn only where there is
// a keyboard with a Tab key (a fine pointer).
import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { predictionsOn, learnFromText, predictLocal } from "@/lib/spelling/web";
import type { SpellLanguage } from "@/lib/spelling/languages";
import { languageAt } from "./spellcheck";

export interface Ghost {
  /** Where the caret was when it was asked. */
  pos: number;
  /** All of it, as it would be inserted. */
  text: string;
  source: "local" | "ai";
}

/** Asks Foli AI for what comes next (set by PredictionBridge when it may be asked here). */
export type CloudComplete = (before: string, after: string, lang: SpellLanguage) => Promise<string | null>;

export interface PredictStorage {
  cloud: CloudComplete | null;
}

export const predictKey = new PluginKey<Ghost | null>("predict");
/** Sent on `window` when the prediction shown changes (the phone keyboard bar listens). */
export const PREDICTION_EVENT = "folevi:prediction";
/** After the last keystroke, before the on-device model is asked. */
const LOCAL_WAIT = 60;
/** After the last keystroke, before Foli AI is asked. */
const CLOUD_WAIT = 1100;
/** Between two Foli AI requests, at least (its hourly limit is shared with every other Foli AI feature). */
const CLOUD_GAP = 30_000;
/** After learning, before the note is learnt from again. */
const LEARN_WAIT = 4000;

/** The next word of a ghost: what one Tab inserts (a leading space with it). */
export function firstWord(text: string): string {
  const m = /^\s*[^\s]+/u.exec(text);
  return m ? m[0] : text;
}

/** The text before the caret in its line, when a prediction may be shown there; null otherwise. */
export function contextAt(state: EditorState): { before: string; after: string; pos: number } | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $pos = sel.$from;
  const line = $pos.parent;
  if (!line.isTextblock || line.type.spec.code || line.type.name === "codeBlock") return null;
  if ($pos.marks().some((m) => m.type.name === "code" || m.type.name === "link")) return null;
  const before = line.textBetween(0, $pos.parentOffset, undefined, "￼");
  const after = line.textBetween($pos.parentOffset, line.content.size, undefined, "￼");
  // Only at the end of a word: the line's end, or before a space or a closing mark.
  if (after && !/^[\s.,;:!?)\]}»”’"']/u.test(after)) return null;
  if (!before.trim() || /￼$/.test(before)) return null;
  return { before, after, pos: sel.from };
}

/** The prediction showing in `state`, if any. */
export function currentPrediction(state: EditorState): Ghost | null {
  return predictKey.getState(state) ?? null;
}

/** Accepts the next word of the prediction showing. Returns false when there is none. */
export function acceptPrediction(view: EditorView): boolean {
  const g = currentPrediction(view.state);
  if (!g || g.pos !== view.state.selection.from) return false;
  const word = firstWord(g.text);
  const rest = g.text.slice(word.length);
  const tr = view.state.tr.insertText(word, g.pos);
  // What's left of a longer continuation stays, after the word just taken.
  tr.setMeta(predictKey, rest.trim() ? { pos: g.pos + word.length, text: rest, source: g.source } : null);
  tr.setMeta("predictAccepted", true);
  view.dispatch(tr.scrollIntoView());
  return true;
}

function linesText(doc: PMNode, skip: number): Map<SpellLanguage, string> {
  const out = new Map<SpellLanguage, string>();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code || node.type.name === "codeBlock") return false;
    // (The line being written is learnt once it's done.)
    if (skip >= pos && skip <= pos + node.nodeSize) return false;
    const text = node.textContent;
    if (!text.trim()) return false;
    const lang = languageAt(doc, pos + 1);
    out.set(lang, `${out.get(lang) ?? ""}${text}\n`);
    return false;
  });
  return out;
}

const coarse = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches && !window.matchMedia?.("(any-pointer: fine)").matches;

export const Predict = Extension.create<object, PredictStorage>({
  name: "predict",
  // Before every other key handler, so Tab reaches it first (it lets Tab through when nothing is showing).
  priority: 10_000,
  addStorage() {
    return { cloud: null };
  },
  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    const storage = this.storage;
    return [
      new Plugin<Ghost | null>({
        key: predictKey,
        state: {
          init: () => null,
          apply(tr: Transaction, ghost, _old, state) {
            const meta = tr.getMeta(predictKey) as Ghost | null | undefined;
            if (meta !== undefined) return meta;
            if (!ghost) return null;
            // A change another plugin adds to one of ours (block ids, say): the ghost moves with the text.
            if (tr.getMeta("appendedTransaction")) {
              const pos = tr.mapping.map(ghost.pos);
              return state.selection.empty && state.selection.from === pos ? { ...ghost, pos } : null;
            }
            // Anything else typed or moved: gone (a new one is asked for).
            if (tr.docChanged || !state.selection.empty || state.selection.from !== ghost.pos) return null;
            return ghost;
          },
        },
        props: {
          decorations(state) {
            const g = predictKey.getState(state);
            if (!g || coarse()) return null;
            return DecorationSet.create(state.doc, [
              Decoration.widget(
                g.pos,
                () => {
                  const span = document.createElement("span");
                  span.className = "fb-ghost";
                  // Drawn by CSS (::after, spellcheck.css), so it is never part of the line's text: not in what's
                  // read from the page, copied, found or spoken.
                  span.dataset.ghost = g.text;
                  // Not part of the note: screen readers hear it from the live region instead.
                  span.setAttribute("aria-hidden", "true");
                  span.contentEditable = "false";
                  return span;
                },
                { side: 1, key: `ghost:${g.pos}:${g.text}`, ignoreSelection: true },
              ),
            ]);
          },
          handleKeyDown(view, event) {
            const g = predictKey.getState(view.state);
            if (!g) return false;
            if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing) {
              event.preventDefault();
              return acceptPrediction(view);
            }
            if (event.key === "Escape") {
              view.dispatch(view.state.tr.setMeta(predictKey, null).setMeta("addToHistory", false));
              return true;
            }
            return false;
          },
          handleDOMEvents: {
            blur(view) {
              if (predictKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(predictKey, null).setMeta("addToHistory", false));
              return false;
            },
            compositionstart(view) {
              if (predictKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(predictKey, null).setMeta("addToHistory", false));
              return false;
            },
          },
        },
        view(view) {
          if (typeof window === "undefined") return {};
          let localTimer: ReturnType<typeof setTimeout> | null = null;
          let cloudTimer: ReturnType<typeof setTimeout> | null = null;
          let learnTimer: ReturnType<typeof setTimeout> | null = null;
          let lastCloud = 0;
          let cloudQuietUntil = 0;
          let asked = "";
          let gone = false;
          const live = document.createElement("div");
          live.className = "sr-only";
          live.setAttribute("aria-live", "polite");
          live.setAttribute("role", "status");
          view.dom.parentElement?.appendChild(live);
          const show = (want: { before: string; pos: number }, text: string, source: Ghost["source"]) => {
            if (gone || view.isDestroyed) return;
            const now = contextAt(view.state);
            // Still where it was asked, and nothing typed since.
            if (!now || now.pos !== want.pos || now.before !== want.before) return;
            const cur = predictKey.getState(view.state);
            if (cur && cur.source === "ai" && source === "local") return;
            if (cur?.text === text) return;
            view.dispatch(view.state.tr.setMeta(predictKey, { pos: want.pos, text, source }).setMeta("addToHistory", false));
          };
          const askLocal = async () => {
            localTimer = null;
            const at = contextAt(view.state);
            if (!at || !predictionsOn() || !editor.isEditable) return;
            const lang = languageAt(view.state.doc, at.pos);
            const p = await predictLocal(lang, at.before).catch(() => null);
            if (p?.insert) show(at, p.insert, "local");
          };
          const askCloud = async () => {
            cloudTimer = null;
            const cloud = storage.cloud;
            const at = contextAt(view.state);
            if (!cloud || !at || !predictionsOn() || !editor.isEditable || !navigator.onLine) return;
            const now = Date.now();
            if (now - lastCloud < CLOUD_GAP || now < cloudQuietUntil || at.before.trim().length < 20) return;
            // Never the same question twice in a row.
            const key = `${at.pos}:${at.before}`;
            if (key === asked) return;
            asked = key;
            lastCloud = now;
            // The note's text up to the caret, not only this line: the lines before give the context.
            const $pos = view.state.selection.$from;
            const start = Math.max(0, $pos.before() - 4000);
            const before = view.state.doc.textBetween(start, at.pos, "\n", "￼");
            const text = await cloud(before, at.after, languageAt(view.state.doc, at.pos)).catch((e: unknown) => {
              // Refused (out of credits, the hourly limit): quiet for ten minutes.
              if (e) cloudQuietUntil = Date.now() + 600_000;
              return null;
            });
            if (text?.trim()) show(at, text, "ai");
          };
          const learn = () => {
            learnTimer = null;
            // Only a person's own notes (never the website's demo note, which has no note id).
            const noteId = (editor.storage as { spellcheck?: { documentId: string | null } }).spellcheck?.documentId;
            if (gone || !predictionsOn() || !noteId) return;
            for (const [lang, text] of linesText(view.state.doc, view.state.selection.from)) learnFromText(lang, text);
          };
          const announce = (g: Ghost | null) => {
            live.textContent = g && !coarse() ? `Suggestion: ${g.text.trim()}. Tab to accept.` : "";
            window.dispatchEvent(new CustomEvent(PREDICTION_EVENT, { detail: g ? { text: g.text } : null }));
          };
          learnTimer = setTimeout(learn, 1500);
          return {
            update(v: EditorView, prev: EditorState) {
              const g = predictKey.getState(v.state) ?? null;
              const before = predictKey.getState(prev) ?? null;
              if (g !== before) announce(g);
              const moved = v.state.doc !== prev.doc || !v.state.selection.eq(prev.selection);
              if (!moved) return;
              if (v.state.doc !== prev.doc) {
                if (learnTimer) clearTimeout(learnTimer);
                learnTimer = setTimeout(learn, LEARN_WAIT);
              }
              if (localTimer) clearTimeout(localTimer);
              if (cloudTimer) clearTimeout(cloudTimer);
              if (!predictionsOn() || !contextAt(v.state)) return;
              // A word just taken with Tab: the next one at once.
              if (!g) localTimer = setTimeout(() => void askLocal(), LOCAL_WAIT);
              if (storage.cloud && (!g || g.source !== "ai")) cloudTimer = setTimeout(() => void askCloud(), CLOUD_WAIT);
            },
            destroy() {
              for (const t of [localTimer, cloudTimer]) if (t) clearTimeout(t);
              // What was written since the last pass is learnt as the note closes.
              if (learnTimer) {
                clearTimeout(learnTimer);
                learn();
              }
              gone = true;
              live.remove();
            },
          };
        },
      }),
    ];
  },
});
