"use client";

import { useEffect, useState } from "react";
import { cx } from "../ui";

/*
 * The apps at work, as they really look: frames captured from the real web app (apps/web/e2e/showcase-capture.spec.ts,
 * with macOS's traffic lights in place of the web logo, as Folevi for Mac shows them) and from the real iPhone app,
 * all one demo workspace ("Studio"). Each chapter steps through its frames, cross-fading, then moves on; it
 * pauses while the pointer or focus is on it, and the tabs underneath jump to a chapter. With reduced motion each
 * chapter shows its last frame and nothing moves by itself. The scene is one picture to assistive tech.
 */

type ChapterId = "write" | "together" | "tasks" | "board" | "ai" | "vault";
/** Each chapter's Mac frames, and the iPhone frame shown at each of those steps. */
const CHAPTERS: Array<{ id: ChapterId; label: string; frames: string[]; phone: string[]; says: string }> = [
  { id: "write", label: "Write with /", frames: ["write-1", "write-2", "write-3"], phone: ["write-1", "write-1", "write-1"], says: "A page called Spring launch: the / menu adds a table of who does what." },
  { id: "together", label: "Write together", frames: ["together-1", "together-2", "together-3", "together-4"], phone: ["write-1", "together-1", "together-1", "together-2"], says: "Sam edits the same page live, Maya leaves a comment for him, he replies and the thread is resolved." },
  { id: "tasks", label: "Tasks and calendar", frames: ["tasks-1", "tasks-2", "tasks-3"], phone: ["tasks-1", "tasks-1", "tasks-2"], says: "This week's tasks with their dates, one ticked off, then the same tasks on the calendar." },
  { id: "board", label: "Databases", frames: ["board-1", "board-2"], phone: ["board-2", "board-1"], says: "The Content plan collection as a table, then as a board grouped by status." },
  { id: "ai", label: "Foli AI", frames: ["ai-1", "ai-2"], phone: ["ai-1", "ai-2"], says: "Foli AI is asked what's left before the launch and answers with sources from the workspace." },
  { id: "vault", label: "Vault", frames: ["vault-1", "vault-2"], phone: ["vault-1", "vault-1"], says: "The Vault opens with a passcode and shows passwords, an API key and a 2FA code." },
];
const STEP_MS = 2200;
const WEB = (f: string) => `/marketing/showcase/web/${f}.webp`;
const PHONE = (f: string) => `/marketing/showcase/iphone/${f}.webp`;

export function DeviceShowcase() {
  const [chapter, setChapter] = useState(0);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setStill(reduce.matches);
    apply();
    reduce.addEventListener("change", apply);
    return () => reduce.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const last = CHAPTERS[chapter]!.frames.length - 1;
    if (still) {
      setStep(last);
      return;
    }
    if (paused) return;
    const t = window.setTimeout(
      () => {
        if (step < last) setStep(step + 1);
        else {
          setChapter((chapter + 1) % CHAPTERS.length);
          setStep(0);
        }
      },
      step === last ? STEP_MS * 1.6 : STEP_MS,
    );
    return () => window.clearTimeout(t);
  }, [chapter, step, paused, still]);

  const go = (i: number) => {
    setChapter(i);
    setStep(still ? CHAPTERS[i]!.frames.length - 1 : 0);
  };
  const c = CHAPTERS[chapter]!;
  const next = CHAPTERS[(chapter + 1) % CHAPTERS.length]!;

  return (
    <div onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div role="img" aria-label={`Folevi on a Mac and an iPhone. ${c.says}`} className="relative mx-auto w-full max-w-[1060px] pb-[6%] pr-[9%]">
        <div aria-hidden="true">
          {/* The Mac window: the captured app, 16:10, with the window's corners and shadow. */}
          <div className="mk-mac-window relative aspect-[16/10] w-full overflow-hidden bg-(--color-surface-sunken)">
            {c.frames.map((f, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- captured frames, already sized; cross-faded by opacity
              <img
                key={f}
                src={WEB(f)}
                alt=""
                width={2560}
                height={1600}
                decoding="async"
                fetchPriority={chapter === 0 && i === 0 ? "high" : "auto"}
                className={cx("absolute inset-0 size-full object-cover transition-opacity duration-700 ease-out", i === step ? "opacity-100" : "opacity-0")}
              />
            ))}
            {/* The next chapter's first frame, loaded ahead so it's there when the chapter changes. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- preloaded frame, never shown */}
            <img src={WEB(next.frames[0]!)} alt="" width={2560} height={1600} decoding="async" className="pointer-events-none absolute size-px opacity-0" />
          </div>
          {/* The iPhone: the captured screen in a minimal frame, in front of the window's lower right corner. */}
          <div className="mk-phone absolute bottom-0 right-0 w-[24%] bg-[#111113] p-[0.6%] shadow-[0_30px_60px_-18px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.08)_inset]">
            <div className="mk-phone-screen relative aspect-[1206/2622] overflow-hidden bg-(--color-surface)">
              {[...new Set(c.phone)].map((f) => (
                // eslint-disable-next-line @next/next/no-img-element -- captured frames, already sized; cross-faded by opacity
                <img
                  key={f}
                  src={PHONE(f)}
                  alt=""
                  width={1206}
                  height={2622}
                  decoding="async"
                  className={cx("absolute inset-0 size-full object-cover transition-opacity duration-700 ease-out", f === c.phone[step] ? "opacity-100" : "opacity-0")}
                />
              ))}
              <span className="absolute left-1/2 top-[1.6%] h-[3.6%] w-[31%] -translate-x-1/2 rounded-chip bg-black" />
            </div>
          </div>
        </div>
      </div>
      <div role="tablist" aria-label="What the apps can do" className="mx-auto mt-6 flex max-w-full flex-wrap justify-center gap-1.5">
        {CHAPTERS.map((ch, i) => (
          <button
            key={ch.id}
            type="button"
            role="tab"
            aria-selected={i === chapter}
            onClick={() => go(i)}
            className={cx(
              "relative overflow-hidden rounded-chip px-3.5 py-2 text-[13px] font-medium transition-colors",
              i === chapter ? "bg-(--color-heading) text-(--color-canvas)" : "bg-(--color-surface-sunken) text-muted hover:bg-(--glass-hover) hover:text-(--color-heading)",
            )}
          >
            {ch.label}
            {i === chapter && !still ? (
              <span aria-hidden="true" className="absolute bottom-0 left-0 h-0.5 bg-(--color-canvas) opacity-60 transition-[width] duration-500" style={{ width: `${((step + 1) / c.frames.length) * 100}%` }} />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
