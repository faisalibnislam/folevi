"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../icons";
import { MiniBullet, MiniCallout, MiniPageCard, MiniTodo, StatusPill } from "../mini";
import { cx } from "../ui";
import { useReducedMotion } from "../useMotionPreference";

const CAPTURED =
  "seed library in the old phone box on Alder St? Ines has spare shelves. swap day first sat in April — need labels, envelopes, a sign-up sheet";

const STAGES = [
  { key: "capture", number: "01", label: "Capture", caption: "A loose thought, typed as it arrives." },
  { key: "outline", number: "02", label: "Outline", caption: "The same thought, given headings and a checklist." },
  { key: "page", number: "03", label: "Page", caption: "A finished page with a cover, dated tasks and a sub-page." },
] as const;

const HOLD_MS = [2600, 5200, 5600] as const;

function typingDelay(ch: string): number {
  if (ch === "," || ch === "." || ch === "?" || ch === "—") return 180;
  if (ch === " ") return 42;
  return 30;
}

const TYPING_MS = Array.from(CAPTURED).reduce((sum, ch) => sum + typingDelay(ch), 0);

function durationFor(stage: number): number {
  return stage === 0 ? TYPING_MS + HOLD_MS[0] : HOLD_MS[stage as 1 | 2];
}

export function FolioStack() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(0);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const remaining = useRef(durationFor(0));
  const startedAt = useRef(0);

  const running = !reduced && !hoverPaused && !userPaused;

  const goTo = useCallback((index: number) => {
    if (index === 0) setTyped(0);
    setActive(index);
  }, []);

  // Reset the remaining time whenever a new stage becomes active (runs after the timer cleanup).
  useEffect(() => {
    remaining.current = durationFor(active);
  }, [active]);

  // Auto-advance. Pausing keeps the elapsed time so the progress line and timer stay in sync.
  useEffect(() => {
    if (!running) return;
    startedAt.current = performance.now();
    const timer = window.setTimeout(() => goTo((active + 1) % STAGES.length), Math.max(0, remaining.current));
    return () => {
      window.clearTimeout(timer);
      remaining.current -= performance.now() - startedAt.current;
    };
  }, [active, running, goTo]);

  // Typing effect on the capture leaf (skipped entirely under reduced motion — CSS shows the full text).
  useEffect(() => {
    if (reduced || active !== 0) return;
    let index = 0;
    let timer = 0;
    const chars = Array.from(CAPTURED);
    const step = () => {
      index += 1;
      setTyped(index);
      if (index < chars.length) timer = window.setTimeout(step, typingDelay(chars[index - 1] ?? ""));
    };
    timer = window.setTimeout(step, 420);
    return () => window.clearTimeout(timer);
  }, [active, reduced]);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % STAGES.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + STAGES.length) % STAGES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = STAGES.length - 1;
    if (next < 0) return;
    event.preventDefault();
    goTo(next);
    tabRefs.current[next]?.focus();
  };

  const typingDone = reduced || typed >= Array.from(CAPTURED).length;

  return (
    <figure
      className="relative"
      aria-label="Folevi turns a loose thought into an outline, then a finished page"
      onPointerEnter={() => setHoverPaused(true)}
      onPointerLeave={() => setHoverPaused(false)}
      onFocus={() => setHoverPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHoverPaused(false);
      }}
    >
      <div className="relative h-[468px] sm:h-[488px]">
        {STAGES.map((stage, index) => {
          const depth = (index - active + STAGES.length) % STAGES.length;
          const isActive = depth === 0;
          return (
            <div
              key={stage.key}
              id={`${baseId}-panel-${index}`}
              role="tabpanel"
              aria-labelledby={`${baseId}-tab-${index}`}
              aria-hidden={!isActive}
              inert={!isActive}
              data-depth={depth}
              data-settle="true"
              className="mk-leaf"
              style={{ zIndex: STAGES.length - depth, ["--d" as string]: depth }}
            >
              <div className="mk-leaf-body flex h-full flex-col">
                {index === 0 ? <CaptureLeaf typed={typed} done={typingDone} /> : null}
                {index === 1 ? <OutlineLeaf /> : null}
                {index === 2 ? <PageLeaf /> : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex items-stretch gap-2 pr-8">
        <div role="tablist" aria-label="Stages of a page" className="grid flex-1 grid-cols-3 gap-2">
          {STAGES.map((stage, index) => {
            const selected = index === active;
            return (
              <button
                key={stage.key}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                id={`${baseId}-tab-${index}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${index}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => goTo(index)}
                onKeyDown={(event) => onTabKey(event, index)}
                className={cx(
                  "group relative flex min-h-11 flex-col items-start justify-center rounded-control px-2 pb-2 pt-1.5 text-left transition-colors duration-150",
                  selected ? "text-ink" : "text-muted hover:text-ink",
                )}
              >
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] tracking-wide text-faint">{stage.number}</span>
                  <span className="text-[14px] font-medium">{stage.label}</span>
                </span>
                <span aria-hidden="true" className="absolute inset-x-2 bottom-1 h-px overflow-hidden bg-line">
                  {selected ? (
                    reduced ? (
                      <span className="absolute inset-0 bg-ink" />
                    ) : (
                      <span
                        key={active}
                        className="mk-progress absolute inset-0 bg-ink"
                        data-running="true"
                        data-paused={!running}
                        style={{ animationDuration: `${durationFor(index)}ms` }}
                      />
                    )
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        {!reduced ? (
          <button
            type="button"
            onClick={() => setUserPaused((value) => !value)}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
            aria-label={userPaused ? "Play the stage sequence" : "Pause the stage sequence"}
          >
            <Icon name={userPaused ? "play" : "pause"} size={16} />
          </button>
        ) : null}
      </div>
      <figcaption className="sr-only" aria-live="polite">
        {`Stage ${active + 1} of 3, ${STAGES[active]?.label}: ${STAGES[active]?.caption}`}
      </figcaption>
    </figure>
  );
}

function LeafBar({ crumbs, children }: { crumbs: string[]; children: React.ReactNode }) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b mk-hair px-4">
      <p className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-muted">
        {crumbs.map((crumb, index) => (
          <span key={crumb} className={cx("truncate", index === crumbs.length - 1 && "text-ink")}>
            {index > 0 ? <span className="mr-1.5 text-faint">/</span> : null}
            {crumb}
          </span>
        ))}
      </p>
      {children}
    </div>
  );
}

function CaptureLeaf({ typed, done }: { typed: number; done: boolean }) {
  const visible = Array.from(CAPTURED).slice(0, typed).join("");
  return (
    <>
      <LeafBar crumbs={["Unsorted", "Quick note"]}>
        <StatusPill status={done ? "Saved" : "Saving"} />
      </LeafBar>
      <div
        className="relative h-[216px] shrink-0 px-5 pt-[12px]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, transparent 0, transparent 29px, color-mix(in oklab, var(--color-accent) 9%, transparent) 29px, color-mix(in oklab, var(--color-accent) 9%, transparent) 30px)",
          backgroundPosition: "0 12px",
        }}
      >
        <span aria-hidden="true" className="absolute inset-y-0 left-[38px] w-px bg-coral/30" />
        <p className="pl-7 text-[12px] leading-[30px] text-faint">Just now</p>
        <p className="pl-7 font-sans text-[15.5px] leading-[30px] text-ink">
          <span className="sr-only">{CAPTURED}</span>
          <span aria-hidden="true" className="mk-typed-live">
            {visible}
            <span className="mk-caret" />
          </span>
          <span aria-hidden="true" className="mk-typed-full">
            {CAPTURED}
          </span>
        </p>
      </div>
      <div className="flex-1 border-t mk-hair bg-surface px-5 pt-3.5">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Earlier in Unsorted</p>
        <ul className="mt-2 space-y-1.5">
          {[
            { text: "Printer on Alder St can do small runs on Fridays", when: "Yesterday" },
            { text: "The Overstory, p. 112 — the part about seed banks", when: "Tue" },
            { text: "Ask Ines what the shelves are made of", when: "Mon" },
          ].map((note) => (
            <li key={note.text} className="flex items-center gap-3 rounded-[7px] border mk-hair bg-raised px-3 py-2 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate text-ink">{note.text}</span>
              <span className="shrink-0 text-[11px] text-faint">{note.when}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function OutlineLeaf() {
  return (
    <>
      <LeafBar crumbs={["Pages", "Seed library"]}>
        <StatusPill status="Saved" />
      </LeafBar>
      <div className="flex-1 space-y-2.5 px-5 pt-5">
        <p className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink">Seed library</p>
        <p className="pt-1 text-[13.5px] font-semibold text-ink">Where</p>
        <div className="space-y-1">
          <MiniBullet>Old phone box on Alder Street</MiniBullet>
          <MiniBullet>Spare shelves from Ines</MiniBullet>
          <MiniBullet depth={1}>Measure the door first</MiniBullet>
        </div>
        <p className="pt-1.5 text-[13.5px] font-semibold text-ink">Before swap day</p>
        <div className="space-y-0.5">
          <MiniTodo text="Draft the sign-up sheet" checked />
          <MiniTodo text="Print seed labels" />
          <MiniTodo text="Buy glassine envelopes" />
        </div>
        <div className="flex items-center gap-2 pt-1 text-[13px] text-faint">
          <Icon name="grip" size={14} />
          <span>
            Type <span className="mk-kbd">/</span> for blocks
          </span>
        </div>
      </div>
    </>
  );
}

function PageLeaf() {
  return (
    <>
      <LeafBar crumbs={["Pages", "Seed library"]}>
        <span className="flex items-center gap-3">
          <span className="hidden items-center gap-1 text-[11.5px] text-muted sm:inline-flex">
            <Icon name="lock" size={12} /> Private
          </span>
          <StatusPill status="Saved" />
        </span>
      </LeafBar>
      <div aria-hidden="true" className="relative h-[58px] shrink-0 overflow-hidden bg-moss-soft">
        <svg className="absolute inset-0 h-full w-full text-moss" viewBox="0 0 400 58" preserveAspectRatio="none" fill="none">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <path
              key={i}
              d={`M0 ${-4 + i * 11} C 90 ${-14 + i * 12}, 170 ${16 + i * 9}, 250 ${2 + i * 11} S 350 ${-10 + i * 12}, 400 ${4 + i * 10}`}
              stroke="currentColor"
              strokeOpacity={0.4}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
      <div className="relative flex-1 px-5">
        <span aria-hidden="true" className="-mt-5 flex size-10 items-center justify-center rounded-[9px] border mk-hair bg-raised text-[20px] shadow-sm">
          🌱
        </span>
        <p className="mt-2 font-display text-[28px] leading-none tracking-[-0.01em] text-ink">Seed library</p>
        <p className="mt-1.5 text-[11.5px] text-muted">Updated just now · 3 open tasks</p>
        <div className="mt-3">
          <MiniCallout icon="📅" tone="moss">
            <span className="font-medium">Swap day</span> — Saturday 4 April, 10:00 at the phone box
          </MiniCallout>
        </div>
        <div className="mt-2.5 space-y-0.5">
          <MiniTodo text="Draft the sign-up sheet" checked />
          <MiniTodo text="Print seed labels" date="Mar 28" tone="accent" />
          <MiniTodo text="Buy glassine envelopes" date="Mar 30" />
          <MiniTodo text="Confirm shelves with Ines" date="Apr 1" high />
        </div>
        <div className="mt-3">
          <MiniPageCard icon="🗓️" title="Planting calendar" meta="Sub-page · 14 blocks" />
        </div>
      </div>
    </>
  );
}
