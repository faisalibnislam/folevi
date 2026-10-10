"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, FileText, X } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { cx } from "../ui";
import { autoplay } from "./autoplay";

/*
 * The Ask Foli chat (components/ai/AskAiChat.tsx), playing by itself: a question is typed and sent, Folevi
 * reads the notes, the answer streams in with citations and the notes it used appear as sources. Visitors
 * can pick a suggested question or type one; the answers are canned, from the site's sample notes.
 */

type Part = { t: string; b?: boolean; cite?: number };
type Qa = { q: string; answer: Part[]; sources: string[] };

const QAS: Qa[] = [
  {
    q: "When is swap day, and what’s left to do?",
    answer: [
      { t: "Swap day is the " },
      { t: "first Saturday in April", b: true },
      { t: " ", cite: 1 },
      { t: ". Two tasks are still open: print the seed labels by Friday, and order glassine envelopes by Monday " },
      { t: "", cite: 2 },
      { t: "." },
    ],
    sources: ["Seed library", "Thursday notes"],
  },
  {
    q: "Which tasks are still open?",
    answer: [
      { t: "Three are open. " },
      { t: "Print seed labels", b: true },
      { t: " is overdue since Monday " },
      { t: "", cite: 1 },
      { t: ". Pick up keys from Ines and order glassine envelopes are due today " },
      { t: "", cite: 2 },
      { t: "." },
    ],
    sources: ["Seed library", "Studio move"],
  },
  {
    q: "Summarize my notes about travel",
    answer: [
      { t: "Four days in " },
      { t: "Alfama in April", b: true },
      { t: ", flying back on the 21st " },
      { t: "", cite: 1 },
      { t: ". The ferry is booked for Friday morning, and the tram tour still needs a time " },
      { t: "", cite: 2 },
      { t: "." },
    ],
    sources: ["Lisbon in April", "Trip sketch"],
  },
];

const OTHER: Qa = {
  q: "",
  answer: [{ t: "This demo only knows a few sample notes. Sign up and Foli answers from your own notes, with links to the notes it used." }],
  sources: [],
};

const length = (parts: Part[]) => parts.reduce((n, p) => n + p.t.length, 0);

type Turn = { qa: Qa; question: string; shown: number; phase: "reading" | "writing" | "done" };

export function AskDemo() {
  const [turn, setTurn] = useState<Turn | null>(null);
  const [draft, setDraft] = useState("");
  const [auto, setAuto] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const runId = useRef(0);

  /** Plays one question and answer; a newer run (a click, or the next autoplay step) cancels this one. */
  const ask = async (qa: Qa, question: string, sleep: (ms: number) => Promise<void>) => {
    const id = ++runId.current;
    const live = () => id === runId.current;
    setDraft("");
    setTurn({ qa, question, shown: 0, phase: "reading" });
    await sleep(1300);
    if (!live()) return;
    const total = length(qa.answer);
    for (let shown = 0; shown < total; shown += 3) {
      if (!live()) return;
      setTurn({ qa, question, shown, phase: "writing" });
      await sleep(28);
    }
    if (live()) setTurn({ qa, question, shown: total, phase: "done" });
  };

  // Autoplay: type a question into the composer, send it, read the answer, start a new chat, repeat.
  useEffect(() => {
    if (!auto) return;
    return autoplay(root.current, async (sleep) => {
      await sleep(900);
      for (let i = 0; ; i = (i + 1) % QAS.length) {
        const qa = QAS[i]!;
        setTurn(null);
        await sleep(1200);
        for (let n = 1; n <= qa.q.length; n++) {
          setDraft(qa.q.slice(0, n));
          await sleep(38);
        }
        await sleep(500);
        await ask(qa, qa.q, sleep);
        await sleep(4200);
      }
    });
  }, [auto]);

  // A visitor's own question stops the autoplay and plays at normal speed.
  const plain = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const pick = (qa: Qa, question = qa.q) => {
    setAuto(false);
    void ask(qa, question, plain);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const question = draft.trim();
    if (!question) return;
    const known = QAS.find((qa) => qa.q.toLowerCase().replace(/[’']/g, "") === question.toLowerCase().replace(/[’']/g, ""));
    pick(known ?? OTHER, question);
  };

  return (
    <div
      ref={root}
      onPointerDown={() => setAuto(false)}
      className="mk-app-pop mx-auto flex h-[470px] max-w-[420px] flex-col overflow-hidden rounded-[18px] text-[13.5px]"
      aria-label="A working sample of Foli. Pick a question or type one."
      role="group"
    >
      <div className="flex items-center gap-2.5 border-b border-(--color-line) px-4 py-3">
        <AiIcon size={20} />
        <p className="flex-1 text-[14.5px] font-semibold text-(--color-heading)">Foli</p>
        <button
          type="button"
          onClick={() => {
            setAuto(false);
            runId.current++;
            setTurn(null);
          }}
          className="rounded-[6px] px-1.5 py-0.5 text-[12px] text-muted hover:bg-(--glass-hover) hover:text-(--color-heading)"
        >
          New chat
        </button>
        <X size={16} aria-hidden="true" className="text-muted" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-4 py-4" aria-live="polite">
        {!turn ? (
          <div className="mk-appear">
            <p className="text-[13px] text-muted">Answers come from your notes, with links to the notes used.</p>
            <p className="mk-caps mt-4 text-[10.5px]">Try asking</p>
            <div className="mt-2 flex flex-col items-start gap-1.5">
              {QAS.map((qa) => (
                <button
                  key={qa.q}
                  type="button"
                  onClick={() => pick(qa)}
                  className="rounded-[6px] bg-(--glass-hover) px-3 py-1.5 text-left text-[12.5px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] transition-colors hover:bg-(--glass-active) hover:text-(--color-heading)"
                >
                  {qa.q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="mk-appear ml-auto w-fit max-w-[85%] rounded-[14px] rounded-br-[4px] bg-(--color-heading) px-3.5 py-2 text-(--color-canvas)">{turn.question}</p>
            <div className="mk-appear rounded-[14px] rounded-bl-[4px] bg-(--glass-active) px-4 py-3 leading-relaxed text-ink shadow-(--glass-edge)">
              {turn.phase === "reading" ? (
                <div className="space-y-2 py-0.5">
                  <p className="text-[12.5px] text-muted">Reading your notes…</p>
                  {[90, 72, 84].map((w) => (
                    <div key={w} className="h-2.5 animate-pulse rounded-[4px] bg-[linear-gradient(90deg,color-mix(in_oklab,#8b7cf6_22%,transparent),color-mix(in_oklab,#f58ab8_18%,transparent))]" style={{ width: `${w}%` }} />
                  ))}
                </div>
              ) : (
                <>
                  <p>
                    <Answer parts={turn.qa.answer} shown={turn.shown} />
                    {turn.phase === "writing" ? <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-[2px] animate-pulse bg-[#7c6cf0]" /> : null}
                  </p>
                  {turn.phase === "done" && turn.qa.sources.length ? (
                    <div className="mk-appear mt-3 border-t border-(--color-line) pt-2.5">
                      <p className="mk-caps mb-1.5 text-[10.5px]">Sources</p>
                      <div className="flex flex-wrap gap-1.5">
                        {turn.qa.sources.map((title, n) => (
                          <span key={title} className="inline-flex items-center gap-1.5 rounded-[6px] bg-(--glass-hover) px-2.5 py-1 text-[12px] text-ink">
                            <span className="font-semibold text-muted">{n + 1}</span>
                            <FileText size={12} aria-hidden="true" className="text-muted" />
                            {title}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="border-t border-(--color-line) px-3 pb-3 pt-2.5">
        <div className="relative rounded-[14px] bg-(--glass-hover) shadow-[inset_0_0_0_1px_var(--glass-border)]">
          <label className="sr-only" htmlFor="ask-demo-input">
            Ask a question about the sample notes
          </label>
          <input
            id="ask-demo-input"
            value={draft}
            onChange={(e) => {
              setAuto(false);
              setDraft(e.target.value);
            }}
            placeholder={turn ? "Ask a follow-up…" : "Ask anything about your notes…"}
            autoComplete="off"
            className="h-[52px] w-full bg-transparent pl-3.5 pr-11 text-[13.5px] text-ink outline-none placeholder:text-faint"
          />
          <button
            type="submit"
            aria-label="Send"
            className={cx("absolute bottom-3 right-2 grid size-7 place-items-center rounded-[6px] bg-(--color-heading) text-(--color-canvas) transition-opacity", draft.trim() ? "opacity-100" : "opacity-30")}
          >
            <ArrowUp size={15} aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 px-1 text-[11px] text-faint">AI can make mistakes. Questions and the notes they need go to Google Gemini.</p>
      </form>
    </div>
  );
}

/** The answer so far: bold runs and citation numbers, cut at `shown` characters. */
function Answer({ parts, shown }: { parts: Part[]; shown: number }) {
  let left = shown;
  const out = [];
  for (const [i, p] of parts.entries()) {
    if (left < 0) break;
    const text = p.t.slice(0, Math.max(0, left));
    left -= p.t.length;
    out.push(
      <span key={i}>
        {p.b ? <strong className="font-semibold text-(--color-heading)">{text}</strong> : text}
        {p.cite && left >= 0 ? <span className="text-muted">[{p.cite}]</span> : null}
      </span>,
    );
  }
  return <>{out}</>;
}
