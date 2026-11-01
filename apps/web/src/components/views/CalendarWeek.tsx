"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { formatCalendarDate } from "@/i18n";
import type { TaskRow } from "./TasksView";
import { calendarColor, type ExternalEvent, type PlacedEvent } from "./CalendarSubscriptions";
import { FIRST_VISIBLE_HOUR, HOUR_PX, TASK_MINUTES, layoutOverlaps, minutesToPx, minutesToTime, slotAt, timeToMinutes } from "./calendarLayout";

const TASK_TYPE = "application/x-folevi-task";

/** Minutes after local midnight, updated every minute (for the line at the current time). */
function useNowMinutes(): number {
  const read = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const [now, setNow] = useState(read);
  useEffect(() => {
    const id = window.setInterval(() => setNow(read()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** A task's block: tinted in the heading's ink with a bar of it down its edge; done ones quiet and struck through. */
function taskChipClass(t: TaskRow) {
  return t.status === "open"
    ? "border-l-[3px] border-heading bg-[color-mix(in_oklab,var(--color-heading)_9%,transparent)] text-ink"
    : "border-l-[3px] border-line-strong bg-sunken text-faint line-through";
}

/** An event's block: its calendar's colour as a tint and a bar down its edge. */
function eventStyle(color: string): CSSProperties {
  const c = calendarColor(color);
  return { borderColor: c, background: `color-mix(in oklab, ${c} 16%, transparent)` };
}

/** "9 AM", or "21" where the clock is 24-hour: short enough for one line in the gutter. */
const hourFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric" });
function hourLabel(h: number): string {
  return hourFormat.format(new Date(2024, 0, 1, h));
}

/** Minutes after midnight in this device's clock ("9:30 AM" or "21:30"), as the gutter's hours read. */
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
function clock(minutes: number): string {
  return clockFormat.format(new Date(2024, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

/**
 * The week (or, on narrow screens, three days): an all-day row for tasks with a date and no time, and an
 * hour grid where tasks with a time sit as 30-minute blocks, side by side when they overlap. Drop a task
 * on a day's all-day cell to give it that date without a time, or on the hour grid to set the date and the
 * time (in 30-minute steps).
 */
export function CalendarWeek({
  days,
  today,
  label,
  tasksByDate,
  eventsByDate,
  selected,
  gridRef,
  onSelect,
  onArrow,
  onMove,
  onEdit,
  onOpenEvent,
}: {
  days: string[];
  today: string;
  label: string;
  tasksByDate: Map<string, TaskRow[]>;
  /** Events from subscribed calendars, read-only. */
  eventsByDate: Map<string, PlacedEvent[]>;
  selected: string;
  gridRef: RefObject<HTMLDivElement | null>;
  onSelect: (date: string) => void;
  /** Arrow keys on a day: move focus `delta` days (the parent pages the week when needed). */
  onArrow: (date: string, delta: number) => void;
  /** A task dropped on a day: `time` null for the all-day row, "HH:MM" on the hour grid. */
  onMove: (blockId: string, date: string, time: string | null) => void;
  onEdit: (t: TaskRow) => void;
  onOpenEvent: (e: ExternalEvent, anchor: HTMLElement) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ date: string; minutes: number } | null>(null);
  const now = useNowMinutes();
  // One day in the row takes Tab focus: the selected one when it's shown, else the first.
  const focusable = days.includes(selected) ? selected : days[0];
  const columns: CSSProperties = { gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` };
  const showsToday = days.includes(today);
  // Opens an hour before now when today is shown, else at 6:00; earlier hours are a scroll up.
  useLayoutEffect(() => {
    const hour = showsToday ? Math.max(0, Math.min(16, Math.floor(now / 60) - 1)) : FIRST_VISIBLE_HOUR;
    if (scrollRef.current) scrollRef.current.scrollTop = hour * HOUR_PX - 10;
    // Only when the days shown change, not every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showsToday]);
  const hasTask = (e: React.DragEvent) => e.dataTransfer.types.includes(TASK_TYPE);
  const dragStart = (e: React.DragEvent, t: TaskRow) => {
    e.dataTransfer.setData(TASK_TYPE, t.blockId);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="overflow-hidden ui-card rounded-control">
      <div ref={gridRef} role="grid" aria-label={label}>
        <div role="row" className="grid border-b border-line bg-surface text-center text-footnote" style={columns}>
          <div role="columnheader">
            <span className="sr-only">Time</span>
          </div>
          {days.map((date) => (
            <div key={date} role="columnheader" className={`flex flex-col items-center justify-center gap-0.5 py-1.5 sm:flex-row sm:gap-1.5 sm:py-2 ${date === today ? "text-heading" : "text-muted"}`}>
              <span className="text-caption-2 font-semibold uppercase tracking-[0.04em]">{formatCalendarDate(date, { weekday: "short" })}</span>
              <span className={`grid h-6 min-w-6 place-items-center rounded-chip px-1 text-subheadline tabular-nums ${date === today ? "bg-heading font-semibold text-canvas" : selected === date ? "font-semibold text-ink" : "text-ink"}`}>{Number(date.slice(8))}</span>
            </div>
          ))}
        </div>
        <div role="row" className="grid border-b border-line" style={columns}>
          <div role="rowheader" className="whitespace-nowrap px-2 py-2 text-right text-caption-2 font-medium text-faint">
            All day
          </div>
          {days.map((date) => {
            const items = (tasksByDate.get(date) ?? []).filter((t) => timeToMinutes(t.dueTime) === null);
            const allDayEvents = (eventsByDate.get(date) ?? []).filter((p) => p.segment.allDay);
            return (
              <div
                key={date}
                role="gridcell"
                data-date={date}
                aria-selected={selected === date}
                tabIndex={focusable === date ? 0 : -1}
                aria-label={`${formatCalendarDate(date, { weekday: "long", month: "long", day: "numeric" })}, all day, ${items.length === 1 ? "1 task" : `${items.length} tasks`}${allDayEvents.length ? `, ${allDayEvents.length === 1 ? "1 event" : `${allDayEvents.length} events`}` : ""}`}
                onClick={() => onSelect(date)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? 7 : e.key === "ArrowUp" ? -7 : 0;
                  if (d) {
                    e.preventDefault();
                    onArrow(date, d);
                  }
                }}
                onDragOver={(e) => {
                  if (hasTask(e)) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData(TASK_TYPE);
                  if (id) onMove(id, date, null);
                }}
                className={`min-h-11 border-l border-line p-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${selected === date ? "bg-accent-soft/40" : ""}`}
              >
                <ul className="space-y-0.5">
                  {items.map((t) => (
                    <li key={t.blockId}>
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => dragStart(e, t)}
                        onClick={() => onEdit(t)}
                        title={t.title}
                        className={`block w-full cursor-grab truncate rounded-tiny px-1.5 text-left text-footnote font-medium leading-6 ${taskChipClass(t)}`}
                      >
                        {t.title || "Untitled task"}
                      </button>
                    </li>
                  ))}
                  {allDayEvents.map(({ event: ev }) => (
                    <li key={ev.id}>
                      <button
                        type="button"
                        onClick={(e) => onOpenEvent(ev, e.currentTarget)}
                        aria-label={`${ev.title || "Untitled event"}, all day, from ${ev.calendarName}`}
                        title={ev.title}
                        className="block w-full truncate rounded-tiny border-l-[3px] px-1.5 text-left text-footnote font-medium leading-6 text-ink hover:opacity-90"
                        style={eventStyle(ev.color)}
                      >
                        {ev.title || "Untitled event"}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
      <div ref={scrollRef} className="max-h-[min(68vh,748px)] overflow-y-auto overscroll-contain" role="region" aria-label="Hours" tabIndex={-1}>
        <div className="grid" style={{ ...columns, height: 24 * HOUR_PX }}>
          <div aria-hidden className="relative">
            {Array.from({ length: 23 }, (_, i) => i + 1)
              // An hour within 20 minutes of now gives way to now's time.
              .filter((h) => !showsToday || Math.abs(h * 60 - now) >= 20)
              .map((h) => (
                <span key={h} className="absolute right-2 -translate-y-1/2 whitespace-nowrap text-caption-2 font-medium tabular-nums text-faint" style={{ top: h * HOUR_PX }}>
                  {hourLabel(h)}
                </span>
              ))}
            {showsToday ? (
              <span className="absolute right-1.5 z-10 -translate-y-1/2 whitespace-nowrap bg-canvas px-0.5 text-caption-2 font-semibold tabular-nums text-ember" style={{ top: minutesToPx(now) }}>
                {clock(now)}
              </span>
            ) : null}
          </div>
          {days.map((date) => {
            const timed = (tasksByDate.get(date) ?? []).flatMap((t) => {
              const start = timeToMinutes(t.dueTime);
              return start === null ? [] : [{ task: t, start }];
            });
            const timedEvents = (eventsByDate.get(date) ?? []).filter((p) => !p.segment.allDay);
            // Short events still get a block tall enough to read.
            const eventEnd = (p: PlacedEvent) => Math.max(p.segment.end, p.segment.start + TASK_MINUTES);
            const placed = new Map(
              layoutOverlaps([
                ...timed.map(({ task, start }) => ({ id: `t:${task.blockId}`, start, end: start + TASK_MINUTES })),
                ...timedEvents.map((p) => ({ id: `e:${p.event.id}`, start: p.segment.start, end: eventEnd(p) })),
              ]).map((p) => [p.id, p]),
            );
            return (
              <div
                key={date}
                data-day-column={date}
                className={`relative border-l border-line ${date === today ? "bg-[color-mix(in_oklab,var(--color-ink)_2.5%,transparent)]" : ""}`}
                onDragOver={(e) => {
                  if (!hasTask(e)) return;
                  e.preventDefault();
                  const minutes = slotAt(e.clientY - e.currentTarget.getBoundingClientRect().top);
                  if (hover?.date !== date || hover.minutes !== minutes) setHover({ date, minutes });
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setHover(null);
                  const id = e.dataTransfer.getData(TASK_TYPE);
                  if (!id) return;
                  onMove(id, date, minutesToTime(slotAt(e.clientY - e.currentTarget.getBoundingClientRect().top)));
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} data-hour={h} aria-hidden className="border-b border-line/60" style={{ height: HOUR_PX }} />
                ))}
                {hover?.date === date ? (
                  <div aria-hidden className="pointer-events-none absolute inset-x-1 rounded-tiny border border-dashed border-accent bg-accent-soft/50" style={{ top: minutesToPx(hover.minutes), height: HOUR_PX / 2 }} />
                ) : null}
                {date === today ? (
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-ember" style={{ top: minutesToPx(now) - 1 }}>
                    <span className="absolute -left-1 -top-1 h-2 w-2 rounded-tiny bg-ember" />
                  </div>
                ) : null}
                {timedEvents.map((pe) => {
                  const p = placed.get(`e:${pe.event.id}`)!;
                  const ev = pe.event;
                  const time = `${minutesToTime(pe.segment.start)} to ${minutesToTime(Math.min(pe.segment.end, 24 * 60 - 1))}`;
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={(e) => onOpenEvent(ev, e.currentTarget)}
                      aria-label={`${ev.title || "Untitled event"}, ${time}, from ${ev.calendarName}`}
                      title={`${time} ${ev.title}`}
                      className="absolute overflow-hidden rounded-tiny border-l-[3px] px-1.5 py-0.5 text-left text-caption-1 font-medium leading-4 text-ink shadow-[0_0_0_1px_var(--color-canvas)] hover:opacity-90"
                      style={{
                        top: minutesToPx(p.start) + 1,
                        height: minutesToPx(p.end - p.start) - 2,
                        left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                        width: `calc(${100 / p.cols}% - 4px)`,
                        ...eventStyle(ev.color),
                      }}
                    >
                      <span className="line-clamp-3 break-words">{ev.title || "Untitled event"}</span>
                      {pe.segment.first && p.end - p.start >= 45 ? <span className="block truncate text-caption-2 tabular-nums text-muted">{clock(pe.segment.start)}</span> : null}
                    </button>
                  );
                })}
                {timed.map(({ task: t, start }) => {
                  const p = placed.get(`t:${t.blockId}`)!;
                  return (
                    <button
                      key={t.blockId}
                      type="button"
                      draggable
                      onDragStart={(e) => dragStart(e, t)}
                      onClick={() => onEdit(t)}
                      aria-label={`${t.title || "Untitled task"}, ${t.dueTime}${t.status === "done" ? ", done" : ""}`}
                      title={`${t.dueTime} ${t.title}`}
                      className={`absolute cursor-grab overflow-hidden rounded-tiny px-1.5 text-left text-caption-1 font-medium leading-4 shadow-[0_0_0_1px_var(--color-canvas)] ${taskChipClass(t)}`}
                      style={{ top: minutesToPx(start) + 1, height: minutesToPx(TASK_MINUTES) - 2, left: `calc(${(p.col / p.cols) * 100}% + 2px)`, width: `calc(${100 / p.cols}% - 4px)` }}
                    >
                      <span className="block truncate pt-0.5">{t.title || "Untitled task"}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
