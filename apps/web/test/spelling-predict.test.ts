// Folevi's spelling and prediction beyond the dictionaries (docs/SPELLING_PLAN.md): each line's language, the
// on-device next-word model, the personal dictionary kept on the device and synced, and the ghost word in the
// editor (Tab takes it, Tab keeps indenting when there is none, Esc puts it away).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap } from "@/components/editor/plugins";
import { Spellcheck, languageAt, spellableWords } from "@/components/editor/spellcheck";
import { Predict, acceptPrediction, contextAt, currentPrediction, firstWord, predictKey } from "@/components/editor/predict";
import { NgramModel, tokenize } from "@/lib/predict/ngram";
import { detectLanguage, languageFromLocale } from "@/lib/spelling/languages";
import {
  SPELLING_CHANGED,
  addPersonalWord,
  changeSpellingSettings,
  setAccountSpellingSettings,
  noteSpellcheckOn,
  personalWords,
  removePersonalWord,
  resetSpellingSettingsForTests,
  setNoteSpellcheck,
  setNoteSpellcheckSaver,
  setPersonalWordSaver,
  setSpellingSettings,
  setSyncedWords,
  spellingSettings,
} from "@/lib/spelling/settings";
import { slipDistance } from "@/lib/spelling/spellCore";
import { cleanCompletion } from "../../../convex/aiComplete";

describe("each line's language", () => {
  test("by script: Hindi, Bengali, Arabic, Chinese", () => {
    expect(detectLanguage("मैं आज बाज़ार जा रहा हूँ")).toBe("hi");
    expect(detectLanguage("আমি আজ বাজারে যাচ্ছি")).toBe("bn");
    expect(detectLanguage("أنا ذاهب إلى السوق اليوم")).toBe("ar");
    expect(detectLanguage("我今天去市场买菜")).toBe("zh");
  });

  test("Latin text by its little words and letters, English as chosen", () => {
    expect(detectLanguage("The garden is full of flowers and the bees are happy")).toBe("en-US");
    expect(detectLanguage("The colour of the garden is lovely", "en-GB")).toBe("en-GB");
    expect(detectLanguage("El jardín está lleno de flores y las abejas están felices")).toBe("es");
    expect(detectLanguage("Le jardin est plein de fleurs et les abeilles sont heureuses")).toBe("fr");
    expect(detectLanguage("Der Garten ist voller Blumen und die Bienen sind glücklich")).toBe("de");
    expect(detectLanguage("O jardim está cheio de flores e as abelhas estão felizes, não é")).toBe("pt");
    expect(detectLanguage("Taman itu penuh dengan bunga dan lebah yang bahagia")).toBe("id");
  });

  test("too short to tell: null, then the note's or the browser's", () => {
    expect(detectLanguage("Hi")).toBeNull();
    expect(detectLanguage("")).toBeNull();
    expect(languageFromLocale("pt-BR", "en-US")).toBe("pt");
    expect(languageFromLocale("en-AU", "en-GB")).toBe("en-GB");
    expect(languageFromLocale("ja-JP", "en-US")).toBe("en-US");
  });

  test("a note mixing English and Spanish checks each line in its own language; Chinese lines aren't checked", () => {
    const e = new Editor({
      extensions: [...ALL_NODES, ...ALL_MARKS],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "The garden is full of flowers and the bees are happy" }] },
          { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "El jardín está lleno de flores y las abejas" }] },
          { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "我今天去市场买菜" }] },
        ],
      },
    });
    const words = spellableWords(e.state.doc);
    expect(words.find((w) => w.word === "garden")!.lang).toBe(spellingSettings().english);
    expect(words.find((w) => w.word === "jardín")!.lang).toBe("es");
    expect(words.some((w) => w.lang === "zh")).toBe(false);
    expect(languageAt(e.state.doc, words.find((w) => w.word === "jardín")!.from)).toBe("es");
    e.destroy();
  });
});

describe("guesses: the slips people make come first", () => {
  test("swapped and doubled letters count as half a slip", () => {
    expect(slipDistance("teh", "the")).toBe(0.5);
    expect(slipDistance("teh", "te")).toBe(1);
    expect(slipDistance("accomodate", "accommodate")).toBe(0.5);
    expect(slipDistance("cat", "cat")).toBe(0);
  });
});

describe("the on-device next-word model", () => {
  const notes = [
    "Thanks for the update. Let me know if you have any questions.",
    "Let me know if you need anything else.",
    "Let me know when you are free. Thanks for the help.",
    "We met in Paris last spring. Paris was lovely.",
  ].join("\n");

  test("nothing until a phrase has been seen twice", () => {
    const m = new NgramModel();
    m.learn("Let me know if you have any questions.");
    expect(m.predict("Let me")).toBeNull();
  });

  test("the next word after a space, a word finished, the next one after a whole word", () => {
    const m = new NgramModel();
    m.learn(notes);
    expect(m.predict("Let me ")).toEqual({ word: "know", insert: "know" });
    expect(m.predict("Let me kn")).toEqual({ word: "know", insert: "ow" });
    expect(m.predict("Let me know")).toEqual({ word: "if", insert: " if" });
    expect(m.predict("Let me know if you ")).toBeNull();
  });

  test("names keep their capitals; nothing after the end of a sentence until a new one starts", () => {
    const m = new NgramModel();
    m.learn(notes);
    m.learn("I went to Paris in May. I loved Paris.");
    expect(m.predict("Last year in Pa")?.word).toBe("Paris");
    expect(m.predict("Done.")).toBeNull();
    expect(m.predict("Done. ")?.word).toBe("Let");
  });

  test("a sentence is learnt once, however often the note is opened", () => {
    const m = new NgramModel();
    m.learn("Let me know.");
    m.learn("Let me know.");
    m.learn("Let me know.");
    expect(m.predict("Let me ")).toBeNull();
  });

  test("survives a snapshot (kept in IndexedDB)", () => {
    const m = new NgramModel();
    m.learn(notes);
    const back = NgramModel.restore(JSON.parse(JSON.stringify(m.snapshot())));
    expect(back.predict("Let me ")).toEqual(m.predict("Let me "));
    back.learn(notes);
    expect(back.dirty).toBe(false);
  });

  test("Chinese, without spaces, through a word splitter", () => {
    const seg = (s: string) => [...new Intl.Segmenter("zh", { granularity: "word" }).segment(s)].filter((p) => p.isWordLike).map((p) => p.segment);
    const m = new NgramModel(false);
    m.learn("我们明天去公园。我们明天去学校。我们明天去公园。", seg);
    const p = m.predict("我们明天", seg);
    expect(p?.insert.startsWith(" ")).toBe(false);
    expect(tokenize("一。二", seg).length).toBe(2);
  });

  test("a 5,000-word note is learnt quickly", () => {
    const words = ["the", "garden", "is", "full", "of", "flowers", "and", "we", "plant", "more", "every", "spring"];
    const text = Array.from({ length: 500 }, (_, i) => `${Array.from({ length: 10 }, (_, j) => words[(i * 7 + j * 3) % words.length]).join(" ")}.`).join(" ");
    const m = new NgramModel();
    const start = performance.now();
    m.learn(text);
    for (let i = 0; i < 200; i++) m.predict("we plant ");
    expect(performance.now() - start).toBeLessThan(400);
  });
});

describe("the personal dictionary", () => {
  beforeEach(() => {
    localStorage.clear();
    resetSpellingSettingsForTests();
  });
  afterEach(() => resetSpellingSettingsForTests());

  test("settings default to on, and changes are kept on the device", () => {
    expect(spellingSettings()).toMatchObject({ spellcheck: true, predictions: true });
    setSpellingSettings({ predictions: false, english: "en-GB" });
    resetSpellingSettingsForTests();
    expect(spellingSettings()).toMatchObject({ spellcheck: true, predictions: false, english: "en-GB" });
  });

  test("signed in: a word goes to the account and is right here at once; taking it back goes there too", async () => {
    const save = vi.fn(async () => null);
    setPersonalWordSaver(save);
    const changed = vi.fn();
    window.addEventListener(SPELLING_CHANGED, changed);
    addPersonalWord("Folevi", "learnt");
    expect(personalWords().learnt).toEqual(["Folevi"]);
    expect(save).toHaveBeenCalledWith("Folevi", "learnt", true);
    expect(changed).toHaveBeenCalled();
    removePersonalWord("Folevi", "learnt");
    expect(personalWords().learnt).toEqual([]);
    expect(save).toHaveBeenLastCalledWith("Folevi", "learnt", false);
    window.removeEventListener(SPELLING_CHANGED, changed);
  });

  test("from an encrypted note, or offline and refused: kept on this device only", async () => {
    const save = vi.fn(async () => {
      throw new Error("offline");
    });
    setPersonalWordSaver(save);
    addPersonalWord("Sealedword", "learnt", true);
    expect(save).not.toHaveBeenCalled();
    addPersonalWord("Offlineword", "ignored");
    await Promise.resolve();
    await Promise.resolve();
    expect(personalWords()).toEqual({ learnt: ["Sealedword"], ignored: ["Offlineword"] });
    // The account's list arrives: both are kept, the device's and the account's.
    setSyncedWords({ learnt: ["Synced"], ignored: [] });
    expect(personalWords().learnt.sort()).toEqual(["Sealedword", "Synced"]);
  });

  test("an older answer from the account doesn't undo a word just added or a setting just changed", async () => {
    let confirm!: () => void;
    setPersonalWordSaver(() => new Promise<null>((r) => (confirm = () => r(null))));
    addPersonalWord("Folevi", "learnt");
    // The query's last answer, from before the change.
    setSyncedWords({ learnt: [], ignored: [] });
    expect(personalWords().learnt).toEqual(["Folevi"]);
    confirm();
    setSyncedWords({ learnt: ["Folevi"], ignored: [] });
    // Confirmed: from now on the account decides (taken off on another device).
    setSyncedWords({ learnt: [], ignored: [] });
    expect(personalWords().learnt).toEqual([]);

    changeSpellingSettings({ predictions: false }, new Promise(() => undefined));
    setAccountSpellingSettings({ predictions: true, spellcheck: true });
    expect(spellingSettings().predictions).toBe(false);
    setAccountSpellingSettings({ predictions: false });
    setAccountSpellingSettings({ predictions: true });
    expect(spellingSettings().predictions).toBe(true);
  });

  test("a note's own switch", () => {
    const save = vi.fn(async () => null);
    setNoteSpellcheckSaver(save);
    expect(noteSpellcheckOn("01J00000000000000000000000")).toBe(true);
    setNoteSpellcheck("01J00000000000000000000000", false);
    expect(noteSpellcheckOn("01J00000000000000000000000")).toBe(false);
    expect(save).toHaveBeenCalledWith("01J00000000000000000000000", false);
    resetSpellingSettingsForTests();
    expect(noteSpellcheckOn("01J00000000000000000000000")).toBe(false);
  });
});

describe("the ghost word in the editor", () => {
  const para = (text: string, depth = 0): JSONContent => ({ type: "paragraph", attrs: { depth }, content: text ? [{ type: "text", text }] : undefined });
  const make = (content: JSONContent[]) =>
    new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, BlockIdentity, BlockKeymap, Spellcheck, Predict], content: { type: "doc", content } });
  const key = (e: Editor, k: string, opts: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts });
    return Boolean(e.view.someProp("handleKeyDown", (f) => f(e.view, event)));
  };
  const caretAtEnd = (e: Editor) => e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, e.state.doc.child(0).nodeSize - 1)));
  const show = (e: Editor, text: string) => e.view.dispatch(e.state.tr.setMeta(predictKey, { pos: e.state.selection.from, text, source: "local" }));

  test("shown only at the end of a word, never in code or with a selection", () => {
    const e = make([para("Let me know")]);
    caretAtEnd(e);
    expect(contextAt(e.state)?.before).toBe("Let me know");
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 3)));
    expect(contextAt(e.state)).toBeNull();
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 1, 4)));
    expect(contextAt(e.state)).toBeNull();
    e.destroy();
  });

  test("Tab takes the next word; a longer one stays for the next Tab", () => {
    const e = make([para("Let me know")]);
    caretAtEnd(e);
    show(e, " if you need");
    expect(key(e, "Tab")).toBe(true);
    expect(e.state.doc.textContent).toBe("Let me know if");
    expect(currentPrediction(e.state)?.text).toBe(" you need");
    expect(key(e, "Tab")).toBe(true);
    expect(key(e, "Tab")).toBe(true);
    expect(e.state.doc.textContent).toBe("Let me know if you need");
    expect(currentPrediction(e.state)).toBeNull();
    // The depth didn't change: Tab only took words.
    expect(e.state.doc.child(0).attrs.depth).toBe(0);
    e.destroy();
  });

  test("with nothing showing, Tab indents as before", () => {
    const e = make([para("First"), para("Second")]);
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, e.state.doc.child(0).nodeSize + 3)));
    expect(currentPrediction(e.state)).toBeNull();
    key(e, "Tab");
    expect(e.state.doc.child(1).attrs.depth).toBe(1);
    expect(e.state.doc.textContent).toBe("FirstSecond");
    e.destroy();
  });

  test("Esc puts it away; typing or moving does too", () => {
    const e = make([para("Let me know")]);
    caretAtEnd(e);
    show(e, " if");
    expect(key(e, "Escape")).toBe(true);
    expect(currentPrediction(e.state)).toBeNull();
    show(e, " if");
    e.view.dispatch(e.state.tr.insertText("!"));
    expect(currentPrediction(e.state)).toBeNull();
    caretAtEnd(e);
    show(e, " if");
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)));
    expect(currentPrediction(e.state)).toBeNull();
    expect(acceptPrediction(e.view)).toBe(false);
    e.destroy();
  });

  test("a Foli AI answer becomes text to insert", () => {
    expect(firstWord(" if you need")).toBe(" if");
    expect(cleanCompletion(' "if you need anything"\nmore', "Let me know")).toBe(" if you need anything");
    expect(cleanCompletion(" if you", "Let me know ")).toBe("if you");
    expect(cleanCompletion("one two three four five six seven eight nine ten eleven twelve thirteen", "x").split(" ").length).toBe(12);
  });
});
