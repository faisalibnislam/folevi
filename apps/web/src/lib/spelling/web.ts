// Folevi's own spelling and prediction, on the page's side: the editor's underlines (components/editor/
// spellcheck.ts), the guesses in its menus (lib/desktop/textMenu.ts, components/editor/SpellingPopover.tsx) and
// the ghost words after the caret (components/editor/predict.ts) all ask the worker (spellWorker.ts) through
// this file.
//
// The same checker runs in every app (the owner, 26 November 2026): the website, Folevi for Mac, Windows and
// Linux, and the iPhone, iPad and Android apps, with the browser's or web view's own spelling switched off in
// the note so there is only one underline. Ten languages (lib/spelling/languages.ts), offline once a
// dictionary has loaded.
import type { Prediction } from "../predict/ngram";
import type { SpellLanguage } from "./languages";
import { addPersonalWord, personalWords, SPELLING_CHANGED, spellingSettings } from "./settings";
import type { SpellAnswer, SpellRequest } from "./spellWorker";

export { SPELLING_CHANGED };

type Pending = { resolve: (a: SpellAnswer | null) => void; timer: ReturnType<typeof setTimeout> };
let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, Pending>();
let sentWords = "";

function sendPersonal(w: Worker) {
  const p = personalWords();
  const all = [...p.learnt, ...p.ignored];
  const key = all.join("\n");
  if (key === sentWords) return;
  sentWords = key;
  w.postMessage({ type: "personal", words: all } satisfies SpellRequest);
}

function theWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === "undefined" || typeof WebAssembly === "undefined" ? null : new Worker(new URL("./spellWorker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }
  if (worker) {
    const w = worker;
    w.onmessage = (e: MessageEvent<SpellAnswer>) => {
      const p = waiting.get(e.data.id);
      if (!p) return;
      waiting.delete(e.data.id);
      clearTimeout(p.timer);
      p.resolve(e.data);
    };
    w.onerror = () => {
      for (const p of waiting.values()) {
        clearTimeout(p.timer);
        p.resolve(null);
      }
      waiting.clear();
    };
    w.postMessage({ type: "init", base: new URL("/spelling/", location.href).href } satisfies SpellRequest);
    sendPersonal(w);
    window.addEventListener(SPELLING_CHANGED, () => sendPersonal(w));
  }
  return worker;
}

type Ask = SpellRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;
function ask(r: Ask, timeout: number): Promise<SpellAnswer | null> {
  const w = theWorker();
  if (!w) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve(null);
    }, timeout);
    waiting.set(id, { resolve, timer });
    w.postMessage({ ...r, id } as SpellRequest);
  });
}

/** Whether Folevi can do spelling and prediction here at all (workers and WebAssembly). */
export function spellingSupported(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}

/**
 * Whether Folevi marks misspelt words itself here, with the browser's own spelling off in the note. Every
 * app, while spell check is on in Settings.
 */
export function ownSpelling(): boolean {
  return spellingSupported() && spellingSettings().spellcheck;
}

/** Whether ghost-word prediction is on here. */
export function predictionsOn(): boolean {
  return spellingSupported() && spellingSettings().predictions;
}

/** Which of `words` are misspelt in `lang`. Null when it can't be asked (no dictionary, or no answer in time). */
export async function misspeltAmong(lang: SpellLanguage, words: string[]): Promise<string[] | null> {
  if (!words.length) return [];
  const a = await ask({ type: "check", lang, words }, 30_000);
  return a?.type === "check" ? a.wrong : null;
}

/** Is `word` misspelt in `lang`, and what was meant. Null when it can't be asked. */
export async function webSpelling(word: string, lang: SpellLanguage = spellingSettings().english): Promise<{ misspelled: boolean; guesses: string[] } | null> {
  const a = await ask({ type: "suggest", lang, word }, 4000);
  return a?.type === "suggest" ? { misspelled: a.misspelled, guesses: a.guesses } : null;
}

/** Loads a language's dictionary ahead of the first question. */
export function warmWebSpelling(lang: SpellLanguage = spellingSettings().english) {
  if (spellingSupported()) void ask({ type: "suggest", lang, word: "" }, 30_000);
}

/** "Add to dictionary": right everywhere from now on (synced to the person's other devices). */
export function learnWebSpelling(word: string, deviceOnly = false) {
  addPersonalWord(word, "learnt", deviceOnly);
}

/** "Ignore": never underlined again (synced to the person's other devices). */
export function ignoreWebSpelling(word: string, deviceOnly = false) {
  addPersonalWord(word, "ignored", deviceOnly);
}

/** Lets the on-device model learn from text the person wrote. */
export function learnFromText(lang: SpellLanguage, text: string) {
  const w = text.trim() ? theWorker() : null;
  w?.postMessage({ type: "learn", lang, text } satisfies SpellRequest);
}

/** The on-device model's next word after `before` (the line's text up to the caret). */
export async function predictLocal(lang: SpellLanguage, before: string): Promise<Prediction | null> {
  const a = await ask({ type: "predict", lang, before }, 500);
  return a?.type === "predict" ? a.prediction : null;
}
