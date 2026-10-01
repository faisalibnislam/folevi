"use client";

import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, RotateCcw, X } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { CheckMark } from "../product/Replica";
import { cx } from "../ui";
import { autoplay } from "./autoplay";

/*
 * "Find action items" (the AI composer, components/ai/InlineAi.tsx), playing by itself: "/act" picks the
 * AI command, the composer reads the note, the tasks stream in as checkboxes and Insert drops them into
 * the note as real to-dos. Visitors can run it, change the result with the quick chips (each one rewrites
 * the list), try again, insert or discard. The results are canned.
 */

const VIOLET = "text-[#7c6cf0]";
const REFINES = ["Shorter", "Longer", "Simpler", "More formal", "More casual"] as const;
type Variant = "Find action items" | (typeof REFINES)[number];

const LISTS: Record<Variant, string[]> = {
  "Find action items": ["Book the library hall for the 5th", "Print seed labels by Friday", "Order glassine envelopes", "Post the new time in the group chat"],
  Shorter: ["Book the hall", "Print labels", "Order envelopes", "Post the new time"],
  Longer: ["Book the library hall for Saturday the 5th, 10 to 2", "Print the seed labels by Friday at the latest", "Order about 200 glassine envelopes", "Post the new time and place in the group chat"],
  Simpler: ["Book the hall for the 5th", "Print the labels by Friday", "Buy envelopes", "Tell the group the new time"],
  "More formal": ["Reserve the library hall for the 5th", "Arrange printing of the seed labels by Friday", "Order a supply of glassine envelopes", "Announce the revised time to the group"],
  "More casual": ["Grab the library hall for the 5th", "Get the labels printed by Friday", "Pick up more envelopes", "Drop the new time in the group chat"],
};

type Phase =
  | { kind: "idle" }
  | { kind: "typing"; text: string }
  | { kind: "reading"; label: Variant }
  | { kind: "result"; label: Variant; items: number }
  | { kind: "inserted" };

export function WriteDemo() {
  const [phase, setPhase] = useState<Phase>({ kind: "result", label: "Find action items", items: 4 });
  const [todos, setTodos] = useState<string[]>([]);
  const [ticked, setTicked] = useState(0);
  const [pressed, setPressed] = useState(false);
  const [auto, setAuto] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const runId = useRef(0);

  /** Reads the note and streams one list in, item by item. */
  const run = async (label: Variant, sleep: (ms: number) => Promise<void>) => {
    const id = ++runId.current;
    setPhase({ kind: "reading", label });
    await sleep(1100);
    for (let n = 1; n <= LISTS[label].length; n++) {
      if (id !== runId.current) return;
      setPhase({ kind: "result", label, items: n });
      await sleep(320);
    }
  };
  const insert = (label: Variant) => {
    runId.current++;
    setTodos(LISTS[label]);
    setTicked(0);
    setPhase({ kind: "inserted" });
  };

  useEffect(() => {
    if (!auto) return;
    return autoplay(root.current, async (sleep) => {
      for (;;) {
        setTodos([]);
        setTicked(0);
        setPhase({ kind: "idle" });
        await sleep(1400);
        for (const text of ["/", "/a", "/ac", "/act"]) {
          setPhase({ kind: "typing", text });
          await sleep(text === "/" ? 450 : 170);
        }
        await sleep(800);
        await run("Find action items", sleep);
        await sleep(1500);
        setPressed(true);
        await sleep(280);
        setPressed(false);
        insert("Find action items");
        await sleep(1200);
        setTicked(1);
        await sleep(900);
        setTicked(2);
        await sleep(3200);
      }
    });
  }, [auto]);

  // Clicks play at normal speed and stop the autoplay.
  const plain = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const take = () => setAuto(false);
  const label = phase.kind === "reading" || phase.kind === "result" ? phase.label : null;
  const done = phase.kind === "result" && phase.items === LISTS[phase.label].length;

  return (
    <div
      ref={root}
      onPointerDown={take}
      onKeyDown={take}
      role="group"
      aria-label="A working sample of Find action items. Run it, change the list with the quick changes, then insert it."
      className="mk-app-pop mx-auto flex h-[470px] max-w-[460px] flex-col overflow-hidden rounded-[16px] text-[13.5px]"
    >
      <div className="px-5 pt-5">
        <p className="mk-display text-[21px] text-(--color-heading)">Thursday call</p>
        <p className="mt-2 leading-relaxed text-ink" style={{ fontFamily: "var(--font-serif)" }}>
          The swap moves to the library hall on the 5th, so someone needs to book it. Labels have to be printed by Friday,
          we’re out of glassine envelopes, and the group chat still has the old time.
        </p>
        <ul className="mt-2.5 space-y-1.5">
          {todos.map((t, i) => (
            <li key={t} className="mk-appear flex items-center gap-2.5">
              <button type="button" aria-label={`${t}, ${i < ticked ? "done" : "not done"}`} onClick={() => setTicked((n) => (i < n ? i : i + 1))} className="mk-check" data-checked={i < ticked ? "true" : undefined}>
                {i < ticked ? <CheckMark /> : null}
              </button>
              <span className={cx(i < ticked && "text-faint line-through")}>{t}</span>
            </li>
          ))}
        </ul>
        {phase.kind === "idle" || phase.kind === "typing" || phase.kind === "inserted" ? (
          <div className="mt-2 flex h-7 items-center">
            {phase.kind === "typing" ? (
              <span>
                {phase.text}
                <span className="mx-px inline-block h-[16px] w-px translate-y-[3px] animate-pulse bg-(--color-heading)" />
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  take();
                  setTodos([]);
                  setTicked(0);
                  void run("Find action items", plain);
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-(--glass-hover) px-3 py-1 text-[12.5px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-(--glass-active) hover:text-(--color-heading)"
              >
                <AiIcon size={13} className={VIOLET} /> {phase.kind === "inserted" ? "Run Find action items again" : "Find action items"}
              </button>
            )}
          </div>
        ) : null}
        {phase.kind === "typing" && phase.text === "/act" ? (
          <p className="mk-app-pop mk-appear mt-1 flex w-fit items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-[13px] text-(--color-heading)">
            <AiIcon size={14} className={VIOLET} /> AI · Find action items
            <CornerDownLeft size={12} className="text-faint" />
          </p>
        ) : null}
      </div>

      {label ? (
        <div className="mk-app-pop mk-appear mx-3 mb-3 mt-3 overflow-hidden rounded-[14px]">
          <div className="border-b border-(--color-line) px-4 pb-3 pt-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
              <AiIcon size={12} className={cx(VIOLET, phase.kind === "reading" && "animate-pulse")} />
              {label}
              {phase.kind === "reading" ? "…" : ""}
            </p>
            {phase.kind === "reading" ? (
              <div className="space-y-2 pb-1">
                {[92, 78, 85].map((w) => (
                  <div key={w} className="h-2.5 animate-pulse rounded-full bg-[linear-gradient(90deg,color-mix(in_oklab,#8b7cf6_22%,transparent),color-mix(in_oklab,#f58ab8_18%,transparent))]" style={{ width: `${w}%` }} />
                ))}
              </div>
            ) : (
              <ul className="space-y-1.5 text-[13.5px] text-ink">
                {LISTS[label].slice(0, phase.kind === "result" ? phase.items : 0).map((item) => (
                  <li key={item} className="mk-appear flex items-center gap-2.5">
                    <span className="mk-check" />
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-2 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <button
                type="button"
                disabled={!done}
                onClick={() => {
                  take();
                  insert(label);
                }}
                className={cx("mk-btn mk-btn-primary h-8 gap-1.5 px-3 transition-transform disabled:opacity-50", pressed && "scale-95")}
              >
                <CornerDownLeft size={14} aria-hidden="true" /> Insert
              </button>
              <button
                type="button"
                onClick={() => {
                  take();
                  void run(label, plain);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-ink hover:bg-(--glass-hover)"
              >
                <RotateCcw size={13} aria-hidden="true" /> Try again
              </button>
              <button
                type="button"
                onClick={() => {
                  take();
                  runId.current++;
                  setPhase({ kind: "idle" });
                }}
                className="ml-auto inline-flex h-8 items-center gap-1 rounded-[8px] px-2.5 text-muted hover:bg-(--glass-hover)"
              >
                <X size={13} aria-hidden="true" /> Discard
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick changes">
              {REFINES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    take();
                    void run(r, plain);
                  }}
                  className={cx(
                    "rounded-full px-2.5 py-1 text-[12px] shadow-[inset_0_0_0_1px_var(--glass-border)] transition-colors hover:bg-(--glass-active) hover:text-(--color-heading)",
                    label === r ? "bg-(--glass-active) text-(--color-heading)" : "bg-(--glass-hover) text-ink",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <p className="border-t border-(--color-line) px-3.5 py-1.5 text-[11px] text-faint">AI can make mistakes. Sent to Google Gemini.</p>
        </div>
      ) : null}
    </div>
  );
}
