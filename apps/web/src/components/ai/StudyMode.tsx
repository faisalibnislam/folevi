"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { Check, CircleHelp, Layers, RotateCcw, Undo2 } from "lucide-react";
import { blockTypeFor } from "@/components/editor/convert";
import { cardsReducer, quizReducer, quizScore, startCards, startQuiz, studyItems, type Flashcard, type QuizQuestion, type StudyLine } from "./study";

/** The note's lines for study mode, kept up to date as it changes. */
function useNoteLines(editor: Editor | null): StudyLine[] {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const bump = () => setVersion((n) => n + 1);
    editor.on("update", bump);
    return () => void editor.off("update", bump);
  }, [editor]);
  return useMemo(() => {
    const lines: StudyLine[] = [];
    editor?.state.doc.forEach((n) => lines.push({ id: (n.attrs.id as string | null) ?? undefined, type: blockTypeFor(n.type.name), depth: Number(n.attrs.depth ?? 0), text: n.textContent }));
    return lines;
  }, [editor, version]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Study mode (the note's AI panel): runs through the note's flashcards (flip, "Know it" or "Again",
 * progress) and its quiz (pick an answer, see right or wrong and why, a score at the end). Cards are the
 * note's toggles (lib: ./study.ts); progress lasts for this session. With nothing to study yet, it offers to
 * make flashcards or a quiz, which go through the usual preview first.
 */
export function StudyMode({ editor, canMake, busy, onMake }: { editor: Editor | null; canMake: boolean; busy: boolean; onMake: (task: "flashcards" | "quiz") => void }) {
  const lines = useNoteLines(editor);
  const items = useMemo(() => studyItems(lines), [lines]);
  const cards = useMemo(() => items.filter((i): i is Flashcard => i.kind === "card"), [items]);
  const quiz = useMemo(() => items.filter((i): i is QuizQuestion => i.kind === "quiz"), [items]);
  const [tab, setTab] = useState<"cards" | "quiz">("cards");
  const shown = cards.length && (tab === "cards" || !quiz.length) ? "cards" : quiz.length ? "quiz" : null;

  const make = (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" disabled={!canMake || busy} onClick={() => onMake("flashcards")} className="ui-btn ui-btn-secondary h-8 px-2.5 text-[12.5px]">
        <Layers size={14} aria-hidden /> Make flashcards
      </button>
      <button type="button" disabled={!canMake || busy} onClick={() => onMake("quiz")} className="ui-btn ui-btn-secondary h-8 px-2.5 text-[12.5px]">
        <CircleHelp size={14} aria-hidden /> Make a quiz
      </button>
    </div>
  );

  if (!shown) {
    return (
      <section aria-label="Study" className="space-y-3 rounded-[12px] bg-[var(--glass-hover)] p-3.5">
        <p className="text-[13.5px] font-semibold text-heading">Nothing to study yet</p>
        <p className="text-[12.5px] leading-snug text-muted">Make flashcards or a quiz from this note (or the text you've selected). You'll see them before they're added, then study them here.</p>
        {make}
      </section>
    );
  }

  return (
    <section aria-label="Study" className="space-y-3">
      {cards.length && quiz.length ? (
        <div className="ui-seg ui-well" role="group" aria-label="Study with">
          <button type="button" aria-pressed={shown === "cards"} onClick={() => setTab("cards")}>
            Flashcards ({cards.length})
          </button>
          <button type="button" aria-pressed={shown === "quiz"} onClick={() => setTab("quiz")}>
            Quiz ({quiz.length})
          </button>
        </div>
      ) : null}
      {shown === "cards" ? <CardsDeck cards={cards} /> : <QuizRun questions={quiz} />}
      <div className="space-y-1.5 border-t border-line/60 pt-3">
        <p className="text-[12px] text-muted">Make more</p>
        {make}
      </div>
    </section>
  );
}

function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-1.5 overflow-hidden rounded-full bg-[var(--glass-active)]">
      <div className="h-full rounded-full bg-heading transition-[width] motion-reduce:transition-none" style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
    </div>
  );
}

/** Flashcards: flip, then Know it (done) or Again (back of the queue), until every card is known. */
export function CardsDeck({ cards }: { cards: readonly Flashcard[] }) {
  const ids = useMemo(() => cards.map((c) => c.id), [cards]);
  const [state, dispatch] = useReducer(cardsReducer, ids, startCards);
  const [said, setSaid] = useState("");
  const uid = useId();
  const flipRef = useRef<HTMLButtonElement>(null);
  // Cards added or removed in the note: new ones join the queue, removed ones leave it.
  const key = ids.join(",");
  useEffect(() => {
    const queue = state.queue.filter((id) => ids.includes(id));
    const fresh = ids.filter((id) => !state.queue.includes(id) && !state.known.includes(id));
    if (queue.length !== state.queue.length || fresh.length) dispatch({ type: "restart", ids: [...queue, ...fresh] });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const card = cards.find((c) => c.id === state.queue[0]);
  const known = state.known.filter((id) => ids.includes(id)).length;

  const act = (type: "know" | "again") => {
    dispatch({ type });
    const left = type === "know" ? state.queue.length - 1 : state.queue.length;
    setSaid(type === "know" ? (left ? `Known. ${known + 1} of ${cards.length}.` : `All ${cards.length} cards known.`) : "Again later.");
    flipRef.current?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !card) return;
    const k = e.key.toLowerCase();
    if (k === "f") dispatch({ type: "flip" });
    else if (k === "k") act("know");
    else if (k === "a") act("again");
    else return;
    e.preventDefault();
  };

  return (
    <div className="space-y-2.5" onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between text-[12px] text-muted">
        <span>
          {known} of {cards.length} known
        </span>
        {state.again.length ? <span>{state.again.length} to go over again</span> : null}
      </div>
      <Progress value={known} max={cards.length} label="Cards known" />
      {card ? (
        <>
          <div role="group" aria-roledescription="flashcard" aria-label={`Card: ${card.question}`} className="rounded-[12px] bg-[var(--glass-active)] p-3.5 shadow-[var(--glass-edge)]">
            <p className="text-[14px] font-semibold leading-snug text-heading">{card.question}</p>
            <div id={`${uid}-answer`} className="mt-2 min-h-[1.5rem]">
              {state.flipped ? <p className="whitespace-pre-wrap text-[13.5px] leading-snug text-ink">{card.answer}</p> : <p className="text-[12.5px] text-faint">Answer hidden</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button ref={flipRef} type="button" aria-expanded={state.flipped} aria-controls={`${uid}-answer`} onClick={() => dispatch({ type: "flip" })} className="ui-btn ui-btn-secondary h-8 px-3 text-[12.5px]">
              {state.flipped ? "Hide answer" : "Show answer"}
            </button>
            <button type="button" onClick={() => act("again")} className="ui-btn ui-btn-ghost h-8 px-2.5 text-[12.5px]">
              <Undo2 size={14} aria-hidden /> Again
            </button>
            <button type="button" onClick={() => act("know")} className="ui-btn ui-btn-primary h-8 px-3 text-[12.5px]">
              <Check size={14} aria-hidden /> Know it
            </button>
          </div>
          <p className="text-[11.5px] text-faint">Keys: F flips, A again, K know it.</p>
        </>
      ) : (
        <div className="space-y-2 rounded-[12px] bg-[var(--glass-hover)] p-3.5">
          <p className="text-[13.5px] font-semibold text-heading">You know all {cards.length} cards.</p>
          {state.again.length ? <p className="text-[12.5px] text-muted">{state.again.length === 1 ? "One needed" : `${state.again.length} needed`} another go.</p> : null}
          <button type="button" onClick={() => (dispatch({ type: "restart", ids }), setSaid(""))} className="ui-btn ui-btn-secondary h-8 px-3 text-[12.5px]">
            <RotateCcw size={14} aria-hidden /> Study again
          </button>
        </div>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  );
}

const LETTERS = "ABCDEF";

/** A quiz: pick an answer, see right or wrong with the explanation, then the next; a score at the end. */
export function QuizRun({ questions }: { questions: readonly QuizQuestion[] }) {
  const [state, dispatch] = useReducer(quizReducer, undefined, startQuiz);
  const nextRef = useRef<HTMLButtonElement>(null);
  const key = questions.map((q) => q.id).join(",");
  useEffect(() => dispatch({ type: "restart" }), [key]);
  const q = questions[Math.min(state.index, questions.length - 1)];
  const picked = state.picked[state.index];
  const answered = picked !== undefined;
  const score = quizScore(questions, state);
  useEffect(() => {
    if (answered) nextRef.current?.focus();
  }, [answered, state.index]);
  if (!q) return null;

  if (state.done) {
    return (
      <div className="space-y-2 rounded-[12px] bg-[var(--glass-hover)] p-3.5" role="status" aria-live="polite">
        <p className="text-[13.5px] font-semibold text-heading">
          You got {score} of {questions.length} right.
        </p>
        <button type="button" onClick={() => dispatch({ type: "restart" })} className="ui-btn ui-btn-secondary h-8 px-3 text-[12.5px]">
          <RotateCcw size={14} aria-hidden /> Try again
        </button>
      </div>
    );
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || answered) return;
    const i = LETTERS.indexOf(e.key.toUpperCase());
    const n = Number(e.key) - 1;
    const option = i >= 0 ? i : n >= 0 && n < q.options.length ? n : -1;
    if (option < 0 || option >= q.options.length) return;
    e.preventDefault();
    dispatch({ type: "pick", option });
  };

  return (
    <div className="space-y-2.5" onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between text-[12px] text-muted">
        <span>
          Question {state.index + 1} of {questions.length}
        </span>
        <span>{score} right</span>
      </div>
      <Progress value={state.index + (answered ? 1 : 0)} max={questions.length} label="Quiz progress" />
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-[14px] font-semibold leading-snug text-heading">{q.question}</legend>
        {q.options.map((o, i) => {
          const right = answered && i === q.answer;
          const wrong = answered && i === picked && i !== q.answer;
          return (
            <button
              key={i}
              type="button"
              aria-disabled={answered}
              aria-pressed={picked === i}
              onClick={() => !answered && dispatch({ type: "pick", option: i })}
              className={`flex w-full items-start gap-2 rounded-[8px] px-2.5 py-2 text-left text-[13px] shadow-[inset_0_0_0_1px_var(--glass-border)] ${right ? "bg-success-soft text-success" : wrong ? "bg-danger-soft text-danger" : "bg-[var(--glass-hover)] text-ink"} ${answered ? "cursor-default" : "hover:bg-[var(--glass-active)] hover:text-heading"}`}
            >
              <span className="font-semibold text-muted">{LETTERS[i]}.</span>
              <span className="min-w-0 flex-1">{o}</span>
              {right ? <span className="sr-only"> (right answer)</span> : wrong ? <span className="sr-only"> (your answer, wrong)</span> : null}
            </button>
          );
        })}
      </fieldset>
      <div role="status" aria-live="polite">
        {answered ? (
          <p className="text-[12.5px] leading-snug text-ink">
            <span className="font-semibold text-heading">{picked === q.answer ? "Right." : `Not quite. It's ${LETTERS[q.answer]}.`}</span>
            {q.explanation ? ` ${q.explanation}` : ""}
          </p>
        ) : null}
      </div>
      {answered ? (
        <button ref={nextRef} type="button" onClick={() => dispatch({ type: "next", total: questions.length })} className="ui-btn ui-btn-primary h-8 px-3 text-[12.5px]">
          {state.index + 1 >= questions.length ? "See your score" : "Next question"}
        </button>
      ) : (
        <p className="text-[11.5px] text-faint">Keys: A to {LETTERS[q.options.length - 1]} (or 1 to {q.options.length}) pick an answer.</p>
      )}
    </div>
  );
}
