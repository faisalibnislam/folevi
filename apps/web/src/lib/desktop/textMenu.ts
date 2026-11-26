// Folevi's own text menu in Folevi for Mac (the owner's answer to M1, docs/MAC_WEBKIT_PLAN.md §13): right-click on
// text shows Folevi's menu, never the system's, with what the system's would have added on a Mac: spelling
// suggestions (with Learn and Ignore), Look Up and Share. The native app answers them (apps/mac/Folevi/Chrome/
// chrome-page.js: foleviDesktop.spelling, learnWord, ignoreWord, lookUp; Bridge/capabilities.js: share,
// clipboard); without them (the website) Look Up and Share simply aren't there. Pasting from Folevi's menus
// reads the Mac's clipboard through the app (no "Paste" bubble in WebKit) when it can.
//
// In a note's body the spelling is always Folevi's own (lib/spelling/web.ts), in every app, the Mac's included:
// the same checker that underlines misspelt words there (components/editor/spellcheck.ts) gives the guesses,
// in the line's language, then Add to dictionary and Ignore. Elsewhere (a title, a field) the Mac app keeps
// the Mac's spelling, and the website and Windows and Linux use Folevi's.
import { desktop } from "@/lib/desktop";
import type { SpellLanguage } from "@/lib/spelling/languages";
import { ignoreWebSpelling, learnWebSpelling, ownSpelling, warmWebSpelling, webSpelling } from "@/lib/spelling/web";

export interface MacTextServices {
  spelling?(word: string): Promise<{ misspelled: boolean; guesses: string[] } | null>;
  learnWord?(word: string): void;
  ignoreWord?(word: string): void;
  lookUp?(o: { text: string; x: number; y: number }): void;
  share?(item: { title?: string; text?: string; url?: string; x?: number; y?: number }): Promise<boolean>;
  clipboard?: {
    read(): Promise<{ text?: string; html?: string; image?: Uint8Array } | null>;
    write(data: { text?: string; html?: string }): Promise<boolean>;
    /** Pastes into the page as ⌘V does (everything on the clipboard, files included). False when it could not. */
    paste?(): Promise<boolean>;
  };
}

/** The website's stand-in: spelling only, from Folevi's own checker. */
const WEB_SERVICES: MacTextServices = { spelling: webSpelling, learnWord: learnWebSpelling, ignoreWord: ignoreWebSpelling };
let warmed = false;

/**
 * The text services for Folevi's own text menu: the Mac app's, or on the website (where there is a
 * dictionary for the browser's language) Folevi's own spelling. Null when there are none.
 */
export function macTextServices(): MacTextServices | null {
  const d = desktop() as (ReturnType<typeof desktop> & MacTextServices) | null;
  // Folevi for Windows and Linux have no text services of their own: their spelling is the website's (below).
  if (d && d.platform === "mac") return d;
  if (!ownSpelling()) return null;
  // Asked for when a menu is about to open, or an editor mounts: the dictionary loads once, ahead of the first question.
  if (!warmed) {
    warmed = true;
    const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    // (Called with nothing: an idle callback's own argument isn't a language.)
    if (idle) idle(() => warmWebSpelling(), { timeout: 4000 });
    else setTimeout(() => warmWebSpelling(), 1500);
  }
  return WEB_SERVICES;
}

const WORD = /[\p{L}\p{N}\p{M}'’-]/u;

/** The word in `text` at `offset` (a caret, or inside a word): its bounds and itself, or null between words. */
export function wordAround(text: string, offset: number): { start: number; end: number; word: string } | null {
  let start = Math.max(0, Math.min(offset, text.length));
  let end = start;
  while (start > 0 && WORD.test(text[start - 1]!)) start--;
  while (end < text.length && WORD.test(text[end]!)) end++;
  // (Quotes and hyphens at the edges aren't the word's.)
  while (start < end && /['’-]/.test(text[start]!)) start++;
  while (end > start && /['’-]/.test(text[end - 1]!)) end--;
  const word = text.slice(start, end);
  return /\p{L}/u.test(word) ? { start, end, word } : null;
}

export interface MacTextAction {
  label: string;
  run: () => void;
  disabled?: boolean;
}

export interface MacTextItems {
  /** The guesses for a misspelt word, then Learn and Ignore; null when it's spelt right (or can't be asked). */
  spelling: MacTextAction[] | null;
  lookUp: MacTextAction | null;
  share: MacTextAction | null;
}

/**
 * The Mac's text items for a right-click, all null outside the Mac app. `word` is the word under the pointer in
 * editable text (and `replace` puts a guess in its place); `selection` the selected text; `at` where the pointer is.
 */
export async function macTextActions({ word, selection, at, replace, spellLang, deviceOnly }: { word?: string | null; selection?: string; at: { x: number; y: number }; replace?: (guess: string) => void; /** A note's body: Folevi's spelling in this language. */ spellLang?: SpellLanguage; /** An encrypted note: words added stay on this device. */ deviceOnly?: boolean }): Promise<MacTextItems> {
  const out: MacTextItems = { spelling: null, lookUp: null, share: null };
  if (word && replace && spellLang) {
    if (!ownSpelling()) return { ...(await macTextActions({ selection, at })), spelling: null };
    const r = await webSpelling(word, spellLang).catch(() => null);
    if (r?.misspelled) out.spelling = spellingActions(word, r.guesses, replace, deviceOnly);
    return { ...(await macTextActions({ selection: selection || word, at })), spelling: out.spelling };
  }
  const s = macTextServices();
  if (!s) return out;
  if (word && replace && s.spelling) {
    const r = await s.spelling(word).catch(() => null);
    if (r?.misspelled) {
      const spelling: MacTextAction[] = r.guesses.length ? r.guesses.slice(0, 5).map((g) => ({ label: g, run: () => replace(g) })) : [{ label: "No guesses found", run: () => undefined, disabled: true }];
      if (s.learnWord) spelling.push({ label: "Learn spelling", run: () => s.learnWord!(word) });
      if (s.ignoreWord) spelling.push({ label: "Ignore spelling", run: () => s.ignoreWord!(word) });
      out.spelling = spelling;
    }
  }
  const text = (selection?.trim() || word || "").trim();
  if (text && s.lookUp) {
    const short = text.length > 24 ? `${text.slice(0, 22).trimEnd()}…` : text;
    out.lookUp = { label: `Look up “${short}”`, run: () => s.lookUp!({ text, x: at.x, y: at.y }) };
  }
  if (selection?.trim() && s.share) out.share = { label: "Share…", run: () => void s.share!({ text: selection, x: at.x, y: at.y }) };
  return out;
}

/** A misspelt word's menu rows (Folevi's own spelling): the guesses, then Add to dictionary and Ignore. */
export function spellingActions(word: string, guesses: string[], replace: (guess: string) => void, deviceOnly = false): MacTextAction[] {
  const rows: MacTextAction[] = guesses.length ? guesses.slice(0, 5).map((g) => ({ label: g, run: () => replace(g) })) : [{ label: "No suggestions", run: () => undefined, disabled: true }];
  rows.push({ label: "Add to dictionary", run: () => learnWebSpelling(word, deviceOnly) });
  rows.push({ label: "Ignore", run: () => ignoreWebSpelling(word, deviceOnly) });
  return rows;
}

/** The clipboard's text for Folevi's own Paste item: the Mac app's when it has one, else the browser's. */
export async function readClipboardText(): Promise<string> {
  const c = macTextServices()?.clipboard;
  if (c) {
    const r = await c.read();
    if (r && typeof r.text === "string") return r.text;
  }
  return navigator.clipboard.readText();
}
