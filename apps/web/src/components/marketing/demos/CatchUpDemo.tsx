"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, RotateCcw, X } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { autoplay } from "./autoplay";

/*
 * Catch me up on Home (components/ai/CatchUp.tsx), playing by itself: the button is pressed, Folevi
 * reads the week's notes, the brief streams in line by line and the notes it used appear. Visitors can
 * press it, refresh it or close it. The brief is canned.
 */

const LINES: Array<{ kind: "h" | "li"; text: string }> = [
  { kind: "h", text: "This week" },
  { kind: "li", text: "Swap day moved to the library hall [1]." },
  { kind: "li", text: "The coast trip is booked for the 18th [2]." },
  { kind: "h", text: "Up next" },
  { kind: "li", text: "Print seed labels, due Friday [1]" },
  { kind: "li", text: "Book the ferry, due Monday [3]" },
];
const SOURCES = ["Seed library", "Trip sketch", "Travel list"];

type Phase = { kind: "button" } | { kind: "reading" } | { kind: "writing"; lines: number; chars: number } | { kind: "done" };

export function CatchUpDemo() {
  const [phase, setPhase] = useState<Phase>({ kind: "done" });
  const [pressed, setPressed] = useState(false);
  const [auto, setAuto] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const runId = useRef(0);

  const brief = async (sleep: (ms: number) => Promise<void>) => {
    const id = ++runId.current;
    setPhase({ kind: "reading" });
    await sleep(1300);
    for (let l = 0; l < LINES.length; l++) {
      const line = LINES[l]!;
      for (let c = 0; c <= line.text.length; c += 3) {
        if (id !== runId.current) return;
        setPhase({ kind: "writing", lines: l, chars: c });
        await sleep(22);
      }
    }
    if (id === runId.current) setPhase({ kind: "done" });
  };

  useEffect(() => {
    if (!auto) return;
    return autoplay(root.current, async (sleep) => {
      for (;;) {
        setPhase({ kind: "button" });
        await sleep(1600);
        setPressed(true);
        await sleep(220);
        setPressed(false);
        await brief(sleep);
        await sleep(4200);
      }
    });
  }, [auto]);

  const plain = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const take = () => setAuto(false);

  return (
    <div ref={root} onPointerDown={take} onKeyDown={take} role="group" aria-label="A working sample of Catch me up. Press it for a brief of the sample week." className="mx-auto flex min-h-[330px] w-full max-w-[420px] flex-col justify-center">
      {phase.kind === "button" ? (
        <div className="mk-appear flex flex-col items-start gap-2.5">
          <button
            type="button"
            onClick={() => {
              take();
              void brief(plain);
            }}
            className={`inline-flex h-10 items-center gap-2 rounded-control bg-(--glass-active) px-4 text-[13.5px] font-semibold text-(--color-heading) shadow-[var(--glass-edge),0_1px_3px_rgb(0_0_0/0.06)] transition-transform hover:-translate-y-px ${pressed ? "scale-95" : ""}`}
          >
            <AiIcon size={15} /> Catch me up
          </button>
          <span className="text-[12.5px] text-muted">A quick AI brief of this week’s notes and what’s due.</span>
        </div>
      ) : (
        <div className="mk-app-pop mk-appear rounded-container p-5 text-[13px] leading-relaxed text-ink">
          <div className="mb-2 flex items-center gap-2">
            <AiIcon size={15} className={phase.kind === "reading" ? "animate-pulse text-[#7c6cf0]" : "text-[#7c6cf0]"} />
            <p className="mk-display flex-1 text-[18px]">Your week</p>
            <button
              type="button"
              aria-label="Refresh brief"
              onClick={() => {
                take();
                void brief(plain);
              }}
              className="grid size-8 place-items-center rounded-chip text-muted hover:bg-(--glass-hover) hover:text-(--color-heading)"
            >
              <RotateCcw size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Close brief"
              onClick={() => {
                take();
                runId.current++;
                setPhase({ kind: "button" });
              }}
              className="grid size-8 place-items-center rounded-chip text-muted hover:bg-(--glass-hover) hover:text-(--color-heading)"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
          {phase.kind === "reading" ? (
            <div className="space-y-2.5 py-1">
              <p className="text-[13px] text-muted">Reading this week’s notes…</p>
              {[90, 75, 82, 60].map((w) => (
                <div key={w} className="h-3 animate-pulse rounded-chip bg-[linear-gradient(90deg,color-mix(in_oklab,#8b7cf6_20%,transparent),color-mix(in_oklab,#f58ab8_16%,transparent))]" style={{ width: `${w}%` }} />
              ))}
            </div>
          ) : (
            <Brief upTo={phase.kind === "writing" ? phase : null} />
          )}
          {phase.kind === "done" ? (
            <div className="mk-appear mt-3 flex flex-wrap gap-1.5">
              {SOURCES.map((title, n) => (
                <span key={title} className="inline-flex items-center gap-1.5 rounded-chip bg-(--glass-hover) px-2.5 py-1 text-[12px] text-ink">
                  <span className="font-semibold text-muted">{n + 1}</span>
                  <FileText size={12} aria-hidden="true" className="text-muted" />
                  {title}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** The brief so far: whole lines up to `upTo.lines`, and part of that line (everything when null). */
function Brief({ upTo }: { upTo: { lines: number; chars: number } | null }) {
  const out = [];
  let list: { key: number; text: string }[] = [];
  const flush = (key: number) => {
    if (list.length) out.push(<ul key={`ul${key}`} className="mt-1 list-disc space-y-0.5 pl-5">{list.map((l) => <li key={l.key}>{l.text}</li>)}</ul>);
    list = [];
  };
  for (const [i, line] of LINES.entries()) {
    if (upTo && i > upTo.lines) break;
    const text = upTo && i === upTo.lines ? line.text.slice(0, upTo.chars) : line.text;
    if (line.kind === "h") {
      flush(i);
      out.push(
        <p key={i} className={`font-semibold text-(--color-heading) ${i ? "mt-2.5" : "mt-1"}`}>
          {text}
        </p>,
      );
    } else list.push({ key: i, text });
  }
  flush(LINES.length);
  return <>{out}</>;
}
