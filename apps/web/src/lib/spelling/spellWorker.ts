// Folevi's spelling and prediction, off the page's own thread (lib/spelling/web.ts talks to it): loading a
// dictionary takes a moment and a hard guess can too, and neither may hold up typing.
//
// Dictionaries are fetched once per language, when a note first needs it, and kept in the Cache Storage
// (`folevi-spelling-v1`) so they're there offline from then on. The prediction model (lib/predict/ngram.ts) is
// kept in IndexedDB on this device only.
import { NgramModel, type NgramSnapshot, type Prediction } from "../predict/ngram";
import { createHunspell, loadHunspellModule } from "./hunspell";
import { LANGUAGES, type SpellLanguage } from "./languages";
import { createSpellChecker, type SpellChecker } from "./spellCore";

export type SpellRequest =
  | { type: "init"; base: string }
  | { type: "personal"; words: string[] }
  /** `also`: more languages a word may be right in (wrong only when wrong in all). */
  | { type: "check"; id: number; lang: SpellLanguage; also?: SpellLanguage[]; words: string[] }
  | { type: "suggest"; id: number; lang: SpellLanguage; also?: SpellLanguage[]; word: string }
  | { type: "learn"; lang: SpellLanguage; text: string }
  | { type: "predict"; id: number; lang: SpellLanguage; before: string };

export type SpellAnswer =
  | { id: number; type: "check"; wrong: string[] | null }
  | { id: number; type: "suggest"; misspelled: boolean; guesses: string[] }
  | { id: number; type: "predict"; prediction: Prediction | null };

const CACHE = "folevi-spelling-v1";
let base = "/spelling/";
let personal = new Set<string>();
const checkers = new Map<SpellLanguage, Promise<SpellChecker>>();

async function file(name: string, binary: true): Promise<ArrayBuffer>;
async function file(name: string, binary: false): Promise<string>;
async function file(name: string, binary: boolean): Promise<ArrayBuffer | string> {
  const url = new URL(name, base).href;
  let res: Response | undefined;
  const cache = typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => null) : null;
  res = (await cache?.match(url).catch(() => undefined)) ?? undefined;
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error(`no ${name}`);
    if (cache) await cache.put(url, res.clone()).catch(() => {});
  }
  return binary ? res.arrayBuffer() : res.text();
}

function checkerFor(lang: SpellLanguage): Promise<SpellChecker> | null {
  const dict = LANGUAGES[lang]?.dictionary;
  if (!dict) return null;
  let made = checkers.get(lang);
  if (!made) {
    made = (async () => {
      const [wasm, aff, dic] = await Promise.all([file("hunspell.wasm", true), file(`${dict}.aff`, false), file(`${dict}.dic`, false)]);
      const m = await loadHunspellModule(wasm);
      const checker = createSpellChecker(createHunspell(m, aff, dic));
      for (const w of personal) checker.add(w);
      return checker;
    })();
    // A failed load is tried again on the next question.
    made.catch(() => checkers.delete(lang));
    checkers.set(lang, made);
  }
  return made;
}

/** The checkers for `langs` (those with a dictionary), or null when none has one. */
function checkersFor(langs: SpellLanguage[]): Promise<SpellChecker[]> | null {
  const made = [...new Set(langs)].map(checkerFor).filter((m): m is Promise<SpellChecker> => m !== null);
  return made.length ? Promise.all(made) : null;
}

// --- Prediction ---------------------------------------------------------------------------------------------

const modelKey = (lang: SpellLanguage) => (lang.startsWith("en") ? "en" : lang);
const models = new Map<string, Promise<NgramModel>>();
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("zh", { granularity: "word" }) : null;
const segmentFor = (lang: SpellLanguage) =>
  lang === "zh" && segmenter ? (s: string) => [...segmenter.segment(s)].filter((p) => p.isWordLike).map((p) => p.segment) : undefined;

function db(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const open = indexedDB.open("folevi-predict", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("models");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => resolve(null);
  });
}
const store = db();

function modelFor(lang: SpellLanguage): Promise<NgramModel> {
  const key = modelKey(lang);
  let made = models.get(key);
  if (!made) {
    made = store.then(
      (d) =>
        new Promise<NgramModel>((resolve) => {
          if (!d) return resolve(new NgramModel(lang !== "zh"));
          const get = d.transaction("models").objectStore("models").get(key);
          get.onsuccess = () => resolve(NgramModel.restore(get.result as NgramSnapshot | undefined, lang !== "zh"));
          get.onerror = () => resolve(new NgramModel(lang !== "zh"));
        }),
    );
    models.set(key, made);
  }
  return made;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const d = await store;
    if (!d) return;
    for (const [key, made] of models) {
      const m = await made;
      if (!m.dirty) continue;
      m.dirty = false;
      d.transaction("models", "readwrite").objectStore("models").put(m.snapshot(), key);
    }
  }, 5000);
}

// --- Messages -----------------------------------------------------------------------------------------------

const reply = (a: SpellAnswer) => self.postMessage(a);

self.onmessage = (e: MessageEvent<SpellRequest>) => {
  const r = e.data;
  switch (r.type) {
    case "init":
      base = r.base;
      return;
    case "personal": {
      const next = new Set(r.words);
      // (The checkers still loading take `personal` as they finish; the loaded ones get the difference.)
      const prev = personal;
      for (const made of checkers.values()) {
        void made.then((c) => {
          for (const w of prev) if (!next.has(w)) c.remove(w);
          for (const w of next) if (!prev.has(w)) c.add(w);
        });
      }
      personal = next;
      return;
    }
    case "check": {
      const all = checkersFor([r.lang, ...(r.also ?? [])]);
      if (!all) return reply({ id: r.id, type: "check", wrong: [] });
      void all.then(
        (cs) => reply({ id: r.id, type: "check", wrong: r.words.filter((w) => cs.every((c) => !c.correct(w))) }),
        () => reply({ id: r.id, type: "check", wrong: null }),
      );
      return;
    }
    case "suggest": {
      const all = checkersFor([r.lang, ...(r.also ?? [])]);
      if (!all) return reply({ id: r.id, type: "suggest", misspelled: false, guesses: [] });
      void all.then(
        (cs) => {
          // An empty word only warms the dictionaries up.
          const misspelled = r.word ? cs.every((c) => !c.correct(r.word)) : false;
          // The first language's guesses first, then the others', five in all.
          const guesses: string[] = [];
          if (misspelled) for (const c of cs) for (const g of c.suggest(r.word, 5)) if (!guesses.includes(g)) guesses.push(g);
          reply({ id: r.id, type: "suggest", misspelled, guesses: guesses.slice(0, 5) });
        },
        () => reply({ id: r.id, type: "suggest", misspelled: false, guesses: [] }),
      );
      return;
    }
    case "learn":
      void modelFor(r.lang).then((m) => {
        m.learn(r.text, segmentFor(r.lang));
        if (m.dirty) saveSoon();
      });
      return;
    case "predict":
      void modelFor(r.lang).then(
        (m) => reply({ id: r.id, type: "predict", prediction: m.predict(r.before, segmentFor(r.lang)) }),
        () => reply({ id: r.id, type: "predict", prediction: null }),
      );
      return;
  }
};
