// Spelling on the website: Folevi's own checker, for the red underlines in a note (components/editor/
// spellcheck.ts) and the guesses in its right-click menu (lib/desktop/textMenu.ts adds them, the way the Mac
// app's are added there).
//
// Why its own: a browser underlines misspelt words itself, but only the ones typed since the page opened,
// and it keeps its guesses in its own right-click menu, which Folevi's menu replaces. A page can't ask the
// browser's checker anything. With its own, a note shows every misspelt word, and the menu can fix them,
// learn them and ignore them.
//
// English only for now (American, and British for the browsers set to it): the dictionaries are in
// public/spelling. In another language the browser's own underlines stay on, as before. The Mac app never
// uses this: the Mac's own checker does its spelling.
import { desktop } from "@/lib/desktop";
import { nativeApp } from "@/lib/nativeApp";
import type { SpellAnswer, SpellRequest } from "./spellWorker";

const LEARNT_KEY = "folevi:spelling:learnt";
/** Sent on `window` when a word was learnt or ignored: what is underlined has to be looked at again. */
export const SPELLING_CHANGED = "folevi:spelling-changed";
/** Words to leave alone until the page is closed ("Ignore spelling"). */
const ignored = new Set<string>();

/** The dictionary for this browser's language, or null when there is none for it. */
export function spellingDictionary(languages: readonly string[] = typeof navigator === "undefined" ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language])): string | null {
  const first = (languages[0] ?? "").toLowerCase();
  if (!first.startsWith("en")) return null;
  // British spelling wherever it is the custom (not only en-GB): Australia, New Zealand, Ireland, India, South Africa.
  return /^en-(gb|au|nz|ie|in|za)\b/.test(first) ? "/spelling/en-GB" : "/spelling/en-US";
}

function learntWords(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LEARNT_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((w): w is string => typeof w === "string").slice(0, 2000) : [];
  } catch {
    return [];
  }
}

let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, (a: SpellAnswer | null) => void>();

function theWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === "undefined" ? null : new Worker(new URL("./spellWorker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }
  if (worker) {
    worker.onmessage = (e: MessageEvent<SpellAnswer>) => {
      const done = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      done?.(e.data);
    };
    worker.onerror = () => {
      for (const done of waiting.values()) done(null);
      waiting.clear();
    };
  }
  return worker;
}

function ask(word: string, timeout: number, words?: string[]): Promise<SpellAnswer | null> {
  const base = spellingDictionary();
  const w = base ? theWorker() : null;
  if (!base || !w) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve(null);
    }, timeout);
    waiting.set(id, (a) => {
      clearTimeout(timer);
      resolve(a);
    });
    const request: SpellRequest = { id, base: new URL(base, location.origin).href, word, words, learnt: [...learntWords(), ...ignored] };
    w.postMessage(request);
  });
}

/** Whether this browser gets spelling guesses from Folevi (a dictionary for its language, and workers). */
export function webSpellingAvailable(): boolean {
  return spellingDictionary() !== null && typeof Worker !== "undefined";
}

/**
 * Whether Folevi does the spelling itself here: underlines in the note and guesses in its menu. Yes in a
 * desktop browser set to English. Not in the Mac app (the Mac's own checker does it, in every language), not
 * in the iPhone, iPad and Android apps or on a phone's browser (their keyboards do), and not in a language
 * there is no dictionary for (the browser's own underlines stay on there).
 */
export function ownSpelling(): boolean {
  if (typeof window === "undefined" || desktop() || nativeApp() !== null) return false;
  if (window.matchMedia?.("(pointer: coarse)").matches) return false;
  return webSpellingAvailable();
}

/** Which of `words` are misspelt. Null when it can't be asked (no dictionary, or no answer in time). */
export async function misspeltAmong(words: string[]): Promise<string[] | null> {
  if (!words.length) return [];
  const a = await ask("", 20_000, words);
  return a?.wrong ?? null;
}

/** "Ignore spelling": the word is left alone until the page is closed. */
export function ignoreWebSpelling(word: string) {
  ignored.add(word);
  window.dispatchEvent(new CustomEvent(SPELLING_CHANGED, { detail: word }));
}

/** Loads the dictionary ahead of the first right-click, so its answer is there at once. */
export function warmWebSpelling() {
  if (webSpellingAvailable()) void ask("", 20_000);
}

/** Is `word` misspelt, and what was meant. Null when it can't be asked (no dictionary, or no answer in time). */
export async function webSpelling(word: string): Promise<{ misspelled: boolean; guesses: string[] } | null> {
  const a = await ask(word, 2500);
  return a ? { misspelled: a.misspelled, guesses: a.guesses } : null;
}

/** "Learn spelling": the word is right in this browser from now on. */
export function learnWebSpelling(word: string) {
  try {
    const words = new Set(learntWords());
    words.add(word);
    localStorage.setItem(LEARNT_KEY, JSON.stringify([...words]));
  } catch {
    // Private browsing: learnt for this page only.
    ignored.add(word);
  }
  window.dispatchEvent(new CustomEvent(SPELLING_CHANGED, { detail: word }));
}
