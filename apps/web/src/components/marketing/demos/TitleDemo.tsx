"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Lightbulb, Minimize2, SpellCheck, Wand2 } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { cx } from "../ui";
import { autoplay } from "./autoplay";

/*
 * Title AI (components/doc/TitleAi.tsx), playing by itself: the title's words are selected, the "Edit
 * with AI" pill opens the menu, an action runs and the new title is written in. Visitors can pick an
 * action, and click the title to start again. The titles are canned.
 */

const MESSY = "notes from tuesdays call w/ ines";
const ROWS: Array<{ icon: ReactNode; label: string; result: string }> = [
  { icon: <Lightbulb size={15} />, label: "Suggest a new title from the note", result: "Swap day plans with Ines" },
  { icon: <Wand2 size={15} />, label: "Improve writing", result: "Notes from Tuesday’s call with Ines" },
  { icon: <SpellCheck size={15} />, label: "Fix spelling & grammar", result: "Notes from Tuesday’s call with Ines" },
  { icon: <Minimize2 size={15} />, label: "Make shorter", result: "Tuesday call with Ines" },
];

type Phase = { kind: "idle" } | { kind: "selecting"; chars: number } | { kind: "pill" } | { kind: "menu"; active: number } | { kind: "thinking"; row: number } | { kind: "writing"; row: number; chars: number };

export function TitleDemo() {
  const [title, setTitle] = useState(MESSY);
  const [phase, setPhase] = useState<Phase>({ kind: "menu", active: 0 });
  const [auto, setAuto] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const runId = useRef(0);

  const apply = async (row: number, sleep: (ms: number) => Promise<void>) => {
    const id = ++runId.current;
    setPhase({ kind: "thinking", row });
    await sleep(900);
    const next = ROWS[row]!.result;
    for (let c = 0; c <= next.length; c++) {
      if (id !== runId.current) return;
      setPhase({ kind: "writing", row, chars: c });
      await sleep(40);
    }
    setTitle(next);
    if (id === runId.current) setPhase({ kind: "idle" });
  };

  useEffect(() => {
    if (!auto) return;
    return autoplay(root.current, async (sleep) => {
      for (let round = 0; ; round = (round + 1) % 3) {
        const row = [0, 2, 3][round]!;
        setTitle(MESSY);
        setPhase({ kind: "idle" });
        await sleep(1200);
        for (let c = 1; c <= MESSY.length; c += 2) {
          setPhase({ kind: "selecting", chars: c });
          await sleep(30);
        }
        setPhase({ kind: "selecting", chars: MESSY.length });
        await sleep(300);
        setPhase({ kind: "pill" });
        await sleep(1000);
        for (let a = 0; a <= row; a++) {
          setPhase({ kind: "menu", active: a });
          await sleep(a === 0 ? 800 : 300);
        }
        await sleep(400);
        await apply(row, sleep);
        await sleep(3000);
      }
    });
  }, [auto]);

  const plain = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const take = () => setAuto(false);
  const shownTitle = phase.kind === "writing" ? ROWS[phase.row]!.result.slice(0, phase.chars) : phase.kind === "thinking" ? title : title;
  const selectedChars = phase.kind === "selecting" ? phase.chars : phase.kind === "pill" || phase.kind === "menu" || phase.kind === "thinking" ? title.length : 0;

  return (
    <div ref={root} onPointerDown={take} onKeyDown={take} role="group" aria-label="A working sample of title AI. Click the title, then pick an action." className="mx-auto min-h-[330px] w-full max-w-[400px]">
      <button
        type="button"
        onClick={() => {
          take();
          runId.current++;
          setTitle(MESSY);
          setPhase({ kind: "menu", active: 0 });
        }}
        className="mk-display block text-left text-[24px] text-(--color-heading)"
        aria-label="Select the title"
      >
        <span className="bg-[color-mix(in_oklab,#7c6cf0_24%,transparent)]">{shownTitle.slice(0, selectedChars)}</span>
        {shownTitle.slice(selectedChars)}
        {phase.kind === "writing" ? <span className="ml-0.5 inline-block h-6 w-[2px] translate-y-1 animate-pulse bg-[#7c6cf0]" /> : null}
      </button>
      {phase.kind === "pill" ? (
        <span className="mk-app-pop mk-appear mt-2.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium text-ink">
          <AiIcon size={14} className="text-[#7c6cf0]" /> Edit with AI
          <kbd className="ml-1 font-sans text-[11px] text-faint">⌘J</kbd>
        </span>
      ) : null}
      {phase.kind === "menu" || phase.kind === "thinking" ? (
        <div className="mk-app-pop mk-appear mt-2.5 overflow-hidden rounded-[14px] text-[13.5px]">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <AiIcon size={16} className={cx("flex-none text-[#7c6cf0]", phase.kind === "thinking" && "animate-pulse")} />
            <span className="min-w-0 flex-1 truncate text-faint">{phase.kind === "thinking" ? `${ROWS[phase.row]!.label}…` : "Ask AI to edit the title…"}</span>
          </div>
          <ul className="border-t border-(--color-line) p-1.5">
            {ROWS.map((r, i) => (
              <li key={r.label}>
                <button
                  type="button"
                  disabled={phase.kind === "thinking"}
                  onClick={() => {
                    take();
                    void apply(i, plain);
                  }}
                  onPointerEnter={() => phase.kind === "menu" && setPhase({ kind: "menu", active: i })}
                  className={cx(
                    "flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-[7px] text-left",
                    (phase.kind === "menu" && phase.active === i) || (phase.kind === "thinking" && phase.row === i) ? "bg-(--glass-hover) text-(--color-heading)" : "text-ink",
                  )}
                >
                  <span className="text-muted">{r.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {phase.kind === "idle" && !auto ? <p className="mt-3 text-[12.5px] text-muted">Click the title to try another.</p> : null}
    </div>
  );
}
