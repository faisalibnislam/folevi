// A small spelling checker for the website's editor: is this word spelt right, and if not, what was meant.
//
// It reads a Hunspell dictionary (public/spelling/*.aff and *.dic, the English lists from SCOWL): the .dic
// file is a list of words, each with letters that name the endings and beginnings it takes, and the .aff file
// says what those are ("S: add s, or es after s, x, z, h, or turn y into ies"). Every form is worked out once
// into one set of words, so a check is a lookup. Guesses are the words one or two slips away from what was
// typed (a letter swapped, missing, extra or wrong), with the slips people really make first (the .aff file's
// REP table: "ie" for "ei", "f" for "ph").
//
// Only what English needs is read: prefixes, suffixes, REP, and the "only in compounds" and "never suggest"
// marks. Kept free of the browser so it can be tested, and run in a worker (spellWorker.ts).

interface AffixRule {
  /** Letters taken off the word first ("" for none). */
  strip: string;
  add: string;
  /** What the word must end with (a suffix) or start with (a prefix). */
  fits: RegExp;
}
interface Affix {
  prefix: boolean;
  /** May be combined with an affix of the other kind ("un" + "happi" + "ness"). */
  cross: boolean;
  rules: AffixRule[];
}

export interface SpellChecker {
  /** Whether `word` is spelt right (words with digits, single letters and ALL CAPS always are). */
  correct(word: string): boolean;
  /** Up to `limit` guesses for a misspelt word, the likeliest first, in the word's own capitals. */
  suggest(word: string, limit?: number): string[];
  /** Accepts `word` from now on (this checker only). */
  add(word: string): void;
}

const fold = (word: string) => word.replace(/[‘’]/g, "'");

function parseAff(aff: string) {
  const affixes = new Map<string, Affix>();
  const reps: [string, string][] = [];
  let letters = "abcdefghijklmnopqrstuvwxyz'";
  let onlyInCompound = "";
  let noSuggest = "";
  for (const raw of aff.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const p = line.split(/\s+/);
    if (p[0] === "TRY" && p[1]) letters = [...new Set(p[1].toLowerCase())].join("");
    else if (p[0] === "ONLYINCOMPOUND" && p[1]) onlyInCompound = p[1];
    else if (p[0] === "NOSUGGEST" && p[1]) noSuggest = p[1];
    else if (p[0] === "REP" && p.length === 3 && Number.isNaN(Number(p[1]))) reps.push([p[1]!, p[2]!.replace(/_/g, " ")]);
    else if ((p[0] === "PFX" || p[0] === "SFX") && p[1]) {
      const prefix = p[0] === "PFX";
      // The header line ("SFX S Y 4") says whether it combines; the lines after it are the rules.
      if (p.length === 4 && (p[2] === "Y" || p[2] === "N") && !Number.isNaN(Number(p[3]))) {
        affixes.set(p[1], { prefix, cross: p[2] === "Y", rules: [] });
        continue;
      }
      const affix = affixes.get(p[1]);
      if (!affix || p.length < 4) continue;
      const strip = p[2] === "0" ? "" : p[2]!;
      const add = (p[3] === "0" ? "" : p[3]!).split("/")[0]!;
      const cond = p[4] && p[4] !== "." ? p[4] : "";
      let fits: RegExp;
      try {
        fits = new RegExp(prefix ? `^${cond}` : `${cond}$`);
      } catch {
        continue;
      }
      affix.rules.push({ strip, add, fits });
    }
  }
  return { affixes, reps, letters, onlyInCompound, noSuggest };
}

function withAffix(word: string, affix: Affix): string[] {
  const out: string[] = [];
  for (const r of affix.rules) {
    if (!r.fits.test(word)) continue;
    if (affix.prefix) {
      if (r.strip && !word.startsWith(r.strip)) continue;
      out.push(r.add + word.slice(r.strip.length));
    } else {
      if (r.strip && !word.endsWith(r.strip)) continue;
      out.push(word.slice(0, word.length - r.strip.length) + r.add);
    }
  }
  return out;
}

/** A checker for one dictionary: `aff` and `dic` are the two files' text. */
export function createSpellChecker(aff: string, dic: string): SpellChecker {
  const { affixes, reps, letters, onlyInCompound, noSuggest } = parseAff(aff);
  const words = new Set<string>();
  /** Words that are right but never offered as a guess (the dictionary marks the rude ones). */
  const quiet = new Set<string>();

  const lines = dic.split(/\r?\n/);
  // The first line is how many words follow.
  for (let i = /^\d+\s*$/.test(lines[0] ?? "") ? 1 : 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const slash = line.indexOf("/");
    const word = slash < 0 ? line : line.slice(0, slash);
    const flags = slash < 0 ? "" : line.slice(slash + 1).split(/\s/)[0]!;
    if (!word || (onlyInCompound && flags.includes(onlyInCompound))) continue;
    const forms = [word];
    const pre: Affix[] = [];
    const suf: Affix[] = [];
    for (const f of flags) {
      const a = affixes.get(f);
      if (a) (a.prefix ? pre : suf).push(a);
    }
    const suffixed: string[] = [];
    for (const a of suf) {
      const made = withAffix(word, a);
      forms.push(...made);
      if (a.cross) suffixed.push(...made);
    }
    for (const a of pre) {
      forms.push(...withAffix(word, a));
      if (a.cross) for (const w of suffixed) forms.push(...withAffix(w, a));
    }
    const hush = Boolean(noSuggest) && flags.includes(noSuggest);
    for (const w of forms) {
      words.add(w);
      if (hush) quiet.add(w);
    }
  }

  const known = (w: string) => words.has(w);
  const capital = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

  /** One word with no hyphen, apostrophes straightened. */
  const right = (w: string): boolean => {
    if (!w || w.length === 1 || /\d/.test(w)) return true;
    if (known(w)) return true;
    const lower = w.toLowerCase();
    // ALL CAPS is an abbreviation or a heading: not this checker's to judge.
    if (w.length > 1 && w === w.toUpperCase() && w !== lower) return true;
    // A capital at the start of a sentence: "Hello" is "hello". (A name in small letters stays wrong.)
    if (w === capital(lower) && known(lower)) return true;
    // "Anna's" where only "Anna" is listed.
    if (/'s$/i.test(w)) return right(w.slice(0, -2));
    return false;
  };

  const correct = (word: string): boolean => {
    const w = fold(word).replace(/^'+|'+$/g, "");
    if (right(w)) return true;
    // "well-known": right when each part is.
    return w.includes("-") && w.split("-").every((part) => right(part));
  };

  const VOWEL = /[aeiouy]/;
  /**
   * The words one slip from `w`, each with how unlikely that slip is (lower first). There is no list of how
   * common words are to rank by, so the kind of slip does it: two letters swapped and a double letter typed
   * once (or once too often) are the commonest, a wrong vowel next, then a letter missing or extra, and a
   * wrong consonant last. A slip in the first letter is rarer than anywhere else.
   */
  const slips = (w: string): [string, number][] => {
    const out: [string, number][] = [];
    const start = (i: number) => (i === 0 ? 1.5 : 0);
    for (let i = 0; i < w.length - 1; i++) if (w[i] !== w[i + 1]) out.push([w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2), 0 + start(i)]);
    for (let i = 0; i <= w.length; i++) for (const c of letters) out.push([w.slice(0, i) + c + w.slice(i), (c === w[i] || c === w[i - 1] ? 0.5 : 2) + start(i)]);
    for (let i = 0; i < w.length; i++) out.push([w.slice(0, i) + w.slice(i + 1), (w[i] === w[i + 1] || w[i] === w[i - 1] ? 0.5 : 2) + start(i)]);
    for (let i = 0; i < w.length; i++) for (const c of letters) if (c !== w[i]) out.push([w.slice(0, i) + c + w.slice(i + 1), (VOWEL.test(c) && VOWEL.test(w[i]!) ? 1 : 3) + start(i)]);
    return out;
  };

  const suggest = (word: string, limit = 5): string[] => {
    const typed = fold(word);
    if (!typed || typed.length > 40 || correct(typed)) return [];
    const lower = typed.toLowerCase();
    const found: string[] = [];
    const seen = new Set<string>([typed]);
    const offer = (candidate: string) => {
      // The dictionary's own spelling: "monday" is "Monday", "paris" is "Paris".
      for (const c of [candidate, capital(candidate)]) {
        if (seen.has(c) || !known(c) || quiet.has(c)) continue;
        seen.add(c);
        found.push(c);
        return;
      }
    };
    offer(lower);
    // The slips people really make.
    for (const [from, to] of reps) {
      for (let at = lower.indexOf(from); at >= 0; at = lower.indexOf(from, at + 1)) {
        const next = lower.slice(0, at) + to + lower.slice(at + from.length);
        if (next.includes(" ")) {
          if (next.split(" ").every((part) => right(part)) && !seen.has(next)) {
            seen.add(next);
            found.push(next);
          }
        } else offer(next);
      }
    }
    const near = slips(lower).sort((a, b) => a[1] - b[1]);
    for (const [c] of near) offer(c);
    // Two words run together.
    for (let i = 2; i <= lower.length - 2; i++) {
      const a = lower.slice(0, i);
      const b = lower.slice(i);
      const both = `${a} ${b}`;
      // (Not "ca lender": a part of one or two letters is only ever "a" or "I".)
      if ((a.length > 2 || a === "a" || a === "i") && b.length > 2 && known(a === "i" ? "I" : a) && known(b) && !seen.has(both)) {
        seen.add(both);
        found.push(both);
      }
    }
    // Two slips, only when one found too little (and never for a long word: the search grows fast).
    if (found.length < limit && lower.length <= 14) {
      const first = lower[0];
      const far: string[] = [];
      for (const [c] of near) {
        for (const [d] of slips(c)) {
          if (seen.has(d) || !known(d) || quiet.has(d)) continue;
          seen.add(d);
          far.push(d);
        }
        if (far.length > 400) break;
      }
      // Without knowing how common each word is: the ones that start as it was typed, then the closest in length.
      far.sort((a, b) => Number(b[0] === first) - Number(a[0] === first) || Math.abs(a.length - lower.length) - Math.abs(b.length - lower.length));
      found.push(...far);
    }
    // In the capitals it was typed in.
    const shaped = found.slice(0, limit).map((g) => {
      if (typed.length > 1 && typed === typed.toUpperCase() && typed !== lower) return g.toUpperCase();
      if (typed[0] !== lower[0] && g[0] === g[0]!.toLowerCase()) return capital(g);
      return g;
    });
    return [...new Set(shaped)];
  };

  return { correct, suggest, add: (word) => void words.add(fold(word)) };
}
