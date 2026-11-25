"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays } from "@folevi/editor-schema";
import { formatCalendarDate } from "@/i18n";
import { feel } from "@/lib/native/ui";
import { monthGrid, shiftMonth, startOfWeek } from "@/components/views/calendarLayout";

/** One row of days: the date's circle (34) and the dot under it, in a 48 pt tall cell. */
const ROW_H = 48;
/** Weeks either side of today the strip pages through (two years back, two ahead). */
const WEEKS_BACK = 104;
const WEEKS_AHEAD = 104;
/** Months either side of today the pulled-down month pages through. */
const MONTHS_EACH_WAY = 24;
/** iOS's sheet-like settle (docs/IOS_POLISH_PLAN.md 2.4): no overshoot, quick to start, soft to land. */
const SETTLE_MS = 320;
const SETTLE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const SETTLE = `${SETTLE_MS}ms ${SETTLE_EASE}`;

const reduceMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Whole days between two YYYY-MM-DD dates. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** The month grid's weeks that hold at least one day of the month (four to six rows). */
function monthRows(month: string): string[][] {
  const days = monthGrid(month);
  const rows: string[][] = [];
  for (let i = 0; i < 6; i++) {
    const row = days.slice(i * 7, i * 7 + 7);
    if (row.some((d) => d.startsWith(month))) rows.push(row);
  }
  return rows;
}

/**
 * The Calendar's week strip on the iPhone (owner's decision D4): the seven days of the week under the large
 * title, today filled, a dot under each day that has tasks or events. Swipe sideways for other weeks (the
 * same weekday stays picked); pull it down, or tap its grabber, for the whole month, which pages sideways
 * by month and folds back up when a day is picked or it's pushed up again. The drag follows the finger and
 * settles with the release's speed; Reduce Motion opens and closes it at once, with a quick fade.
 *
 * Opening and closing only transform (docs/IOS_PERFORMANCE.md): while the month moves, the strip keeps the
 * week's height in the layout, the month is drawn over what's below and uncovered by a sliding mask (a box
 * moving down with its contents moving up as much), and the grabber and the screen's content after the strip
 * slide down by as much as the month shows. Only once it's open and at rest does the layout take the month's
 * height (one reflow, the content's slide handed over to it on the same frame).
 */
export function WeekStrip({ today, selected, onSelect, marked }: { today: string; selected: string; onSelect: (date: string) => void; marked: (date: string) => boolean }) {
  const [open, setOpen] = useState(false);
  // 0 (the week) to 1 (the month) while a finger pulls it; null when at rest.
  const [pull, setPull] = useState<number | null>(null);
  const [animating, setAnimating] = useState(false);
  const month = selected.slice(0, 7);
  const rows = useMemo(() => monthRows(month), [month]);
  const selRow = Math.max(0, rows.findIndex((r) => r.includes(selected)));
  const progress = pull ?? (open ? 1 : 0);
  const fullH = rows.length * ROW_H;
  // How much of the month shows, and how tall the strip is in the layout (the week's height while it moves).
  const visible = ROW_H + (fullH - ROW_H) * progress;
  const atRest = pull === null && !animating;
  const layoutH = open && atRest ? fullH : ROW_H;
  const showMonth = open || pull !== null || animating;

  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => formatCalendarDate(addDays("2024-01-01", i), { weekday: "narrow" })), []);
  const weekdayNames = useMemo(() => Array.from({ length: 7 }, (_, i) => formatCalendarDate(addDays("2024-01-01", i), { weekday: "long" })), []);

  const fadeIn = useRef(false);
  const settle = useCallback((next: boolean) => {
    setPull(null);
    if (!reduceMotion()) {
      setAnimating(true);
      window.setTimeout(() => setAnimating(false), SETTLE_MS + 10);
    } else fadeIn.current = true;
    setOpen(next);
  }, []);

  const pick = (date: string) => {
    if (date !== selected) feel("choose");
    onSelect(date);
    if (open) settle(false);
  };

  const area = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const weekRef = useRef<HTMLDivElement>(null);
  const monthRef = useRef<HTMLDivElement>(null);

  // What comes after the month (the grabber, then the screen's content after the strip) slides down by as much
  // of the month as shows beyond the layout's height: with the finger 1:1, on the settle curve otherwise. Only
  // what's on screen (or about to be) moves; what moved is put back once the layout holds the month.
  const shown = useRef(visible);
  const moved = useRef(new Set<HTMLElement>());
  const slides = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const from = shown.current - layoutH;
    const to = visible - layoutH;
    shown.current = visible;
    for (const a of slides.current) a.cancel();
    slides.current = [];
    const els = new Set(moved.current);
    if (band.current) els.add(band.current);
    if (to !== 0 || from !== 0) {
      const reach = window.innerHeight + fullH;
      for (let el = area.current?.parentElement?.nextElementSibling ?? null; el; el = el.nextElementSibling) {
        if (!(el instanceof HTMLElement)) continue;
        if (el.getBoundingClientRect().top > reach) break;
        els.add(el);
      }
    }
    const glide = pull === null && !reduceMotion() && Math.abs(from - to) > 0.5;
    for (const el of els) {
      el.style.transform = to ? `translateY(${to}px)` : "";
      if (glide && typeof el.animate === "function") slides.current.push(el.animate([{ transform: `translateY(${from}px)` }, { transform: `translateY(${to}px)` }], { duration: SETTLE_MS, easing: SETTLE_EASE }));
    }
    moved.current = to ? els : new Set();
  }, [visible, layoutH, pull, fullH]);

  // Reduce Motion: no movement, the month (or the week) fades in where it is.
  useLayoutEffect(() => {
    if (!fadeIn.current) return;
    fadeIn.current = false;
    const el = open ? monthRef.current : weekRef.current;
    if (el && typeof el.animate === "function") el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
  }, [open]);

  // The pull: a vertical drag anywhere on the strip (sideways drags page it, natively).
  const openRef = useRef(open);
  openRef.current = open;
  const travel = useRef(fullH - ROW_H);
  travel.current = Math.max(1, fullH - ROW_H);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    let start: { x: number; y: number; t: number; from: number } | null = null;
    let mode: "y" | "x" | null = null;
    let last = { y: 0, t: 0, v: 0 };
    let p = 0;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1) return;
      start = { x: t.clientX, y: t.clientY, t: e.timeStamp, from: openRef.current ? 1 : 0 };
      mode = null;
      last = { y: t.clientY, t: e.timeStamp, v: 0 };
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        mode = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
      }
      if (mode !== "y") return;
      if (e.cancelable) e.preventDefault();
      const dt = Math.max(1, e.timeStamp - last.t);
      last = { y: t.clientY, t: e.timeStamp, v: (t.clientY - last.y) / dt };
      // 1:1 with the finger, rubber-banding past either end.
      let next = start.from + dy / travel.current;
      if (next > 1) next = 1 + (1 - 1 / ((next - 1) * 0.55 + 1)) * 0.25;
      if (next < 0) next = -(1 - 1 / (-next * 0.55 + 1)) * 0.15;
      p = next;
      setPull(next);
    };
    const onEnd = () => {
      if (!start || mode !== "y") {
        start = null;
        return;
      }
      start = null;
      // Where it lands: its place plus where the release's speed would carry it in 0.2 s.
      const projected = p + (last.v * 200) / travel.current;
      const next = projected > 0.5;
      if (next !== openRef.current) feel("choose");
      settle(next);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [settle]);

  const day = (date: string, inMonth: boolean, fade: number) => {
    const isToday = date === today;
    const isSelected = date === selected;
    const has = marked(date);
    const name = `${isToday ? "Today, " : ""}${formatCalendarDate(date, { weekday: "long", month: "long", day: "numeric" })}${has ? ", has tasks or events" : ""}`;
    return (
      <button
        key={date}
        type="button"
        data-date={date}
        aria-label={name}
        aria-pressed={isSelected}
        aria-current={isToday ? "date" : undefined}
        onClick={() => pick(date)}
        className="group flex h-12 min-w-0 flex-1 flex-col items-center pt-0.5 outline-none"
      >
        <span
          className={`grid h-[34px] w-[34px] place-items-center rounded-capsule text-body leading-none tabular-nums transition-[background-color,color,transform] duration-200 group-active:scale-[0.96] group-focus-visible:ring-2 group-focus-visible:ring-focus motion-reduce:transition-none ${
            isSelected ? "bg-heading font-semibold text-canvas" : isToday ? "bg-[color-mix(in_oklab,var(--color-ink)_9%,transparent)] font-semibold text-heading" : "text-ink"
          }`}
          style={!inMonth && !isSelected ? { opacity: 1 - 0.6 * fade } : undefined}
        >
          {Number(date.slice(8))}
        </span>
        <span aria-hidden className={`mt-1.5 h-[5px] w-[5px] rounded-capsule bg-[color-mix(in_oklab,var(--color-ink)_38%,transparent)] ${has ? "" : "invisible"}`} style={!inMonth ? { opacity: 1 - 0.6 * fade } : undefined} />
      </button>
    );
  };

  return (
    <div ref={area} data-week-strip="" className="touch-pan-x select-none px-2.5 pt-1.5">
      <div aria-hidden className="flex">
        {weekdays.map((w, i) => (
          <span key={i} className={`flex-1 text-center text-footnote font-semibold leading-[18px] ${i >= 5 ? "text-faint" : "text-muted"}`} title={weekdayNames[i]}>
            {w}
          </span>
        ))}
      </div>
      <div data-week-strip-days="" className="relative" style={{ height: layoutH }}>
        {/* The week stays mounted under the month: a touch that started on one of its days keeps being
            delivered (to a node still in the page) while the month takes its place. */}
        <div ref={weekRef} className={`absolute inset-x-0 top-0 h-12 ${showMonth ? "invisible" : ""}`} inert={showMonth || undefined}>
          <WeekPager today={today} selected={selected} onWeek={(date) => onSelect(date)} render={(d) => day(d, true, 0)} />
        </div>
        {showMonth ? (
          // The mask: the month's whole height, over what's below; its box slides down as its contents slide
          // up by as much, so the month shows down to `visible` (transforms only, on one curve).
          <div ref={monthRef} className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden" style={{ height: fullH }}>
            <div className="pointer-events-auto h-full overflow-hidden bg-canvas" style={{ transform: `translateY(${visible - fullH}px)`, transition: glideCss(pull) }}>
              <div className="h-full" style={{ transform: `translateY(${fullH - visible}px)`, transition: glideCss(pull) }}>
                <MonthPager month={month} today={today} rows={rows} selRow={selRow} progress={progress} paging={open && atRest} pull={pull} onMonth={(m) => onSelect(m === today.slice(0, 7) ? today : `${m}-01`)} render={day} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {/* The grabber: tap for the month (or back to the week); the whole strip drags too. Its band is opaque, as
          it slides over the content below while the month opens. */}
      <div ref={band} data-week-strip-band="" className="relative -mx-2.5 bg-canvas px-2.5 pb-1">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Show the week" : "Show the whole month"}
          onClick={() => {
            feel("choose");
            if (open || reduceMotion()) return settle(!open);
            // From the week as it is, so the month's other rows slide out around it.
            setPull(0);
            requestAnimationFrame(() => requestAnimationFrame(() => settle(true)));
          }}
          // 44 pt to tap (HIG): the hit area reaches down into the space under the strip, never up into the days.
          className="relative mx-auto flex h-5 w-16 items-center justify-center rounded-capsule outline-none before:absolute before:inset-x-0 before:top-0 before:-bottom-6 before:content-[''] focus-visible:ring-2 focus-visible:ring-focus"
        >
          <span aria-hidden className="h-[5px] w-9 rounded-capsule bg-[color-mix(in_oklab,var(--color-ink)_20%,transparent)]" />
        </button>
      </div>
    </div>
  );
}

/** The month's own moves: on the settle curve, or none while a finger holds it (or with Reduce Motion). */
const glideCss = (pull: number | null) => (pull === null && !reduceMotion() ? `transform ${SETTLE}` : "none");

/**
 * The weeks, paged sideways with the platform's own scrolling (snapping a page at a time). Only the pages
 * near the one in view draw their days. Paging to another week picks the same weekday there.
 */
function WeekPager({ today, selected, onWeek, render }: { today: string; selected: string; onWeek: (date: string) => void; render: (date: string) => React.ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const origin = useMemo(() => addDays(startOfWeek(today), -7 * WEEKS_BACK), [today]);
  const count = WEEKS_BACK + WEEKS_AHEAD + 1;
  const index = Math.min(count - 1, Math.max(0, Math.floor(daysBetween(origin, selected) / 7)));
  const [near, setNear] = useState(index);
  const indexRef = useRef(index);
  indexRef.current = index;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onWeekRef = useRef(onWeek);
  onWeekRef.current = onWeek;

  // The selected day's week in view: at once when it first shows, smoothly when another day moves it.
  const placed = useRef(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = index * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) < 2) return;
    el.scrollTo({ left: target, behavior: placed.current && !reduceMotion() ? "smooth" : "auto" });
    placed.current = true;
    setNear(index);
  }, [index]);
  useEffect(() => {
    placed.current = true;
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let timer = 0;
    const settled = () => {
      const page = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
      if (page === indexRef.current) return;
      const weekday = (daysBetween(origin, selectedRef.current) % 7 + 7) % 7;
      feel("choose");
      onWeekRef.current(addDays(origin, page * 7 + weekday));
    };
    const onScroll = () => {
      setNear(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
      window.clearTimeout(timer);
      timer = window.setTimeout(settled, 110);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, [origin]);

  return (
    <div ref={scroller} className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Week">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-full w-full flex-none snap-start snap-always" role="group" inert={i !== index || undefined}>
          {Math.abs(i - near) <= 2 || i === index ? Array.from({ length: 7 }, (_, d) => render(addDays(origin, i * 7 + d))) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * The whole month. While it's pulled it shows the selected day's month only, its rows sliding out from the
 * selected week (that week stays where the strip had it until the month is fully open); open and at rest it
 * pages sideways by month.
 */
function MonthPager({
  month,
  today,
  rows,
  selRow,
  progress,
  paging,
  pull,
  onMonth,
  render,
}: {
  month: string;
  today: string;
  rows: string[][];
  selRow: number;
  progress: number;
  paging: boolean;
  pull: number | null;
  onMonth: (month: string) => void;
  render: (date: string, inMonth: boolean, fade: number) => React.ReactNode;
}) {
  const p = Math.min(1, Math.max(0, progress));
  const grid = (m: string, r: string[][], offset: number, fade: number) => (
    <div style={{ transform: offset ? `translateY(${offset}px)` : undefined, transition: pull === null && !reduceMotion() ? `transform ${SETTLE}` : "none" }}>
      {r.map((row) => (
        <div key={row[0]} className="flex">
          {row.map((d) => render(d, d.startsWith(m), fade))}
        </div>
      ))}
    </div>
  );
  const scroller = useRef<HTMLDivElement>(null);
  const thisMonth = today.slice(0, 7);
  const origin = shiftMonth(thisMonth, -MONTHS_EACH_WAY);
  const count = MONTHS_EACH_WAY * 2 + 1;
  const index = Math.min(count - 1, Math.max(0, monthsBetween(origin, month)));
  const indexRef = useRef(index);
  indexRef.current = index;
  const onMonthRef = useRef(onMonth);
  onMonthRef.current = onMonth;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = index * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) > 1) el.scrollLeft = target;
  }, [index, paging]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !paging) return;
    let timer = 0;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const page = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
        if (page === indexRef.current) return;
        feel("choose");
        onMonthRef.current(shiftMonth(origin, page));
      }, 110);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, [paging, origin]);

  // One structure whether it pages or not, so what a finger is holding stays in the page while the month
  // is pulled open or pushed shut.
  return (
    <div ref={scroller} className={`flex h-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${paging ? "snap-x snap-mandatory overflow-x-auto overscroll-x-contain" : "overflow-hidden"}`} aria-label="Month">
      {Array.from({ length: count }, (_, i) => {
        const m = shiftMonth(origin, i);
        const near = paging ? Math.abs(i - index) <= 1 : i === index;
        return (
          <div key={m} className="w-full flex-none snap-start snap-always" role="group" aria-label={formatCalendarDate(`${m}-01`, { month: "long", year: "numeric" })} inert={i !== index || undefined}>
            {near ? (i === index ? grid(m, rows, paging ? 0 : -selRow * ROW_H * (1 - p), paging ? 1 : p) : grid(m, monthRows(m), 0, 1)) : null}
          </div>
        );
      })}
    </div>
  );
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number) as [number, number];
  const [by, bm] = b.split("-").map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am);
}
