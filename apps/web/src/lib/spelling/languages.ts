// The languages Folevi checks and predicts (the owner, 26 November 2026), and how a line of a note is told
// apart: each block's language is found from its own words (the note's, when the block is too short to tell).
//
// The script settles most: Devanagari is Hindi, Bengali script is Bengali, Arabic script is Arabic, Han is
// Chinese. Latin text is scored against each language's commonest little words ("the", "und", "les", "yang")
// and its letters (ß, ã, ñ, ç). English is American or British as chosen in Settings.

export type SpellLanguage = "en-US" | "en-GB" | "es" | "fr" | "de" | "pt" | "id" | "hi" | "bn" | "ar" | "zh";
export type EnglishVariant = "en-US" | "en-GB";

export interface LanguageInfo {
  code: SpellLanguage;
  name: string;
  /** The dictionary's two files in public/spelling, or null where there is no spelling (Chinese). */
  dictionary: string | null;
  rtl?: boolean;
}

export const LANGUAGES: Record<SpellLanguage, LanguageInfo> = {
  "en-US": { code: "en-US", name: "English (US)", dictionary: "en-US" },
  "en-GB": { code: "en-GB", name: "English (UK)", dictionary: "en-GB" },
  es: { code: "es", name: "Spanish", dictionary: "es" },
  fr: { code: "fr", name: "French", dictionary: "fr" },
  de: { code: "de", name: "German", dictionary: "de" },
  pt: { code: "pt", name: "Portuguese", dictionary: "pt" },
  id: { code: "id", name: "Indonesian", dictionary: "id" },
  hi: { code: "hi", name: "Hindi", dictionary: "hi" },
  bn: { code: "bn", name: "Bengali", dictionary: "bn" },
  ar: { code: "ar", name: "Arabic", dictionary: "ar", rtl: true },
  // Mandarin: prediction only, no underlines (the owner's call: Chinese has no spelling to check).
  zh: { code: "zh", name: "Chinese", dictionary: null },
};

/** Whether a language gets red underlines. */
export const spellChecked = (lang: SpellLanguage) => LANGUAGES[lang].dictionary !== null;

const SCRIPTS: [RegExp, SpellLanguage][] = [
  [/\p{Script=Devanagari}/gu, "hi"],
  [/\p{Script=Bengali}/gu, "bn"],
  [/\p{Script=Arabic}/gu, "ar"],
  [/\p{Script=Han}/gu, "zh"],
];

type Latin = "en" | "es" | "fr" | "de" | "pt" | "id";
const STOP: Record<Latin, string[]> = {
  en: "the and of to a in is it that for you was with on as are this be at have not but they from or by i we he she my what".split(" "),
  es: "el la de que y en los del se las por un una con no es para lo como más pero sus le ya o este muy también".split(" "),
  fr: "le la les de des et est un une du en que qui dans pour pas sur au avec ce il elle nous vous sont mais ou je".split(" "),
  de: "der die das und ist nicht ein eine zu den mit von sich des auf für im dem auch es ich wir sie aber oder wie".split(" "),
  pt: "o a os as de que e do da em um uma para com não é se na no mais por dos das como mas ao ele ela você".split(" "),
  id: "yang dan di ini itu dengan untuk tidak dari dalam akan ke pada juga saya ada bisa kami kita mereka sudah atau".split(" "),
};
const STOPSETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v)])) as Record<Latin, Set<string>>;
const LETTERS: [RegExp, Latin, number][] = [
  [/[ß]/g, "de", 3],
  [/[äöü]/g, "de", 1],
  [/[ãõ]/g, "pt", 3],
  [/[ñ¿¡]/g, "es", 3],
  [/[çœ]/g, "fr", 1],
  [/[èêëîôùû]/g, "fr", 1],
];

/** The language of `text`, or null when it can't tell (too few words, or none Folevi knows). */
export function detectLanguage(text: string, english: EnglishVariant = "en-US"): SpellLanguage | null {
  let letters = 0;
  for (const _ of text.matchAll(/\p{L}/gu)) letters++;
  if (!letters) return null;
  for (const [re, lang] of SCRIPTS) {
    let n = 0;
    for (const _ of text.matchAll(re)) n++;
    if (n / letters > 0.3) return lang;
  }
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 3) return null;
  const score: Record<Latin, number> = { en: 0, es: 0, fr: 0, de: 0, pt: 0, id: 0 };
  for (const w of words) for (const k of Object.keys(score) as Latin[]) if (STOPSETS[k].has(w)) score[k]++;
  const lower = text.toLowerCase();
  for (const [re, k, weight] of LETTERS) score[k] += (lower.match(re)?.length ?? 0) * weight;
  const ranked = (Object.entries(score) as [Latin, number][]).sort((a, b) => b[1] - a[1]);
  const [best, top] = ranked[0]!;
  if (top < 1 || (ranked[1]![1] === top && best !== "en")) return null;
  return best === "en" ? english : best;
}

/** The dictionary for a browser language ("pt-BR" is Portuguese), for a note too short to tell. */
export function languageFromLocale(locale: string | undefined, english: EnglishVariant): SpellLanguage {
  const l = (locale ?? "").toLowerCase();
  const base = l.split("-")[0];
  if (base === "en" || !base) return english;
  if (base === "zh") return "zh";
  return (["es", "fr", "de", "pt", "id", "hi", "bn", "ar"] as const).find((c) => c === base) ?? english;
}

/** American or British, from the browser's language, until the person picks in Settings. */
export function defaultEnglish(locale: string | undefined): EnglishVariant {
  return /^en-(gb|au|nz|ie|in|za)\b/i.test(locale ?? "") ? "en-GB" : "en-US";
}
