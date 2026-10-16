"use client";

import type { ReactNode } from "react";
import { addDays } from "@folevi/editor-schema";
import { CalendarDays, CalendarRange, ListPlus, MoreHorizontal, Rows3, Rss } from "lucide-react";
import { formatCalendarDate } from "@/i18n";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { ViewChrome, useShell } from "@/components/app/Shell";
import type { TaskRow } from "@/components/views/TasksView";
import { calendarColor, eventWhen, type ExternalEvent } from "@/components/views/CalendarSubscriptions";
import { RootAvatar, RootPill } from "./RootBar";
import { TaskLine } from "./Tasks";

type Layout = "month" | "week" | "agenda";

/** The Calendar screen's "…" menu: the layouts, and subscribing to a calendar. */
export function calendarMenu(mode: Layout, pick: (l: Layout) => void, subscribe: () => void): MenuEntry[] {
  return [
    { heading: "Show" },
    { label: "Agenda", icon: <Rows3 size={18} />, checked: mode === "agenda", onSelect: () => pick("agenda") },
    { label: "Week", icon: <CalendarRange size={18} />, checked: mode === "week", onSelect: () => pick("week") },
    { label: "Month", icon: <CalendarDays size={18} />, checked: mode === "month", onSelect: () => pick("month") },
    "separator",
    { label: "Subscribe to a calendar", icon: <Rss size={18} />, onSelect: subscribe },
  ];
}

/**
 * Calendar in the iPhone app, as an agenda: today as the large title ("Oct 16", "Today · Friday"), then
 * every day of the next month under its own header ("Oct 17  Tomorrow · Saturday"), each with its tasks
 * and the events from subscribed calendars. Overdue tasks come first. Month and week are in the "…" menu.
 */
export function IphoneAgenda({
  today,
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
  days: string[];
  byDate: Map<string, TaskRow[]>;
  eventsByDate: Map<string, { event: ExternalEvent }[]>;
  overdue: TaskRow[] | undefined;
  timeZone: string;
  onToggle: (t: TaskRow) => void;
  onEdit: (t: TaskRow) => void;
  onOpenEvent: (e: ExternalEvent, anchor: HTMLElement) => void;
  menu: MenuEntry[];
  children?: ReactNode;
}) {
  const { openQuickAdd } = useShell();
  const short = (d: string) => formatCalendarDate(d, { month: "short", day: "numeric" });
  const weekday = (d: string) => formatCalendarDate(d, { weekday: "long" });
  const dayItems = (d: string) => (
    <>
      {(byDate.get(d) ?? []).map((t) => (
        <li key={t.blockId}>
          <TaskLine task={t} today={today} onToggle={onToggle} onOpen={() => onEdit(t)} showNote onDay />
        </li>
      ))}
      {(eventsByDate.get(d) ?? []).map(({ event: ev }) => (
        <li key={ev.id}>
          <button type="button" onClick={(e) => onOpenEvent(ev, e.currentTarget)} aria-label={`${ev.title || "Untitled event"}, ${eventWhen(ev, timeZone)}, from ${ev.calendarName}`} className="flex w-full items-start gap-3 pl-5 pr-4 text-left outline-none active:bg-[var(--liquid-press)]">
            <span aria-hidden className="mt-[19px] h-3 w-1 flex-none rounded-capsule" style={{ background: calendarColor(ev.color) }} />
            <span className="ui-row-sep min-w-0 flex-1 py-2.5">
              <span className="block truncate text-[17px] text-ink">{ev.title || "Untitled event"}</span>
              <span className="block truncate text-[13px] text-muted">
                {eventWhen(ev, timeZone)} · {ev.calendarName}
              </span>
            </span>
          </button>
        </li>
      ))}
    </>
  );
  const dayMenu = (d: string): MenuEntry[] => [{ label: "Add a task", icon: <ListPlus size={18} />, onSelect: () => openQuickAdd({ due: d }) }];
  return (
    <ViewChrome
      title="Calendar"
      tabTitle="Calendar"
      iphone={{
        title: short(today),
        root: true,
        leading: <RootAvatar />,
        trailing: <RootPill more={menu} />,
        subtitle: (
          <span className="flex items-center">
            <span className="font-semibold text-heading">Today</span>
            <span>&nbsp;· {weekday(today)}</span>
            <span className="flex-1" />
            <DayMenu label={`${short(today)} options`} items={dayMenu(today)} />
          </span>
        ),
      }}
    >
      <ul aria-label="Today" className="min-h-6 pb-2">
        {overdue?.length
          ? [...overdue]
              .sort((a, b) => ((a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : 1))
              .map((t) => (
                <li key={t.blockId}>
                  <TaskLine task={t} today={today} onToggle={onToggle} onOpen={() => onEdit(t)} showNote onDay />
                </li>
              ))
          : null}
        {dayItems(today)}
      </ul>
      {days
        .filter((d) => d !== today)
        .map((d) => {
          const tomorrow = d === addDays(today, 1);
          const items = (byDate.get(d)?.length ?? 0) + (eventsByDate.get(d)?.length ?? 0);
          return (
            <section key={d} aria-label={formatCalendarDate(d, { weekday: "long", month: "long", day: "numeric" })} className="mt-6">
              <h2 className="ui-row-sep mx-5 flex items-center pb-1 text-[17px]">
                <span className={`font-semibold ${items ? "text-heading" : "text-faint"}`}>{short(d)}</span>
                {tomorrow ? <span className={`ml-2 font-semibold ${items ? "text-heading" : "text-faint"}`}>Tomorrow</span> : null}
                <span className="text-faint">&nbsp;· {weekday(d)}</span>
                <span className="flex-1" />
                <DayMenu label={`${short(d)} options`} items={dayMenu(d)} />
              </h2>
              <ul className="min-h-8">{dayItems(d)}</ul>
            </section>
          );
        })}
      {children}
    </ViewChrome>
  );
}

function DayMenu({ label, items }: { label: string; items: MenuEntry[] }) {
  return (
    <MenuButton
      label={label}
      align="end"
      triggerClassName="-mr-2.5 grid h-10 w-10 place-items-center rounded-capsule text-faint outline-none active:bg-[var(--liquid-press)]"
      trigger={<MoreHorizontal size={20} aria-hidden />}
      items={items}
    />
  );
}
