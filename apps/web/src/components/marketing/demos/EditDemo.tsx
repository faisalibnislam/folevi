"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, Check, ChevronRight, CornerDownLeft, Languages, Maximize2, Minimize2, PenLine, RotateCcw, SpellCheck, Wand2, X } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { artById, artVars } from "../product/Replica";
import { cx } from "../ui";
import { autoplay, streamed } from "./autoplay";

/*
 * Editing with ⌘J (components/ai/InlineAi.tsx), playing by itself: a sentence is selected, the composer
 * opens under it, an action runs, the rewrite streams in and Replace puts it in the note. Visitors can
 * pick any action, then Replace, Try again or Discard. The rewrites are canned.
 */

const ORIGINAL = "the swap moved to the libary hall becuase the café is closed for repairs, so everyone should bring there seeds there";

type Action = { label: string; icon: ReactNode; more?: boolean; result: string };
const ACTIONS: Action[] = [
  { label: "Improve writing", icon: <Wand2 size={15} />, result: "the swap has moved to the library hall while the café is closed for repairs, so please bring your seeds there" },
  { label: "Fix spelling & grammar", icon: <SpellCheck size={15} />, result: "the swap moved to the library hall because the café is closed for repairs, so everyone should bring their seeds there" },
  { label: "Make shorter", icon: <Minimize2 size={15} />, result: "the swap is now at the library hall, so bring your seeds there" },
  { label: "Make longer", icon: <Maximize2 size={15} />, result: "the swap has moved to the library hall on Alder Street because the café is closed for repairs this month, so everyone should bring their seeds and labels there instead" },
  { label: "Simplify language", icon: <BookOpen size={15} />, result: "the swap is now at the library hall. The café is shut, so bring your seeds there" },
  { label: "Sound professional", icon: <PenLine size={15} />, result: "the seed swap has been moved to the library hall while the café is under repair; please bring your seeds to the new venue" },
  { label: "Sound casual", icon: <PenLine size={15} />, result: "heads up, the swap’s moved to the library hall since the café’s closed for repairs, so bring your seeds there" },
  { label: "Translate to…", icon: <Languages size={15} />, more: true, result: "el intercambio se ha trasladado a la sala de la biblioteca porque el café está cerrado por reformas, así que traed vuestras semillas allí" },
];

/** What the autoplay runs, in order (indexes into ACTIONS). */
const SCRIPT = [1, 2, 6, 7];

type Phase =
  | { kind: "idle" }
  | { kind: "selecting"; words: number }
  | { kind: "menu"; active: number }
  | { kind: "busy"; action: number }
  | { kind: "result"; action: number; shown: number };

export function EditDemo() {
  const [text, setText] = useState(ORIGINAL);
  const [phase, setPhase] = useState<Phase>({ kind: "menu", active: 0 });
  const [flash, setFlash] = useState(false);
  const [auto, setAuto] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const runId = useRef(0);

  const run = async (action: number, sleep: (ms: number) => Promise<void>) => {
    const id = ++runId.current;
    setPhase({ kind: "busy", action });
    await sleep(900);
    const result = ACTIONS[action]!.result;
    for (let shown = 0; shown <= result.length + 3; shown += 4) {
      if (id !== runId.current) return;
      setPhase({ kind: "result", action, shown });
      await sleep(30);
    }
  };
  const replace = (action: number) => {
    runId.current++;
    setText(ACTIONS[action]!.result);
    setPhase({ kind: "idle" });
    setFlash(true);
    setTimeout(() => setFlash(false), 900);
  };

  useEffect(() => {
    if (!auto) return;
    return autoplay(root.current, async (sleep) => {
      for (;;) {
        for (const action of SCRIPT) {
          setText(action === SCRIPT[0] ? ORIGINAL : ACTIONS[SCRIPT[0]!]!.result);
          setPhase({ kind: "idle" });
          await sleep(1100);
          const words = (action === SCRIPT[0] ? ORIGINAL : ACTIONS[SCRIPT[0]!]!.result).split(" ").length;
          for (let w = 1; w <= words; w++) {
            setPhase({ kind: "selecting", words: w });
            await sleep(55);
          }
          await sleep(400);
          for (let a = 0; a <= action; a++) {
            setPhase({ kind: "menu", active: a });
            await sleep(a === 0 ? 700 : 260);
          }
          await sleep(500);
          await run(action, sleep);
          await sleep(1400);
          replace(action);
          await sleep(2600);
        }
      }
    });
  }, [auto]);

  const plain = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const take = () => setAuto(false);
  const open = phase.kind === "menu" || phase.kind === "busy" || phase.kind === "result";
  const selected = open || (phase.kind === "selecting" ? phase.words : 0);
  const words = text.split(" ");
  const highlightWords = selected === true ? words.length : selected || 0;

  return (
    <div ref={root} onPointerDown={take} onKeyDown={take} role="group" aria-label="A working sample of editing with ⌘J. Select the sentence, then pick an action." className="mx-auto h-[600px] w-full max-w-[480px]">
      <div className="mk-note rounded-[14px] px-5 pb-6 pt-5 text-[14px] leading-[1.65] shadow-(--glass-edge)" style={{ ...artVars(artById("art-16")), fontFamily: "var(--font-serif)" }}>
        <p className="mk-note-h text-[19px]">Swap day update</p>
        <p className="mt-2">
          Quick note for the group:{" "}
          <span
            role="button"
            tabIndex={0}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                take();
                setPhase({ kind: "menu", active: 0 });
              }
            }}
            onClick={() => {
              take();
              setPhase({ kind: "menu", active: 0 });
            }}
            className={cx("cursor-text rounded-[2px] outline-none transition-colors focus-visible:shadow-[0_0_0_2px_var(--color-focus)] duration-700", flash && "bg-[color-mix(in_oklab,#3fb27f_26%,transparent)]")}
            aria-label="Select the sentence"
          >
            {words.map((w, i) => (
              <span key={i} className={cx(i < highlightWords && "bg-[color-mix(in_oklab,#7c6cf0_24%,transparent)]")}>
                {w}
                {i < words.length - 1 ? " " : ""}
              </span>
            ))}
          </span>
          .
        </p>
      </div>

      {open ? (
        <div className="mk-app-pop mk-appear relative z-10 -mt-3 ml-4 overflow-hidden rounded-[14px] text-[13.5px] sm:ml-10">
          <p className="truncate border-b border-(--color-line) px-3.5 py-2 text-[12px] text-muted">
            <span className="font-semibold">Editing:</span> “{text}”
          </p>
          {phase.kind === "busy" || phase.kind === "result" ? (
            <div className="border-b border-(--color-line) px-4 pb-2.5 pt-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
                <AiIcon size={12} className={cx("text-[#7c6cf0]", phase.kind === "busy" && "animate-pulse")} />
                {ACTIONS[phase.action]!.label === "Translate to…" ? "Translate to Spanish" : ACTIONS[phase.action]!.label}
                {phase.kind === "busy" ? "…" : ""}
              </p>
              {phase.kind === "busy" ? (
                <div className="space-y-2 pb-1">
                  {[92, 70].map((w) => (
                    <div key={w} className="h-2.5 animate-pulse rounded-full bg-[linear-gradient(90deg,color-mix(in_oklab,#8b7cf6_22%,transparent),color-mix(in_oklab,#f58ab8_18%,transparent))]" style={{ width: `${w}%` }} />
                  ))}
                </div>
              ) : (
                <p className="leading-relaxed text-ink">{streamed(ACTIONS[phase.action]!.result, phase.shown)}</p>
              )}
            </div>
          ) : null}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <AiIcon size={16} className="flex-none text-[#7c6cf0]" />
            <span className="min-w-0 flex-1 truncate text-[14px] text-faint">{phase.kind === "result" ? "Tell AI what to change… (⏎ to accept)" : "Ask AI to edit the selected text…"}</span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => {
                take();
                runId.current++;
                setPhase({ kind: "idle" });
              }}
              className="grid size-7 place-items-center rounded-[6px] text-muted hover:bg-(--glass-hover)"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
          {phase.kind === "result" ? (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-(--color-line) px-3 py-2.5 text-[12.5px]">
              <button
                type="button"
                onClick={() => {
                  take();
                  replace(phase.action);
                }}
                className="mk-btn mk-btn-primary h-8 gap-1.5 px-3"
              >
                <Check size={14} aria-hidden="true" /> Replace
              </button>
              <span className="inline-flex h-8 items-center gap-1.5 px-2 text-ink">
                <CornerDownLeft size={14} aria-hidden="true" /> Insert below
              </span>
              <button
                type="button"
                onClick={() => {
                  take();
                  void run(phase.action, plain);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-ink hover:bg-(--glass-hover)"
              >
                <RotateCcw size={13} aria-hidden="true" /> Try again
              </button>
            </div>
          ) : phase.kind === "menu" ? (
            <ul className="border-t border-(--color-line) p-1.5" aria-label="Edit or review">
              <li className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Edit or review</li>
              {ACTIONS.map((a, i) => (
                <li key={a.label}>
                  <button
                    type="button"
                    onClick={() => {
                      take();
                      void run(i, plain);
                    }}
                    onPointerEnter={() => setPhase({ kind: "menu", active: i })}
                    className={cx("flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-[7px] text-left", i === phase.active ? "bg-(--glass-hover) text-(--color-heading)" : "text-ink")}
                  >
                    <span className="text-muted">{a.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{a.label}</span>
                    {a.more ? <ChevronRight size={14} className="text-faint" /> : null}
                    {i === phase.active ? <CornerDownLeft size={13} className="text-faint" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="border-t border-(--color-line) px-3.5 py-1.5 text-[11px] text-faint">AI can make mistakes. Sent to Google Gemini.</p>
        </div>
      ) : (
        <p className="mt-4 px-1 text-center text-[12.5px] text-muted">
          {phase.kind === "idle" ? (
            <button
              type="button"
              onClick={() => {
                take();
                setPhase({ kind: "menu", active: 0 });
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-(--glass-hover) px-3 py-1 text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-(--glass-active)"
            >
              <AiIcon size={13} className="text-[#7c6cf0]" /> Select the text and press ⌘J
            </button>
          ) : null}
        </p>
      )}
    </div>
  );
}
