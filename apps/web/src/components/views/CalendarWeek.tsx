"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { formatCalendarDate } from "@/i18n";
import type { TaskRow } from "./TasksView";
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

function taskChipClass(t: TaskRow) {
  return t.status === "open" ? "bg-accent-soft text-accent-soft-ink" : "bg-sunken text-faint line-through";
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
  selected,
  gridRef,
  onSelect,
  onArrow,
  onMove,
  onEdit,
}: {
  days: string[];
  today: string;
  label: string;
  tasksByDate: Map<string, TaskRow[]>;
  selected: string;
  gridRef: RefObject<HTMLDivElement | null>;
  onSelect: (date: string) => void;
  /** Arrow keys on a day: move focus `delta` days (the parent pages the week when needed). */
  onArrow: (date: string, delta: number) => void;
  /** A task dropped on a day: `time` null for the all-day row, "HH:MM" on the hour grid. */
  onMove: (blockId: string, date: string, time: string | null) => void;
  onEdit: (t: TaskRow) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ date: string; minutes: number } | null>(null);
  const now = useNowMinutes();
  // One day in the row takes Tab focus: the selected one when it's shown, else the first.
  const focusable = days.includes(selected) ? selected : days[0];
  const columns: CSSProperties = { gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` };
  // Opens at 6:00 with the evening below; earlier hours are a scroll up.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = FIRST_VISIBLE_HOUR * HOUR_PX - 10;
  }, []);
  const hasTask = (e: React.DragEvent) => e.dataTransfer.types.includes(TASK_TYPE);
  const dragStart = (e: React.DragEvent, t: TaskRow) => {
    e.dataTransfer.setData(TASK_TYPE, t.blockId);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="overflow-hidden ui-card rounded-control">
      <div ref={gridRef} role="grid" aria-label={label}>
        <div role="row" className="grid border-b border-line bg-surface text-center text-xs" style={columns}>
          <div role="columnheader">
            <span className="sr-only">Time</span>
          </div>
          {days.map((date) => (
            <div key={date} role="columnheader" className="flex items-center justify-center gap-1.5 py-2 font-medium text-muted">
              {formatCalendarDate(date, { weekday: "short" })}
              <span className={`grid h-6 min-w-6 place-items-center rounded-chip px-1 tabular-nums ${date === today ? "bg-heading font-semibold text-canvas" : "text-ink"}`}>{Number(date.slice(8))}</span>
            </div>
          ))}
        </div>
        <div role="row" className="grid border-b border-line" style={columns}>
          <div role="rowheader" className="px-2 py-2 text-right text-[11px] text-muted">
            All day
          </div>
          {days.map((date) => {
            const items = (tasksByDate.get(date) ?? []).filter((t) => timeToMinutes(t.dueTime) === null);
            return (
              <div
                key={date}
                role="gridcell"
                data-date={date}
                aria-selected={selected === date}
                tabIndex={focusable === date ? 0 : -1}
                aria-label={`${formatCalendarDate(date, { weekday: "long", month: "long", day: "numeric" })}, all day, ${items.length === 1 ? "1 task" : `${items.length} tasks`}`}
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
                        className={`block w-full cursor-grab truncate rounded-tiny px-1 text-left text-[11.5px] leading-5 ${taskChipClass(t)}`}
                      >
                        {t.title || "Untitled task"}
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
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-faint" style={{ top: h * HOUR_PX }}>
                {minutesToTime(h * 60)}
              </span>
            ))}
          </div>
          {days.map((date) => {
            const timed = (tasksByDate.get(date) ?? []).flatMap((t) => {
              const start = timeToMinutes(t.dueTime);
              return start === null ? [] : [{ task: t, start }];
            });
            const placed = new Map(layoutOverlaps(timed.map(({ task, start }) => ({ id: task.blockId, start, end: start + TASK_MINUTES }))).map((p) => [p.id, p]));
            return (
              <div
                key={date}
                data-day-column={date}
                className="relative border-l border-line"
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
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-accent" style={{ top: minutesToPx(now) }} />
                ) : null}
                {timed.map(({ task: t, start }) => {
                  const p = placed.get(t.blockId)!;
                  return (
                    <button
                      key={t.blockId}
                      type="button"
                      draggable
                      onDragStart={(e) => dragStart(e, t)}
                      onClick={() => onEdit(t)}
                      aria-label={`${t.title || "Untitled task"}, ${t.dueTime}${t.status === "done" ? ", done" : ""}`}
                      title={`${t.dueTime} ${t.title}`}
                      className={`absolute cursor-grab truncate rounded-tiny px-1 text-left text-[11px] leading-[14px] shadow-[0_0_0_1px_var(--color-canvas)] ${taskChipClass(t)}`}
                      style={{ top: minutesToPx(start) + 1, height: minutesToPx(TASK_MINUTES) - 2, left: `calc(${(p.col / p.cols) * 100}% + 2px)`, width: `calc(${100 / p.cols}% - 4px)` }}
                    >
                      <span className="mr-1 tabular-nums opacity-80">{t.dueTime}</span>
                      {t.title || "Untitled task"}
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
