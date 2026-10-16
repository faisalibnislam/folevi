"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Rss, CalendarCheck } from "lucide-react";
import { addDays } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { formatCalendarDate, t } from "@/i18n";
import { Button, IconButton } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome } from "@/components/app/Shell";
import { TaskEditDialog, TaskItem, useToggleTask, type TaskRow } from "./TasksView";
import { CalendarFeedDialog } from "./CalendarFeedDialog";
import { CalendarWeek } from "./CalendarWeek";
import { CalendarsButton, EventPopover, calendarColor, eventWhen, useExternalEvents, type ExternalEvent, type PlacedEvent } from "./CalendarSubscriptions";
import { minutesToTime, monthGrid, shiftMonth, visibleDays } from "./calendarLayout";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { EmptyState } from "@/components/ui/EmptyState";
import { isIphoneApp, useIphoneApp } from "@/lib/iphone";
import { IphoneAgenda, calendarMenu } from "@/components/iphone/Agenda";
import { RootAvatar, RootPill } from "@/components/iphone/RootBar";

type Layout = "month" | "week" | "agenda";
const LAYOUT_KEY = "folevi:calendar-layout";
// The iPhone app keeps its own choice, and starts on the agenda.
const IPHONE_LAYOUT_KEY = "folevi:calendar-layout-iphone";

/** The layout last picked on this device (month when nothing is stored or storage is off; the agenda on iPhone). */
function storedLayout(): Layout {
  const iphone = isIphoneApp();
  try {
    const v = localStorage.getItem(iphone ? IPHONE_LAYOUT_KEY : LAYOUT_KEY);
    return v === "week" || v === "agenda" || v === "month" ? v : iphone ? "agenda" : "month";
  } catch {
    return iphone ? "agenda" : "month";
  }
}

/**
 * Month grid, week grid and agenda for dated tasks. Drag a task to a day to reschedule it, or in the week
 * to a time (with Undo). The layout is remembered on this device; narrow screens get three days at a time.
 */
export function CalendarView({ month }: { month: string | null }) {
  const { scope, today, deviceId, timeZone } = useAppState();
  const { navigate } = useAppRouter();
  const current = month ?? today.slice(0, 7);
  const [mode, setModeState] = useState<Layout>("month");
  useEffect(() => setModeState(storedLayout()), []);
  const setMode = (next: Layout) => {
    setModeState(next);
    try {
      localStorage.setItem(isIphoneApp() ? IPHONE_LAYOUT_KEY : LAYOUT_KEY, next);
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
  };
  const narrow = useMediaQuery("(max-width: 767px)");
  // The week view's first day (any day of the week on wide screens; the first of three on narrow ones).
  const [anchor, setAnchor] = useState(today);
  const weekDays = visibleDays(anchor, narrow ? 3 : 7);
  const first = `${current}-01`;
  const days = monthGrid(current);
  const agendaDays = useMemo(() => Array.from({ length: 31 }, (_, i) => addDays(today, i)), [today]);
  const from = mode === "month" ? days[0]! : mode === "week" ? weekDays[0]! : today;
  const to = mode === "month" ? days[41]! : mode === "week" ? weekDays[weekDays.length - 1]! : addDays(today, 30);
  const tasks = useQuery(api.tasks.range, { scope, from, to, includeCompleted: true });
  // The agenda starts with anything still open from before today; undated tasks can be scheduled from here.
  const overdue = useQuery(api.tasks.range, mode === "agenda" ? { scope, from: "0000-01-01", to: addDays(today, -1) } : "skip");
  const open = useQuery(api.tasks.list, { scope, view: "all", today });
  const unscheduled = useMemo(() => (open ?? []).filter((t) => !t.dueDate), [open]);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const update = useMutation(api.tasks.update);
  const toast = useToast();
  const toggle = useToggleTask();
  const [selected, setSelected] = useState<string>(today);
  const [feedOpen, setFeedOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  // Events from subscribed calendars (read-only), and the one whose details are open.
  const eventsByDate = useExternalEvents(mode === "week" ? weekDays : mode === "agenda" ? agendaDays : days, timeZone);
  const [openEvent, setOpenEvent] = useState<ExternalEvent | null>(null);
  const eventAnchor = useRef<HTMLElement | null>(null);
  const showEvent = (e: ExternalEvent, anchor: HTMLElement) => {
    eventAnchor.current = anchor;
    setOpenEvent(e);
  };

  const byDate = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const t of tasks ?? []) {
      if (!t.dueDate) continue;
      const day = m.get(t.dueDate);
      if (day) day.push(t);
      else m.set(t.dueDate, [t]);
    }
    return m;
  }, [tasks]);

  /** Gives a task a new date; `time` sets its time too (null: all day), undefined keeps the one it has. */
  const reschedule = (blockId: string, date: string, time?: string | null) => {
    const task = tasks?.find((t) => t.blockId === blockId) ?? unscheduled.find((t) => t.blockId === blockId) ?? overdue?.find((t) => t.blockId === blockId);
    if (!task || (task.dueDate === date && (time === undefined || time === task.dueTime))) return;
    const previous = { dueDate: task.dueDate, dueTime: task.dueTime };
    const device = deviceId ?? undefined;
    const when = formatCalendarDate(date, { month: "short", day: "numeric" }) + (time ? `, ${time}` : "");
    update({ blockId, dueDate: date, ...(time !== undefined ? { dueTime: time } : {}), deviceId: device }).then(
      () =>
        toast.show(`Moved to ${when}`, {
          action: { label: "Undo", onClick: () => void update({ blockId, dueDate: previous.dueDate, dueTime: previous.dueDate ? previous.dueTime : null, deviceId: device }) },
        }),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  };

  const monthLabel = formatCalendarDate(first, { month: "long", year: "numeric" });
  const weekdays = Array.from({ length: 7 }, (_, i) => formatCalendarDate(`2024-01-0${1 + i}`, { weekday: "short" }));

  const moveFocus = (date: string, delta: number) => {
    const next = addDays(date, delta);
    setSelected(next);
    if (next.slice(0, 7) !== current) navigate(`/calendar/${next.slice(0, 7)}`, { replace: true });
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus());
  };
  // In the week, arrows past either end page to the days before or after.
  const moveWeekFocus = (date: string, delta: number) => {
    const next = addDays(date, delta);
    setSelected(next);
    if (!weekDays.includes(next)) setAnchor(narrow && delta < 0 ? addDays(next, -2) : next);
    requestAnimationFrame(() => requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus()));
  };
  const pickLayout = (next: Layout) => {
    if (next === mode) return;
    if (next === "week") setAnchor(selected);
    if (next === "month" && mode === "week" && anchor.slice(0, 7) !== current) navigate(`/calendar/${anchor.slice(0, 7)}`, { replace: true });
    setMode(next);
  };
  const weekLabel = `${formatCalendarDate(weekDays[0]!, { month: "short", day: "numeric" })} to ${formatCalendarDate(weekDays[weekDays.length - 1]!, { month: "short", day: "numeric", year: "numeric" })}`;
  // The same height as the buttons beside it (32): 24px items in the 4px track.
  const layoutSwitch = (
    <div role="radiogroup" aria-label="Calendar layout" className="ui-seg ui-well [&>*]:min-h-6">
      {(["month", "week", "agenda"] as const).map((m) => (
        <button key={m} type="button" role="radio" aria-checked={mode === m} data-active={mode === m} onClick={() => pickLayout(m)} className="capitalize">
          {m}
        </button>
      ))}
    </div>
  );
  const heading = mode === "month" ? monthLabel : mode === "week" ? weekLabel : "Next 30 days";
  const pager =
    mode === "month" ? (
      <div className="flex items-center gap-1">
        <IconButton label="Previous month" onClick={() => navigate(`/calendar/${shiftMonth(current, -1)}`)}>
          <ChevronLeft size={16} aria-hidden />
        </IconButton>
        <Button size="sm" onClick={() => navigate(`/calendar/${today.slice(0, 7)}`)}>
          Today
        </Button>
        <IconButton label="Next month" onClick={() => navigate(`/calendar/${shiftMonth(current, 1)}`)}>
          <ChevronRight size={16} aria-hidden />
        </IconButton>
      </div>
    ) : mode === "week" ? (
      <div className="flex items-center gap-1">
        <IconButton label={narrow ? "Previous days" : "Previous week"} onClick={() => setAnchor(addDays(anchor, -weekDays.length))}>
          <ChevronLeft size={16} aria-hidden />
        </IconButton>
        <Button
          size="sm"
          onClick={() => {
            setAnchor(today);
            setSelected(today);
          }}
        >
          Today
        </Button>
        <IconButton label={narrow ? "Next days" : "Next week"} onClick={() => setAnchor(addDays(anchor, weekDays.length))}>
          <ChevronRight size={16} aria-hidden />
        </IconButton>
      </div>
    ) : null;

  const iphone = useIphoneApp();
  const dialogs = (
    <>
      <TaskEditDialog task={editing} onClose={() => setEditing(null)} />
      <CalendarFeedDialog open={feedOpen} onClose={() => setFeedOpen(false)} />
      <EventPopover event={openEvent} anchor={eventAnchor} timeZone={timeZone} onClose={() => setOpenEvent(null)} />
    </>
  );
  const iphoneMenu = calendarMenu(mode, pickLayout, () => setFeedOpen(true));
  if (iphone && mode === "agenda") {
    return (
      <IphoneAgenda today={today} days={agendaDays} byDate={byDate} eventsByDate={eventsByDate} overdue={overdue} timeZone={timeZone} onToggle={toggle} onEdit={setEditing} onOpenEvent={showEvent} menu={iphoneMenu}>
        {dialogs}
      </IphoneAgenda>
    );
  }

  return (
    <ViewChrome title={<h1 className="text-sm font-semibold">Calendar</h1>} tabTitle="Calendar" iphone={{ title: heading, root: true, leading: <RootAvatar />, trailing: <RootPill more={iphoneMenu} /> }}>
      <div className="mx-auto max-w-[1180px] px-4 pb-[max(6rem,var(--fab-clearance))] pt-3 sm:px-8">
        {/* One row: the period (a section title, as on Home) with its paging, then the calendar's tools. On
            phones the tools wrap onto a second line. */}
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 aria-live="polite" className={iphone ? "sr-only" : "ui-display text-[22px] leading-8"}>
            {heading}
          </h2>
          {pager}
          <div className="ml-auto flex items-center gap-1.5">
            <CalendarsButton />
            {iphone ? null : (
              <Button size="sm" onClick={() => setFeedOpen(true)}>
                <Rss size={14} aria-hidden /> <span className="max-md:sr-only">Subscribe</span>
              </Button>
            )}
            {iphone ? null : layoutSwitch}
          </div>
        </div>

        {mode === "week" ? (
          <>
            <CalendarWeek
              days={weekDays}
              today={today}
              label={weekLabel}
              tasksByDate={byDate}
              selected={selected}
              gridRef={gridRef}
              onSelect={setSelected}
              onArrow={moveWeekFocus}
              onMove={reschedule}
              onEdit={setEditing}
              eventsByDate={eventsByDate}
              onOpenEvent={showEvent}
            />
            <p className="mt-3 text-xs text-muted">Drag a task to a time to set it, or to the all-day row to keep just the date. Select a task to edit it.</p>
            <Unscheduled tasks={unscheduled} today={today} target={weekDays.includes(selected) ? selected : today} onSchedule={reschedule} onToggle={toggle} onEdit={setEditing} />
          </>
        ) : mode === "month" ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
            <div ref={gridRef} role="grid" aria-label={monthLabel} className="overflow-hidden ui-card rounded-control">
              <div role="row" className="grid grid-cols-7 border-b border-line bg-surface text-center text-xs font-medium text-muted">
                {weekdays.map((w) => (
                  <div key={w} role="columnheader" className="py-2">
                    {w}
                  </div>
                ))}
              </div>
              {Array.from({ length: 6 }, (_, week) => (
                <div role="row" key={week} className="grid grid-cols-7">
                  {days.slice(week * 7, week * 7 + 7).map((date) => {
                    const inMonth = date.startsWith(current);
                    const items = byDate.get(date) ?? [];
                    const evs = eventsByDate.get(date) ?? [];
                    const room = Math.max(0, 3 - items.length);
                    const hidden = Math.max(0, items.length - 3) + Math.max(0, evs.length - room);
                    const isToday = date === today;
                    return (
                      <div
                        key={date}
                        role="gridcell"
                        aria-selected={selected === date}
                        tabIndex={selected === date ? 0 : -1}
                        data-date={date}
                        aria-label={
                          t("calendar.day.label", { date: formatCalendarDate(date, { weekday: "long", month: "long", day: "numeric" }), count: items.length }) +
                          (evs.length ? `, ${evs.length === 1 ? "1 event" : `${evs.length} events`}` : "")
                        }
                        onClick={() => setSelected(date)}
                        onKeyDown={(e) => {
                          const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? 7 : e.key === "ArrowUp" ? -7 : 0;
                          if (d) {
                            e.preventDefault();
                            moveFocus(date, d);
                          } else if (e.key === "Enter") setSelected(date);
                        }}
                        onDragOver={(e) => {
                          if (e.dataTransfer.types.includes("application/x-folevi-task")) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const id = e.dataTransfer.getData("application/x-folevi-task");
                          if (id) reschedule(id, date);
                        }}
                        className={`min-h-[104px] border-b border-r border-line p-1.5 outline-none last:border-r-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${inMonth ? "" : "bg-surface/60"} ${selected === date ? "bg-accent-soft/40" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`grid h-6 min-w-6 place-items-center rounded-chip px-1 text-xs tabular-nums ${isToday ? "bg-heading font-semibold text-canvas shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]" : inMonth ? "text-ink" : "text-faint"}`}>{Number(date.slice(8))}</span>
                        </div>
                        <ul className="mt-1 space-y-0.5">
                          {items.slice(0, 3).map((t) => (
                            <li
                              key={t.blockId}
                              draggable
                              onDragStart={(e) => e.dataTransfer.setData("application/x-folevi-task", t.blockId)}
                              className={`cursor-grab truncate rounded-tiny px-1 text-[11.5px] leading-5 ${t.status === "done" ? "bg-sunken text-faint line-through" : "bg-accent-soft text-accent-soft-ink"}`}
                              title={t.title}
                            >
                              {t.dueTime ? `${t.dueTime} ` : ""}
                              {t.title}
                            </li>
                          ))}
                          {evs.slice(0, room).map((p) => (
                            <li key={p.event.id}>
                              <EventChip placed={p} onOpen={showEvent} />
                            </li>
                          ))}
                          {hidden ? <li className="px-1 text-[11px] text-muted">+{hidden} more</li> : null}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <aside aria-label="Selected day">
              <h3 className="font-semibold">{formatCalendarDate(selected, { weekday: "long", month: "long", day: "numeric" })}</h3>
              <ul className="mt-3 divide-y divide-line overflow-hidden ui-card rounded-control">
                {(byDate.get(selected) ?? []).length === 0 ? (
                  <li>
                    <EmptyState size="inline" icon={CalendarCheck} title="No tasks due" body="Drag a task onto this day to schedule it." />
                  </li>
                ) : null}
                {(byDate.get(selected) ?? []).map((t) => (
                  <TaskItem key={t.blockId} task={t} today={today} onToggle={toggle} onEdit={setEditing} />
                ))}
              </ul>
              {(eventsByDate.get(selected) ?? []).length ? (
                <section aria-label="Events" className="mt-4">
                  <h4 className="mb-2 text-sm font-semibold">Events</h4>
                  <ul className="divide-y divide-line overflow-hidden ui-card rounded-control">
                    {(eventsByDate.get(selected) ?? []).map(({ event: ev }) => (
                      <EventRow key={ev.id} event={ev} timeZone={timeZone} onOpen={showEvent} />
                    ))}
                  </ul>
                </section>
              ) : null}
              <p className="mt-3 text-xs text-muted">Drag tasks between days to reschedule, or use a task’s edit button to pick a date. Arrow keys move between days.</p>
              <Unscheduled tasks={unscheduled} today={today} target={selected} onSchedule={reschedule} onToggle={toggle} onEdit={setEditing} />
            </aside>
          </div>
        ) : (
          <div className="space-y-6">
            {overdue?.length ? (
              <section aria-label="Overdue">
                <h3 className="mb-2 text-sm font-semibold text-danger">Overdue</h3>
                <ul className="divide-y divide-line overflow-hidden ui-card rounded-control">
                  {[...overdue]
                    .sort((a, b) => ((a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : 1))
                    .map((t) => (
                      <TaskItem key={t.blockId} task={t} today={today} onToggle={toggle} onEdit={setEditing} />
                    ))}
                </ul>
              </section>
            ) : null}
            {agendaDays
              .filter((d) => byDate.has(d) || eventsByDate.has(d) || d === today)
              .map((d) => (
                <section key={d} aria-label={d}>
                  <h3 className="mb-2 flex items-center gap-3 text-sm font-semibold">
                    {d === today ? "Today" : formatCalendarDate(d, { weekday: "long", month: "long", day: "numeric" })}
                  </h3>
                  <ul className="divide-y divide-line overflow-hidden ui-card rounded-control">
                    {(byDate.get(d) ?? []).length === 0 && !eventsByDate.has(d) ? <li className="px-4 py-3 text-sm text-muted">Nothing due.</li> : null}
                    {(byDate.get(d) ?? []).map((t) => (
                      <TaskItem key={t.blockId} task={t} today={today} onToggle={toggle} onEdit={setEditing} />
                    ))}
                    {(eventsByDate.get(d) ?? []).map(({ event: ev }) => (
                      <EventRow key={ev.id} event={ev} timeZone={timeZone} onOpen={showEvent} />
                    ))}
                  </ul>
                </section>
              ))}
            <Unscheduled tasks={unscheduled} today={today} target={today} onSchedule={reschedule} onToggle={toggle} onEdit={setEditing} />
          </div>
        )}
      </div>
      {dialogs}
    </ViewChrome>
  );
}

/** A subscribed calendar's event in a list (the selected day, the agenda): muted, read-only, opens its details. */
function EventRow({ event: ev, timeZone, onOpen }: { event: ExternalEvent; timeZone: string; onOpen: (e: ExternalEvent, anchor: HTMLElement) => void }) {
  return (
    <li>
      <button type="button" onClick={(e) => onOpen(ev, e.currentTarget)} aria-label={`${ev.title || "Untitled event"}, ${eventWhen(ev, timeZone)}, from ${ev.calendarName}`} className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-surface">
        <span aria-hidden className="mt-1.5 inline-block h-2.5 w-2.5 flex-none rounded-chip" style={{ background: calendarColor(ev.color) }} />
        <span className="min-w-0">
          <span className="block text-[15px] leading-snug text-muted">{ev.title || "Untitled event"}</span>
          <span className="block text-xs text-faint">
            {eventWhen(ev, timeZone)} · {ev.calendarName}
          </span>
        </span>
      </button>
    </li>
  );
}

/** A subscribed calendar's event on a month day: muted, its calendar's colour as a dot, no checkbox. */
function EventChip({ placed: { event: ev, segment }, onOpen }: { placed: PlacedEvent; onOpen: (e: ExternalEvent, anchor: HTMLElement) => void }) {
  const time = !segment.allDay && segment.first ? minutesToTime(segment.start) : "";
  return (
    <button
      type="button"
      onClick={(e) => onOpen(ev, e.currentTarget)}
      aria-label={`${ev.title || "Untitled event"}, ${time || "all day"}, from ${ev.calendarName}`}
      title={ev.title}
      className="flex w-full items-center gap-1 rounded-tiny bg-surface px-1 text-left text-[11.5px] leading-5 text-muted hover:bg-sunken"
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 flex-none rounded-chip" style={{ background: calendarColor(ev.color) }} />
      <span className="truncate">
        {time ? `${time} ` : ""}
        {ev.title || "Untitled event"}
      </span>
    </button>
  );
}

/** Open tasks without a date: drag onto a day, or schedule them for the selected day in one click. */
function Unscheduled({
  tasks,
  today,
  target,
  onSchedule,
  onToggle,
  onEdit,
}: {
  tasks: TaskRow[];
  today: string;
  target: string;
  onSchedule: (blockId: string, date: string) => void;
  onToggle: (t: TaskRow) => void;
  onEdit: (t: TaskRow) => void;
}) {
  const label = target === today ? "today" : formatCalendarDate(target, { month: "short", day: "numeric" });
  return (
    <section aria-label="Unscheduled tasks" className="mt-6">
      <h3 className="mb-2 text-sm font-semibold">Unscheduled</h3>
      {tasks.length === 0 ? (
        <div className="ui-card rounded-control">
          <EmptyState size="inline" title="Nothing unscheduled" body="Every open task has a date." />
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden ui-card rounded-control">
          {tasks.slice(0, 8).map((t) => (
            <TaskItem
              key={t.blockId}
              task={t}
              today={today}
              onToggle={onToggle}
              onEdit={onEdit}
              action={
                <button type="button" onClick={() => onSchedule(t.blockId, target)} className="ui-btn ui-btn-ghost -ml-2.5 h-7 gap-1 px-2.5 text-xs" aria-label={`Schedule “${t.title || "Untitled task"}” for ${label}`}>
                  <CalendarPlus size={13} aria-hidden /> Schedule for {label}
                </button>
              }
            />
          ))}
        </ul>
      )}
      {tasks.length > 8 ? (
        <AppLink href="/tasks/all" className="mt-2 inline-block text-sm text-accent underline underline-offset-2">
          {t("calendar.unscheduled.more", { count: tasks.length - 8 })}
        </AppLink>
      ) : null}
    </section>
  );
}
