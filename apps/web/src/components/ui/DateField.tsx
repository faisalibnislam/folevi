"use client";

// Folevi's own date and time controls, used instead of the browser's date, time and date-time pickers:
// a button that opens a month calendar (Calendar, also usable inline), and a time dropdown built on Select.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { addDays } from "@folevi/editor-schema";
import { Select } from "./Select";
import { useTopLayer } from "./topLayer";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (date: string) => date.split("-").map(Number) as [number, number, number];
const isDate = (v: string | null | undefined): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

/** Today on this device, as YYYY-MM-DD. */
export function todayLocal(): string {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The locale's first day of the week (0 = Sunday … 6 = Saturday). */
function firstDayOfWeek(): number {
  try {
    const info = new Intl.Locale(navigator.language) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } };
    const first = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    return first ? first % 7 : 0;
  } catch {
    return 0;
  }
}

/** "Fri, Oct 9" (with the year when it isn't this year). */
export function dateLabel(date: string): string {
  const [y, m, d] = parse(date);
  const thisYear = new Date().getFullYear() === y;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(thisYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/**
 * A month calendar following the WAI-ARIA date-picker grid: arrows move by day and week, Page Up/Down by
 * month (with Shift, by year), Home/End to the week's start and end, Enter or Space picks.
 */
export function Calendar({
  value,
  onPick,
  today = todayLocal(),
  autoFocus = false,
}: {
  value: string | null;
  onPick: (date: string) => void;
  today?: string;
  autoFocus?: boolean;
}) {
  const start = isDate(value) ? value : today;
  const [focus, setFocus] = useState(start);
  const [fy, fm] = parse(focus);
  const grid = useRef<HTMLDivElement>(null);
  const moved = useRef(autoFocus);
  const first = useMemo(firstDayOfWeek, []);
  const labelId = useId();

  useEffect(() => {
    if (!moved.current) return;
    const cell = () => grid.current?.querySelector<HTMLElement>(`[data-date="${focus}"]`);
    cell()?.focus();
    // Again a frame later: a popover holding the calendar is still hidden on its first render.
    const id = requestAnimationFrame(() => {
      if (document.activeElement !== cell()) cell()?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [focus]);

  const monthStart = new Date(Date.UTC(fy, fm - 1, 1));
  const lead = (monthStart.getUTCDay() - first + 7) % 7;
  const gridStart = addDays(ymd(fy, fm - 1, 1), -lead);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2023, 0, 1 + ((first + i) % 7))).toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" }));
  const title = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

  const shiftMonth = (date: string, months: number) => {
    const [y, m, d] = parse(date);
    const target = new Date(Date.UTC(y, m - 1 + months, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return ymd(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last));
  };
  const go = (next: string) => {
    moved.current = true;
    setFocus(next);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const [y0, m0, d0] = parse(focus);
    const dow = (new Date(Date.UTC(y0, m0 - 1, d0)).getUTCDay() - first + 7) % 7;
    let next: string | null = null;
    if (e.key === "ArrowLeft") next = addDays(focus, -1);
    else if (e.key === "ArrowRight") next = addDays(focus, 1);
    else if (e.key === "ArrowUp") next = addDays(focus, -7);
    else if (e.key === "ArrowDown") next = addDays(focus, 7);
    else if (e.key === "PageUp") next = shiftMonth(focus, e.shiftKey ? -12 : -1);
    else if (e.key === "PageDown") next = shiftMonth(focus, e.shiftKey ? 12 : 1);
    else if (e.key === "Home") next = addDays(focus, -dow);
    else if (e.key === "End") next = addDays(focus, 6 - dow);
    else if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement).dataset.date) {
      // The highlighted day, even if focus hasn't caught up with fast key presses.
      e.preventDefault();
      onPick(focus);
      return;
    }
    if (!next) return;
    e.preventDefault();
    go(next);
  };

  const nav =
    "grid h-7 w-7 place-items-center rounded-chip text-muted transition-colors hover:bg-accent-soft hover:text-heading focus-visible:shadow-[0_0_0_2px_var(--color-focus)] focus-visible:outline-none";
  return (
    <div className="w-[244px] select-none">
      <div className="mb-1.5 flex items-center justify-between px-0.5">
        <span id={labelId} className="text-[13px] font-semibold text-heading" aria-live="polite">
          {title}
        </span>
        <span className="flex gap-0.5">
          <button type="button" className={nav} aria-label="Previous month" onClick={() => setFocus(shiftMonth(focus, -1))}>
            <ChevronLeft size={15} aria-hidden />
          </button>
          <button type="button" className={nav} aria-label="Next month" onClick={() => setFocus(shiftMonth(focus, 1))}>
            <ChevronRight size={15} aria-hidden />
          </button>
        </span>
      </div>
      <div ref={grid} role="grid" aria-labelledby={labelId} onKeyDown={onKey} className="grid grid-cols-7 gap-0.5">
        <div role="row" className="contents">
          {weekdays.map((w, i) => (
            <span key={`w${i}`} role="columnheader" className="grid h-7 place-items-center text-[11px] font-semibold text-faint">
              {w}
            </span>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, week) => (
          <div key={week} role="row" className="contents">
            {days.slice(week * 7, week * 7 + 7).map((day) => {
              const [, m, d] = parse(day);
              const outside = m !== fm;
              const selected = day === value;
              const isToday = day === today;
              return (
                <button
                  key={day}
                  type="button"
                  role="gridcell"
                  data-date={day}
                  tabIndex={day === focus ? 0 : -1}
                  aria-selected={selected}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={dateLabel(day)}
                  onClick={() => onPick(day)}
                  className={`grid h-8 place-items-center rounded-chip text-[13px] tabular-nums transition-colors focus-visible:shadow-[0_0_0_2px_var(--color-focus)] focus-visible:outline-none ${
                    selected
                      ? "bg-[var(--color-heading)] font-semibold text-[var(--color-surface)]"
                      : isToday
                        ? "font-semibold text-accent hover:bg-accent-soft"
                        : outside
                          ? "text-faint hover:bg-accent-soft"
                          : "text-ink hover:bg-accent-soft hover:text-heading"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A date control: the chosen date on a button that opens a calendar. `""` means no date. */
export function DateField({
  value,
  onChange,
  placeholder = "No date",
  clearable = true,
  disabled,
  className = "",
  "aria-label": ariaLabel,
  autoFocus,
  bare = false,
  size = "md",
}: {
  /** "lg" matches the 36px fields of forms (Quick Add, task editing). */
  size?: "md" | "lg";
  value: string;
  onChange: (date: string) => void;
  /** Without the field frame and icon (inside a table cell). */
  bare?: boolean;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const style = useTopLayer(open, pop, button, { align: "start" });
  const id = useId();

  useLayoutEffect(() => {
    if (autoFocus) button.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel}: ${isDate(value) ? dateLabel(value) : placeholder}` : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-autofocus={autoFocus ? "" : undefined}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setHost(button.current?.closest("dialog") ?? document.body);
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setHost(button.current?.closest("dialog") ?? document.body);
            setOpen(true);
          }
        }}
        className={
          bare
            ? "flex w-full min-w-0 items-center bg-transparent text-left outline-none disabled:opacity-50"
            : `ui-input flex ${size === "lg" ? "h-9" : "h-8"} w-full min-w-0 items-center gap-2 rounded-chip pl-2.5 pr-8 text-left text-[13px] disabled:opacity-50`
        }
      >
        {bare ? null : <CalendarDays size={14} aria-hidden className="flex-none text-muted" />}
        <span className={`truncate ${isDate(value) ? "text-ink" : "text-faint"}`}>{isDate(value) ? dateLabel(value) : placeholder}</span>
      </button>
      {clearable && !bare && isDate(value) && !disabled ? (
        <button
          type="button"
          aria-label={`Clear ${ariaLabel ?? "date"}`}
          onClick={() => {
            onChange("");
            button.current?.focus();
          }}
          className="absolute right-1.5 grid h-5 w-5 place-items-center rounded-tiny text-faint hover:bg-accent-soft hover:text-heading"
        >
          <X size={12} aria-hidden />
        </button>
      ) : null}
      {open && host
        ? createPortal(
            <div
              ref={pop}
              id={id}
              role="dialog"
              aria-label={ariaLabel ? `Choose ${ariaLabel.toLowerCase()}` : "Choose a date"}
              popover="manual"
              style={style}
              className="ui-pop z-[110] border-0 p-2.5 text-ink animate-[folio-rise_120ms_var(--ease-folio)] motion-reduce:animate-none"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                } else if (e.key === "Tab") {
                  // From the days, Tab moves on to the field after this one (the calendar floats outside the form).
                  e.preventDefault();
                  e.stopPropagation();
                  close(false);
                  focusBeside(button.current, e.shiftKey ? -1 : 1);
                }
              }}
            >
              <Calendar
                value={isDate(value) ? value : null}
                autoFocus
                onPick={(d) => {
                  onChange(d);
                  close();
                }}
              />
              {clearable && isDate(value) ? (
                <div className="mt-1.5 flex justify-end border-t border-line pt-1.5">
                  <button
                    type="button"
                    className="ui-btn ui-btn-quiet h-7 px-2.5 text-xs"
                    onClick={() => {
                      onChange("");
                      close();
                    }}
                  >
                    Clear
                  </button>
                </div>
              ) : null}
            </div>,
            host,
          )
        : null}
    </span>
  );
}

/** Focus the next (or previous) focusable control after `from` in the page. */
function focusBeside(from: HTMLElement | null, dir: 1 | -1) {
  if (!from) return;
  const all = [...document.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter(
    (el) => el.offsetParent !== null || el === from,
  );
  const i = all.indexOf(from);
  (all[i + dir] ?? from).focus();
}

const TIMES = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);

/** "9:15 AM" (in the person's locale). */
export function timeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

/** A time of day in 15-minute steps (keeping any other saved time), or none. `""` means no time. */
export function TimeField({
  value,
  onChange,
  emptyLabel = "No time",
  disabled,
  className = "",
  "aria-label": ariaLabel,
  allowEmpty = true,
  size = "md",
}: {
  /** Whether "no time" is a choice. */
  allowEmpty?: boolean;
  size?: "md" | "lg";
  value: string;
  onChange: (time: string) => void;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const times = value && !TIMES.includes(value) ? [...TIMES, value].sort() : TIMES;
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`${size === "lg" ? "h-9" : "h-8"} ui-input rounded-chip px-2.5 text-[13px] ${className}`}
    >
      {allowEmpty || !value ? <option value="">{emptyLabel}</option> : null}
      {times.map((t) => (
        <option key={t} value={t}>
          {timeLabel(t)}
        </option>
      ))}
    </Select>
  );
}

/** A timestamp as "YYYY-MM-DDTHH:MM" in local time (what a date-time form value holds). */
export function localDateTimeValue(ts: number): string {
  const d = new Date(ts);
  return `${ymd(d.getFullYear(), d.getMonth(), d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A moment (a reminder): date plus time. `null` means none; a date without a time means 9:00. */
export function DateTimeField({ value, onChange, "aria-label": ariaLabel = "Date" }: { value: number | null; onChange: (ts: number | null) => void; "aria-label"?: string }) {
  const d = value ? new Date(value) : null;
  const date = d ? ymd(d.getFullYear(), d.getMonth(), d.getDate()) : "";
  const time = d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "";
  const make = (nextDate: string, nextTime: string) => {
    if (!nextDate) return onChange(null);
    const [y, m, day] = parse(nextDate);
    const [h, min] = (nextTime || "09:00").split(":").map(Number) as [number, number];
    onChange(new Date(y, m - 1, day, h, min).getTime());
  };
  return (
    // The time keeps room for "12:45 PM" however narrow the row is.
    <span className="grid grid-cols-[minmax(0,1fr)_minmax(7.5rem,auto)] gap-1.5">
      <DateField value={date} onChange={(v) => make(v, time)} aria-label={ariaLabel} />
      <TimeField value={time} onChange={(v) => make(date, v || "09:00")} disabled={!date} allowEmpty={!date} aria-label={`${ariaLabel} time`} emptyLabel="Time" className="w-full" />
    </span>
  );
}
