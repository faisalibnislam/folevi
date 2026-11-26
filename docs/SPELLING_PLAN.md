# Spell check, suggestions and next-word prediction

Owner's request (2026-11-26): "a very very good built-in solid spelling check, spelling suggestions and next word
prediction with Tab, applicable for all platforms". This is the plan and what was built (branch
`claude/vigorous-raman-bb697b`).

## Owner's decisions (2026-11-26)

- **Engine:** Folevi's own, the same in every app, offline. Hunspell dictionaries, checked in a Web Worker, loaded
  per language when a note first needs one. The browser's or web view's own `spellcheck` is off in the note, so
  there is only one underline.
- **Languages:** English (American or British, chosen in Settings), Hindi, Mandarin Chinese, Arabic, Portuguese,
  Indonesian, Bengali, Spanish, French, German. Each line's language is detected. Chinese gets prediction only.
  Arabic is right to left.
- **Misspellings:** red wavy underline only, never autocorrect.
- **Suggestions:** at the top of the right-click / long-press menu (up to 5, then Add to dictionary and Ignore), in a
  small bubble when an underlined word is clicked, and over the phone keyboard on iPhone, iPad and Android.
- **Prediction:** gray ghost text after the caret. Tab takes the next word and the next one appears, so Tab, Tab,
  Tab writes on. Esc dismisses. Two sources: an on-device model that learns from the person's own notes (default),
  and Foli AI for longer continuations after a pause, only when Foli AI is on for the person and never for
  end-to-end encrypted notes. Tab keeps its old meaning (indent, table cells) whenever nothing is showing.
- **Defaults:** spell check and prediction both on, separate switches, plus a per-note spell check switch.

## How it works

| Part | Where |
| --- | --- |
| Hunspell 1.7 as WebAssembly (hunspell-wasm 0.3.0, MPL-1.1), vendored glue with its Node branch switched off | `apps/web/src/lib/spelling/vendor/hunspell.mjs`, `public/spelling/hunspell.wasm` |
| Thin wrapper (spell, suggest, add, remove) | `lib/spelling/hunspell.ts` |
| Checker rules around it (numbers, ALL CAPS, curly apostrophes, hyphenated words) and guess ranking (swapped and doubled letters first, splits into lone letters last) | `lib/spelling/spellCore.ts` |
| Languages, detection by script and by common words | `lib/spelling/languages.ts` |
| Worker: dictionaries cached in Cache Storage (`folevi-spelling-v1`), prediction model in IndexedDB (`folevi-predict`) | `lib/spelling/spellWorker.ts` |
| Page-side client | `lib/spelling/web.ts` |
| Settings and personal dictionary store (device copy, account sync, pending changes) | `lib/spelling/settings.ts`, `components/editor/SpellingSync.tsx` |
| Underlines (decorations with `aria-invalid="spelling"`), per-line language | `components/editor/spellcheck.ts` |
| Ghost text, Tab, Esc, on-device learning, Foli AI after a pause | `components/editor/predict.ts`, `components/editor/EditorSpelling.tsx` |
| On-device n-gram model (trigram, bigram, word completion; nothing shown until seen twice) | `lib/predict/ngram.ts` |
| Right-click / long-press rows, F7, Spelling and prediction submenu | `components/editor/EditorContextMenu.tsx`, `lib/desktop/textMenu.ts` |
| Bubble under a clicked word | `components/editor/SpellingBubble.tsx` |
| Phone keyboard strip (iPhone, iPad, Android apps) | `components/iphone/SuggestionStrip.tsx` in `NoteBars.tsx` `KeyboardBar` |
| Settings > Writing (website, Windows, Linux, Android) | `components/views/settings/WritingSection.tsx` |
| Backend: `spelling` table, `spelling.get/setPrefs/setWord/setNote`; local mode mirror | `convex/spelling.ts`, `apps/web/src/lib/local/functions/spelling.ts` |
| Foli AI completion: `aiComplete.complete` (fast model, 12 words at most, refused for sealed notes) | `convex/aiComplete.ts` |

Dictionaries (`apps/web/public/spelling`, licences beside each): English (SCOWL, already there), German, French,
Spanish, Portuguese (Brazil) from wooorm/dictionaries, Hindi, Bengali, Arabic (Ayaspell) and Indonesian from
LibreOffice's dictionaries. About 25 MB as text, about 6 MB compressed; the app shells now carry them (they used
to be pruned), so every app checks offline from the first note.

Keyboard and screen readers: Shift+F10 or the menu key on a misspelt word opens the menu with focus on the first
suggestion; F7 goes to the next misspelt word and opens it. Underlines carry `aria-invalid="spelling"`; the ghost
word is announced through a polite live region ("Suggestion: know. Tab to accept."); the bubble is a labelled
toolbar.

Privacy: the on-device model never leaves the device. Words added from an encrypted note stay on that device.
Foli AI is asked at most once every 30 seconds, after a 1.1 second pause, at the end of a line with some text
before it, and goes quiet for 10 minutes after a refusal (credits, the hourly limit).

The Content Security Policy now allows `'wasm-unsafe-eval'` (WebAssembly only, not `eval`) on the website, in the
shells and in `next.config.ts`.

## Tests

- Unit (Vitest): `apps/web/test/spelling.test.ts` (every language loads, knows its words, finds the one meant;
  English guesses), `test/spelling-predict.test.ts` (language detection, the n-gram model, the personal dictionary
  and its sync races, ghost text Tab / Tab fallback / Esc, Foli AI answer cleaning), `test/spellcheck-scan.test.ts`.
- Backend: `tests/convex/spelling.test.ts`, parity scenario "spelling" in `tests/parity/scenarios/organization.ts`.
- End to end (Playwright, local mode, Chromium and WebKit): `apps/web/e2e/spelling.spec.ts`: underline, menu and
  bubble suggestions, Add to dictionary, Ignore, F7, Tab takes words, Esc, Tab still indents, the note's switch,
  and a 5,000-word note with no long task while typing (Chromium).
  `npx playwright test e2e/spelling.spec.ts --project local --project mac-webkit` against a `FOLEVI_BUILD=shell`
  dev server. CI runs only the `account` project, so these run locally.

## Not done / follow-ups

- The Mac (and the iPad's wide Settings) have a native Writing section since 2026-11-26
  (`apps/native-kit/Sources/FoleviMac/Views/Settings/WritingSettings.swift`, through Settings' Convex allowlist in
  `viewsSettings.ts`). The iPhone's native Settings has no Writing row yet; every app has the same switches in the
  note's right-click menu (Spelling and prediction).
- The system keyboard's own suggestion bar can't be written to from a web view; Folevi's strip sits above it.
- The phone website (Safari or Chrome on a phone) has the bubble and the long-press menu but no keyboard strip.
- Not tried in the Mac, iOS, Android, Windows or Linux builds, or on a device; Foli AI completion not tried
  against a real model (its cleaning is unit tested).
