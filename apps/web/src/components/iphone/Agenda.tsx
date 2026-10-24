"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { addDays } from "@folevi/editor-schema";
import { CalendarDays, CalendarRange, Plus, Rows3, Rss } from "lucide-react";
import { formatCalendarDate } from "@/i18n";
import { feel } from "@/lib/native/ui";
import type { MenuEntry } from "@/components/ui/Menu";
import { ViewChrome, useShell } from "@/components/app/Shell";
import type { TaskRow } from "@/components/views/TasksView";
import { calendarColor, eventWhen, type ExternalEvent } from "@/components/views/CalendarSubscriptions";
import { GlassTextButton } from "./Glass";
import { RootAvatar, RootPill } from "./RootBar";
import { TaskLine } from "./Tasks";
import { WeekStrip } from "./WeekStrip";

type Layout = "month" | "week" | "agenda";

/** The Calendar screen's "…" menu: the layouts, and subscribing to a calendar. */
export function calendarMenu(mode: Layout, pick: (l: Layout) => void, subscribe: (() => void) | null): MenuEntry[] {
  return [
    { heading: "Show" },
    { label: "Agenda", icon: <Rows3 size={18} />, checked: mode === "agenda", onSelect: () => pick("agenda") },
    { label: "Week", icon: <CalendarRange size={18} />, checked: mode === "week", onSelect: () => pick("week") },
    { label: "Month", icon: <CalendarDays size={18} />, checked: mode === "month", onSelect: () => pick("month") },
    ...(subscribe ? (["separator", { label: "Subscribe to a calendar", icon: <Rss size={18} />, onSelect: subscribe }] satisfies MenuEntry[]) : []),
  ];
}

/**
 * Calendar in the iPhone app (owner's decision D4): the month as the large title, the week strip under it
 * (pull it down for the whole month), then the picked day and the days after it, each with its tasks and
 * the events from subscribed calendars. Days with nothing on them are left out, except the picked one.
 * Overdue tasks come first when the picked day is today. Week and month grids are in the "…" menu.
 */
export function IphoneAgenda({
  today,
  selected,
  onSelect,
  days,
  byDate,
  eventsByDate,
  overdue,
  timeZone,
  onToggle,
  onEdit,
  onOpenEvent,
  menu,
  children,
}: {
  today: string;
  /** The picked day: the list starts there. */
  selected: string;
  onSelect: (date: string) => void;
  /** The picked day and the 30 after it. */
  days: string[];
  byDate: Map<string, TaskRow[]>;
  eventsByDate: Map<string, { event: ExternalEvent }[]>;
  overdue: TaskRow[] | undefined;
  timeZone: string;
  onToggle: (t: TaskRow, opts?: { felt?: boolean }) => void;
  onEdit: (t: TaskRow) => void;
  onOpenEvent: (e: ExternalEvent, anchor: HTMLElement) => void;
  menu: MenuEntry[];
  children?: ReactNode;
}) {
  const { openQuickAdd } = useShell();
  const year = selected.slice(0, 4) !== today.slice(0, 4);
  const title = formatCalendarDate(selected, year ? { month: "long", year: "numeric" } : { month: "long" });
  const marked = (d: string) => (byDate.get(d)?.length ?? 0) + (eventsByDate.get(d)?.length ?? 0) > 0;
  const shown = days.filter((d) => d === selected || (byDate.get(d)?.length ?? 0) + (eventsByDate.get(d)?.length ?? 0) > 0);
  const late = selected === today && overdue?.length ? [...overdue].sort((a, b) => ((a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : 1)) : [];

  // A day picked in the strip starts the list there: back to the top of it.
  const top = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const main = top.current?.closest("main");
    if (main && main.scrollTop > 0) main.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [selected]);

  const event = (ev: ExternalEvent) => (
    <li key={ev.id}>
      <button
        type="button"
        onClick={(e) => onOpenEvent(ev, e.currentTarget)}
        aria-label={`${ev.title || "Untitled event"}, ${eventWhen(ev, timeZone)}, from ${ev.calendarName}`}
        className="flex w-full items-stretch gap-3 pl-5 pr-4 text-left outline-none active:bg-[var(--liquid-press)] focus-visible:bg-[var(--liquid-active)]"
      >
        {/* Where a task has its box, an event has its calendar's colour. */}
        <span aria-hidden className="grid w-[22px] flex-none place-items-center">
          <span className="h-[22px] w-1 rounded-capsule" style={{ background: calendarColor(ev.color) }} />
        </span>
        <span className="ui-row-sep flex min-h-16 min-w-0 flex-1 flex-col justify-center py-2.5">
          <span className="block truncate text-body leading-[22px] text-ink">{ev.title || "Untitled event"}</span>
          <span className="mt-0.5 block truncate text-subheadline leading-5 text-muted">
            {eventWhen(ev, timeZone)} · {ev.calendarName}
          </span>
        </span>
      </button>
    </li>
  );

  return (
    <ViewChrome
      title="Calendar"
      tabTitle="Calendar"
      iphone={{
        title,
        root: true,
        leading: <RootAvatar />,
        trailing: (
          <>
            {selected !== today ? (
              <GlassTextButton
                onClick={() => {
                  feel("choose");
                  onSelect(today);
                }}
              >
                Today
              </GlassTextButton>
            ) : null}
            <RootPill more={menu} />
          </>
        ),
        header: (
          // Stuck under the bar while the days scroll. WebKit measures a sticky offset from inside the
          // scroller's padding (which already clears the bar), Chromium (Android) from its edge.
          <div ref={top} className="sticky top-[calc(env(safe-area-inset-top)+52px)] z-10 bg-canvas [:root[data-native=ios]_&]:top-0">
            <WeekStrip today={today} selected={selected} onSelect={onSelect} marked={marked} />
          </div>
        ),
      }}
    >
      {shown.map((d, i) => {
        const items = byDate.get(d) ?? [];
        const evs = eventsByDate.get(d) ?? [];
        const lead = d === selected ? late : [];
        const empty = !items.length && !evs.length && !lead.length;
        const label = formatCalendarDate(d, { weekday: "long", month: "long", day: "numeric" });
        return (
          <section key={d} aria-label={d === today ? `Today, ${label}` : label} className={i ? "mt-5" : "mt-2"}>
            <DayHeader date={d} today={today} onAdd={() => openQuickAdd({ due: d })} />
            {empty ? (
              <p className="mx-5 flex min-h-14 items-center text-subheadline italic leading-5 text-faint [font-family:var(--font-display)]">Nothing planned</p>
            ) : (
              <ul data-iphone-tappable="">
                {lead.map((t) => (
                  <li key={t.blockId}>
                    <TaskLine task={t} today={today} onToggle={onToggle} onOpen={() => onEdit(t)} showNote onDay />
                  </li>
                ))}
                {items.map((t) => (
                  <li key={t.blockId}>
                    <TaskLine task={t} today={today} onToggle={onToggle} onOpen={() => onEdit(t)} showNote onDay />
                  </li>
                ))}
                {evs.map(({ event: ev }) => event(ev))}
              </ul>
            )}
          </section>
        );
      })}
      {shown.length <= 1 ? <p className="mx-5 mt-8 text-center text-subheadline leading-5 text-muted">Nothing else in the next 30 days.</p> : null}
      {children}
    </ViewChrome>
  );
}

/**
 * Every day's header in one style: "Today", "Tomorrow" or the weekday in the heading's weight, the date in
 * muted beside it, and a 44 pt + that adds a task on that day.
 */
function DayHeader({ date, today, onAdd }: { date: string; today: string; onAdd: () => void }) {
  const near = date === today ? "Today" : date === addDays(today, 1) ? "Tomorrow" : date === addDays(today, -1) ? "Yesterday" : formatCalendarDate(date, { weekday: "long" });
  const rest = formatCalendarDate(date, near === "Today" || near === "Tomorrow" || near === "Yesterday" ? { weekday: "long", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
  return (
    <div className="flex min-h-11 items-center pl-5 pr-2">
      <h2 className="min-w-0 flex-1 truncate text-body leading-[22px]">
        <span className="font-semibold text-heading">{near}</span>
        <span className="text-muted"> · {rest}</span>
      </h2>
      <button type="button" aria-label={`Add a task on ${formatCalendarDate(date, { weekday: "long", month: "long", day: "numeric" })}`} onClick={onAdd} className="grid h-11 w-11 flex-none place-items-center rounded-capsule text-muted outline-none active:bg-[var(--liquid-press)] focus-visible:ring-2 focus-visible:ring-focus">
        <Plus size={20} strokeWidth={2.2} aria-hidden />
      </button>
    </div>
  );
}
