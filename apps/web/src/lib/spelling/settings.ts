// The person's spelling and prediction settings and their personal dictionary, readable from anywhere without
// React (the editor's plugins read them on every pass). SpellingSync (components/editor/SpellingSync.tsx) fills
// them from the account (profiles: spellcheck, predictions, spellingEnglish; the spellingWords table) and keeps
// a copy on this device, so a note opened offline or before the account loads is checked the same way.
//
// Words added from an end-to-end encrypted note stay on this device only: the server never sees what's
// written there (docs/E2EE_DESIGN.md).
import { defaultEnglish, type EnglishVariant } from "./languages";

export interface SpellingSettings {
  /** Red underlines under misspelt words (Settings, on by default). */
  spellcheck: boolean;
  /** Ghost words after the caret, accepted with Tab (Settings, on by default). */
  predictions: boolean;
  english: EnglishVariant;
}

export interface PersonalWords {
  /** Added to the dictionary: right everywhere, offered as guesses and predictions. */
  learnt: string[];
  /** Ignored: never underlined, never offered. */
  ignored: string[];
}

/** Sent on `window` when any of this changed: what is underlined has to be looked at again. */
export const SPELLING_CHANGED = "folevi:spelling-changed";
const SETTINGS_KEY = "folevi:spelling:settings";
const SYNCED_KEY = "folevi:spelling:words";
/** Words kept on this device only (signed out, local mode before sync, or from encrypted notes). */
const LOCAL_KEY = "folevi:spelling:learnt";
const MAX_WORDS = 5000;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing: kept for this page only.
  }
}

const locale = () => (typeof navigator === "undefined" ? undefined : navigator.language);
let settings: SpellingSettings | null = null;
let synced: PersonalWords | null = null;
let local: PersonalWords | null = null;

const words = (v: unknown): string[] => (Array.isArray(v) ? v.filter((w): w is string => typeof w === "string").slice(0, MAX_WORDS) : []);
function asWords(v: unknown): PersonalWords {
  // (The first version kept a plain list of learnt words under LOCAL_KEY.)
  if (Array.isArray(v)) return { learnt: words(v), ignored: [] };
  const o = (v ?? {}) as Partial<PersonalWords>;
  return { learnt: words(o.learnt), ignored: words(o.ignored) };
}

export function spellingSettings(): SpellingSettings {
  if (!settings) {
    const saved = typeof localStorage === "undefined" ? {} : read<Partial<SpellingSettings>>(SETTINGS_KEY, {});
    settings = {
      spellcheck: saved.spellcheck !== false,
      predictions: saved.predictions !== false,
      english: saved.english === "en-GB" || saved.english === "en-US" ? saved.english : defaultEnglish(locale()),
    };
  }
  return settings;
}

function changed() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SPELLING_CHANGED));
}

/** Settings changed here the account hasn't confirmed yet. */
let pendingPrefs: Partial<SpellingSettings> = {};

/** Takes the account's settings: a setting changed here and not yet confirmed there keeps this device's value. */
export function setAccountSpellingSettings(account: Partial<SpellingSettings>) {
  const next = { ...account };
  for (const k of Object.keys(pendingPrefs) as (keyof SpellingSettings)[]) {
    if (account[k] === pendingPrefs[k]) delete pendingPrefs[k];
    else delete next[k];
  }
  setSpellingSettings(next);
}

/** A setting changed on this device, on its way to the account (`saved` settles when it's there or refused). */
export function changeSpellingSettings(next: Partial<SpellingSettings>, saved: Promise<unknown>) {
  pendingPrefs = { ...pendingPrefs, ...next };
  setSpellingSettings(next);
  void saved.catch(() => {
    for (const k of Object.keys(next) as (keyof SpellingSettings)[]) delete pendingPrefs[k];
  });
}

/** Takes a change to the settings (as they are now on this device). */
export function setSpellingSettings(next: Partial<SpellingSettings>) {
  const cur = spellingSettings();
  const merged = { ...cur, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) } as SpellingSettings;
  if (merged.spellcheck === cur.spellcheck && merged.predictions === cur.predictions && merged.english === cur.english) return;
  settings = merged;
  write(SETTINGS_KEY, merged);
  changed();
}

function syncedWords(): PersonalWords {
  synced ??= typeof localStorage === "undefined" ? { learnt: [], ignored: [] } : asWords(read(SYNCED_KEY, null));
  return synced;
}
function localWords(): PersonalWords {
  local ??= typeof localStorage === "undefined" ? { learnt: [], ignored: [] } : asWords(read(LOCAL_KEY, null));
  return local;
}

/** Every word the person added or ignored, from the account and this device. */
export function personalWords(): PersonalWords {
  const s = syncedWords();
  const l = localWords();
  return { learnt: [...new Set([...s.learnt, ...l.learnt])], ignored: [...new Set([...s.ignored, ...l.ignored])] };
}

/**
 * Changes made here the account hasn't confirmed yet ("learnt\u0000word" → added or taken off). An answer from
 * the account that is older than the change (the query's last answer, or this device's copy of it) would
 * otherwise undo it for a moment, and the word would be underlined again.
 */
const pendingWords = new Map<string, boolean>();
const pkey = (kind: WordKind, word: string) => `${kind}\u0000${word}`;

/** Takes the account's personal dictionary (SpellingSync). */
export function setSyncedWords(next: PersonalWords) {
  const lists: PersonalWords = { learnt: words(next.learnt), ignored: words(next.ignored) };
  for (const [k, add] of [...pendingWords]) {
    const [kind, word] = k.split("\u0000") as [WordKind, string];
    const has = lists[kind].includes(word);
    // Confirmed: no longer pending. Not yet: kept as it is here.
    if (has === add) pendingWords.delete(k);
    else lists[kind] = add ? [...lists[kind], word] : lists[kind].filter((w) => w !== word);
  }
  const cur = syncedWords();
  if (cur.learnt.join("\n") === lists.learnt.join("\n") && cur.ignored.join("\n") === lists.ignored.join("\n")) return;
  synced = lists;
  write(SYNCED_KEY, synced);
  changed();
}

export type WordKind = "learnt" | "ignored";
/** How a word reaches the account (set by SpellingSync while signed in; null keeps words on this device). */
let saver: ((word: string, kind: WordKind, add: boolean) => Promise<unknown>) | null = null;
export function setPersonalWordSaver(save: typeof saver) {
  saver = save;
}

/**
 * Adds a word to the personal dictionary ("learnt") or the ignore list. `deviceOnly` keeps it off the account
 * (a word from an end-to-end encrypted note). With the account it lands at once here and syncs after.
 */
export function addPersonalWord(word: string, kind: WordKind, deviceOnly = false) {
  const w = word.trim();
  if (!w || w.length > 64) return;
  if (deviceOnly || !saver) {
    const l = localWords();
    if (!l[kind].includes(w)) l[kind] = [...l[kind], w].slice(-MAX_WORDS);
    write(LOCAL_KEY, l);
  } else {
    const s = syncedWords();
    if (!s[kind].includes(w)) synced = { ...s, [kind]: [...s[kind], w] };
    write(SYNCED_KEY, synced);
    pendingWords.set(pkey(kind, w), true);
    void saver(w, kind, true).catch(() => {
      // Offline or refused: kept on this device so it isn't lost.
      pendingWords.delete(pkey(kind, w));
      addPersonalWord(w, kind, true);
    });
  }
  changed();
}

/** Takes a word off the personal dictionary or the ignore list (Settings). */
export function removePersonalWord(word: string, kind: WordKind) {
  const l = localWords();
  if (l[kind].includes(word)) {
    l[kind] = l[kind].filter((w) => w !== word);
    write(LOCAL_KEY, l);
  }
  const s = syncedWords();
  if (s[kind].includes(word)) {
    synced = { ...s, [kind]: s[kind].filter((w) => w !== word) };
    write(SYNCED_KEY, synced);
    if (saver) {
      pendingWords.set(pkey(kind, word), false);
      void saver(word, kind, false).catch(() => pendingWords.delete(pkey(kind, word)));
    }
  }
  changed();
}

const OFF_KEY = "folevi:spelling:off-notes";
let offNotes: Set<string> | null = null;
let noteSaver: ((documentId: string, on: boolean) => Promise<unknown>) | null = null;
function offSet(): Set<string> {
  offNotes ??= new Set(typeof localStorage === "undefined" ? [] : words(read(OFF_KEY, [])));
  return offNotes;
}

/** Whether spell check is on for this note (its own switch; Settings' switch is separate). */
export function noteSpellcheckOn(documentId: string | null | undefined): boolean {
  return !documentId || !offSet().has(documentId);
}

/** Notes switched here the account hasn't confirmed yet (id → spell check on). */
const pendingNotes = new Map<string, boolean>();

/** Takes the account's list of notes spell check is off for (SpellingSync). */
export function setSyncedOffNotes(account: string[]) {
  const ids = new Set(account);
  for (const [id, on] of [...pendingNotes]) {
    if (ids.has(id) !== on) pendingNotes.delete(id);
    else if (on) ids.delete(id);
    else ids.add(id);
  }
  const cur = offSet();
  if (cur.size === ids.size && [...ids].every((id) => cur.has(id))) return;
  offNotes = ids;
  write(OFF_KEY, [...ids]);
  changed();
}

/** How a note's switch reaches the account (SpellingSync). */
export function setNoteSpellcheckSaver(save: typeof noteSaver) {
  noteSaver = save;
}

/** Turns spell check on or off for one note, here at once and on the account. */
export function setNoteSpellcheck(documentId: string, on: boolean) {
  const s = offSet();
  if (on) s.delete(documentId);
  else s.add(documentId);
  write(OFF_KEY, [...s]);
  if (noteSaver) {
    pendingNotes.set(documentId, on);
    void noteSaver(documentId, on).catch(() => pendingNotes.delete(documentId));
  }
  changed();
}

/** For tests: forget what's cached in memory. */
export function resetSpellingSettingsForTests() {
  settings = null;
  synced = null;
  local = null;
  saver = null;
  offNotes = null;
  noteSaver = null;
  pendingWords.clear();
  pendingNotes.clear();
  pendingPrefs = {};
}
