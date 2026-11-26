"use client";
// Keeps this device's spelling settings and personal dictionary (lib/spelling/settings.ts) the same as the
// account's (convex/spelling.ts), both ways: what the account says is taken here, and a word added here is
// sent there. Rendered once, inside the signed-in app (lib/app/state.tsx AppStateProvider), in account and
// local mode alike. Offline, the last answer is used (useOfflineQuery) and words wait on this device.
import { useEffect, useSyncExternalStore } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex/api";
import { useOfflineQuery } from "@/lib/sync/queryCache";
import { SPELLING_CHANGED, changeSpellingSettings, personalWords, setAccountSpellingSettings, setNoteSpellcheckSaver, setPersonalWordSaver, setSyncedOffNotes, setSyncedWords, spellingSettings, type PersonalWords, type SpellingSettings } from "@/lib/spelling/settings";

export function SpellingSync() {
  const saved = useOfflineQuery(api.spelling.get, {});
  const setWord = useMutation(api.spelling.setWord);
  const setNote = useMutation(api.spelling.setNote);
  useEffect(() => {
    if (!saved) return;
    setAccountSpellingSettings({
      spellcheck: saved.spellcheck ?? undefined,
      predictions: saved.predictions ?? undefined,
      english: saved.english ?? undefined,
    });
    setSyncedWords({ learnt: saved.learnt, ignored: saved.ignored });
    setSyncedOffNotes(saved.offNotes);
  }, [saved]);
  useEffect(() => {
    setPersonalWordSaver((word, kind, add) => setWord({ word, kind, add }));
    setNoteSpellcheckSaver((documentId, on) => setNote({ documentId, on }));
    return () => {
      setPersonalWordSaver(null);
      setNoteSpellcheckSaver(null);
    };
  }, [setWord, setNote]);
  return null;
}

/** Saves a spelling setting to the account (and this device at once). */
export function useSetSpellingSettings() {
  const setPrefs = useMutation(api.spelling.setPrefs);
  return (next: Partial<SpellingSettings>) => changeSpellingSettings(next, setPrefs(next));
}

const subscribe = (cb: () => void) => {
  window.addEventListener(SPELLING_CHANGED, cb);
  return () => window.removeEventListener(SPELLING_CHANGED, cb);
};
let lastWords: { key: string; value: PersonalWords } | null = null;
const wordsNow = () => {
  const p = personalWords();
  const key = `${p.learnt.join("\n")}\u0000${p.ignored.join("\n")}`;
  if (lastWords?.key !== key) lastWords = { key, value: p };
  return lastWords.value;
};
const NO_WORDS: PersonalWords = { learnt: [], ignored: [] };

/** The spelling settings, re-rendering when they change. */
export function useSpellingSettings(): SpellingSettings {
  return useSyncExternalStore(subscribe, spellingSettings, spellingSettings);
}

/** The personal dictionary and ignore list, re-rendering when they change. */
export function usePersonalWords(): PersonalWords {
  return useSyncExternalStore(subscribe, wordsNow, () => NO_WORDS);
}
