// Study mode (docs/AI_ASSISTANT.md milestone 8): flashcards and quizzes live in the note itself, as toggles
// (the question is the toggle, the answer is inside it; the AI writes them that way, see
// convex/lib/ai/studyTools.ts). The toggles the AI makes are marked (the toggle's `study` prop, "card" or
// "quiz"), so study mode reads only those by default; "Use all toggles" reads every toggle with something
// inside (cards people wrote themselves). Study mode reads the note as it is now. Progress (which cards you
// know, your quiz answers) is kept for this session only: it's practice, not part of the note, and starting
// again is one click.

/** A line of the note, enough to find cards in it: its type, depth (nesting), plain text and study mark. */
export interface StudyLine {
  id?: string;
  type: string;
  depth: number;
  text: string;
  /** A toggle the AI made as a flashcard or quiz question. */
  study?: "card" | "quiz" | null;
}

export interface Flashcard {
  kind: "card";
  id: string;
  question: string;
  answer: string;
}

export interface QuizQuestion {
  kind: "quiz";
  id: string;
  question: string;
  options: string[];
  /** The right option's index. */
  answer: number;
  explanation: string;
}

export type StudyItem = Flashcard | QuizQuestion;

const OPTION = /^([A-F])[.)]\s+(.+)$/;
const ANSWER = /^Answer:\s*([A-F])\b[.)]?\s*(.*)$/i;

/** A toggle with a question and something inside it (what a card needs). */
function withInside(lines: readonly StudyLine[], i: number): boolean {
  const line = lines[i]!;
  if (line.type !== "toggle" || !line.text.trim()) return false;
  for (let k = i + 1; k < lines.length && lines[k]!.depth > line.depth; k++) if (lines[k]!.depth === line.depth + 1 && lines[k]!.text.trim()) return true;
  return false;
}

/** Toggles with something inside that the AI didn't mark as cards: what "Use all toggles" would add. */
export const unmarkedToggles = (lines: readonly StudyLine[]) => lines.filter((l, i) => !l.study && withInside(lines, i)).length;

/**
 * The flashcards and quiz questions in a note: the toggles the AI marked as cards or quiz questions, or with
 * `all`, every toggle with something inside it. A toggle whose inside is lettered options ("A. …") and a
 * line "Answer: B. why" is a quiz question; any other is a flashcard (the toggle's text is the question,
 * what's inside is the answer).
 */
export function studyItems(lines: readonly StudyLine[], opts: { all?: boolean } = {}): StudyItem[] {
  const out: StudyItem[] = [];
  lines.forEach((line, i) => {
    if (line.type !== "toggle" || !line.text.trim()) return;
    if (!line.study && !opts.all) return;
    const inside: StudyLine[] = [];
    for (let k = i + 1; k < lines.length && lines[k]!.depth > line.depth; k++) inside.push(lines[k]!);
    const direct = inside.filter((l) => l.depth === line.depth + 1 && l.text.trim());
    if (!direct.length) return;
    const id = line.id ?? `item-${i}`;
    const options = direct.filter((l) => l.type === "bulleted" || l.type === "numbered").map((l) => OPTION.exec(l.text.trim()));
    const answerLine = direct.map((l) => ANSWER.exec(l.text.trim())).find(Boolean);
    if (answerLine && options.length >= 2 && options.every(Boolean)) {
      const letters = options.map((m) => m![1]!.toUpperCase());
      const answer = letters.indexOf(answerLine[1]!.toUpperCase());
      if (answer >= 0) {
        out.push({ kind: "quiz", id, question: line.text.trim(), options: options.map((m) => m![2]!.trim()), answer, explanation: answerLine[2]!.trim() });
        return;
      }
    }
    out.push({ kind: "card", id, question: line.text.trim(), answer: inside.map((l) => l.text.trim()).filter(Boolean).join("\n") });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Flashcards: a queue. "Know it" takes the card out; "Again" puts it at the back.
// ---------------------------------------------------------------------------------------------------

export interface CardsState {
  /** Card ids still to go, the current one first. */
  queue: string[];
  known: string[];
  flipped: boolean;
  /** Cards seen again (marked "Again" at least once). */
  again: string[];
}

export type CardsAction = { type: "flip" } | { type: "know" } | { type: "again" } | { type: "restart"; ids: string[] };

export const startCards = (ids: readonly string[]): CardsState => ({ queue: [...ids], known: [], flipped: false, again: [] });

export function cardsReducer(state: CardsState, action: CardsAction): CardsState {
  const current = state.queue[0];
  switch (action.type) {
    case "flip":
      return current ? { ...state, flipped: !state.flipped } : state;
    case "know":
      return current ? { ...state, queue: state.queue.slice(1), known: [...state.known, current], flipped: false } : state;
    case "again":
      if (!current) return state;
      return { ...state, queue: [...state.queue.slice(1), current], flipped: false, again: state.again.includes(current) ? state.again : [...state.again, current] };
    case "restart":
      return startCards(action.ids);
  }
}

// ---------------------------------------------------------------------------------------------------
// A quiz: one question at a time; pick an answer, see if it's right and why, then the next. A score at the end.
// ---------------------------------------------------------------------------------------------------

export interface QuizState {
  index: number;
  /** The option picked for each question answered so far (by question index). */
  picked: number[];
  done: boolean;
}

export type QuizAction = { type: "pick"; option: number } | { type: "next"; total: number } | { type: "restart" };

export const startQuiz = (): QuizState => ({ index: 0, picked: [], done: false });

export function quizReducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case "pick":
      // One answer per question: the first pick counts.
      if (state.done || state.picked[state.index] !== undefined) return state;
      return { ...state, picked: Object.assign([...state.picked], { [state.index]: action.option }) };
    case "next":
      if (state.picked[state.index] === undefined) return state;
      return state.index + 1 >= action.total ? { ...state, done: true } : { ...state, index: state.index + 1 };
    case "restart":
      return startQuiz();
  }
}

/** Right answers so far. */
export const quizScore = (questions: readonly QuizQuestion[], state: QuizState) => questions.filter((q, i) => state.picked[i] === q.answer).length;
