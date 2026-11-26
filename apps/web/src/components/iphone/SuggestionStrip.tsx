"use client";
// The suggestion row over the phone keyboard (the iPhone, iPad and Android apps' KeyboardBar, NoteBars.tsx):
// a system keyboard's own suggestion bar can't be written to from a web view, so Folevi's sits just above it
// (docs/SPELLING_PLAN.md). With the caret in a misspelt word: its likeliest spellings, then Add to dictionary.
// Otherwise: the next word the prediction has (phones have no Tab: a tap takes it, and the next one comes).
// Shown only when there is something in it; its buttons never take the focus, so the keyboard stays up.
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { isSealedDocument } from "@/lib/e2ee/router/hooks";
import { learnWebSpelling, webSpelling } from "@/lib/spelling/web";
import { acceptPrediction, currentPrediction, firstWord, PREDICTION_EVENT } from "@/components/editor/predict";
import { misspeltAt, type SpellcheckStorage } from "@/components/editor/spellcheck";

type Row = { kind: "spelling"; word: string; from: number; to: number; guesses: string[] } | { kind: "predict"; text: string } | null;

export function SuggestionStrip({ editor }: { editor: Editor }) {
  const [row, setRow] = useState<Row>(null);
  const asked = useRef("");
  useEffect(() => {
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        const { state } = editor;
        const hit = state.selection.empty ? misspeltAt(state, state.selection.from) : null;
        if (hit) {
          const key = `${hit.from}:${hit.word}`;
          if (asked.current === key) return;
          asked.current = key;
          void webSpelling(hit.word, hit.langs).then((a) => {
            if (asked.current === key) setRow({ kind: "spelling", word: hit.word, from: hit.from, to: hit.to, guesses: a?.guesses.slice(0, 3) ?? [] });
          });
          return;
        }
        asked.current = "";
        const g = currentPrediction(state);
        setRow(g ? { kind: "predict", text: g.text } : null);
      });
    };
    read();
    editor.on("transaction", read);
    window.addEventListener(PREDICTION_EVENT, read);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", read);
      window.removeEventListener(PREDICTION_EVENT, read);
    };
  }, [editor]);

  if (!row) return null;
  const down = { x: 0, y: 0 };
  const chip = (label: string, run: () => void, quiet = false) => (
    <button
      key={label}
      type="button"
      tabIndex={-1}
      dir="auto"
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (t) Object.assign(down, { x: t.clientX, y: t.clientY });
      }}
      onTouchEnd={(e) => {
        // A tap is handled here, without the click that would follow: the editor keeps its focus.
        e.preventDefault();
        const t = e.changedTouches[0];
        if (t && Math.hypot(t.clientX - down.x, t.clientY - down.y) <= 10) run();
      }}
      onClick={run}
      className={`h-9 min-w-0 flex-none truncate rounded-capsule px-3 text-callout outline-none active:bg-[var(--liquid-press)] ${quiet ? "text-muted" : "font-semibold text-heading"}`}
    >
      {label}
    </button>
  );
  const noteId = (editor.storage as { spellcheck?: SpellcheckStorage }).spellcheck?.documentId ?? null;
  return (
    <div role="toolbar" aria-label={row.kind === "spelling" ? `Spelling suggestions for ${row.word}` : "Next word"} className="ui-liquid mb-1.5 flex h-10 items-center gap-0.5 overflow-x-auto rounded-capsule px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {row.kind === "spelling" ? (
        <>
          {row.guesses.map((g) =>
            chip(g, () => {
              const { state } = editor;
              if (state.doc.textBetween(row.from, row.to) === row.word) editor.view.dispatch(state.tr.insertText(g, row.from, row.to));
            }),
          )}
          {chip("Add to dictionary", () => learnWebSpelling(row.word, noteId ? isSealedDocument(noteId) : false), true)}
        </>
      ) : (
        chip(firstWord(row.text).trim(), () => void acceptPrediction(editor.view))
      )}
    </div>
  );
}
