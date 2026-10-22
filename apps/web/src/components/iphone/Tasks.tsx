"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { addDays } from "@folevi/editor-schema";
import { CalendarClock, CalendarDays, Check, ChevronDown, ChevronRight, CircleCheckBig, FileText, Inbox, ListTodo, Repeat, RotateCcw, Sun, SunMedium, UserRound, type LucideIcon } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { dueLabel } from "@/lib/format";
import { formatCalendarDate } from "@/i18n";
import { feel } from "@/lib/native/ui";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome } from "@/components/app/Shell";
import type { TaskRow } from "@/components/views/TasksView";
import { RootAvatar, RootPill } from "./RootBar";
import { SwipeRow } from "./Swipe";
import { SearchField } from "./Rows";

type View = "inbox" | "today" | "upcoming" | "all" | "completed" | "mine";

const CHIPS: { id: View; label: string; short: string; Icon: LucideIcon }[] = [
  { id: "today", label: "Today", short: "Today", Icon: SunMedium },
  { id: "inbox", label: "Inbox", short: "Inbox", Icon: Inbox },
  { id: "upcoming", label: "Upcoming", short: "Upcoming", Icon: CalendarDays },
  { id: "all", label: "All tasks", short: "All", Icon: ListTodo },
  { id: "mine", label: "My tasks", short: "Mine", Icon: UserRound },
  { id: "completed", label: "Completed", short: "Done", Icon: CircleCheckBig },
];

/** How long a checked task stays in its list, ticked, before it goes (as in Reminders). */
const CHECK_HOLD_MS = 420;

/**
 * Tasks in the iPhone app: a large title, the views as a scrolling row of capsules (icon, name and count;
 * the chosen one filled), and the tasks grouped by the note they live in under headers that fold away
 * (Upcoming groups by day instead). A tap opens a task's details as a sheet, the box checks it off (it
 * fills and ticks, then the task leaves the list), a swipe right completes it, left moves it to tomorrow or
 * opens its date.
 */
export function IphoneTasks({
  view,
  tasks,
  counts,
  filter,
  onFilter,
  onToggle,
  onEdit,
  empty,
  children,
}: {
  view: View;
  tasks: TaskRow[] | undefined;
  counts: Partial<Record<View, number>> | undefined;
  filter: string;
  onFilter: (v: string) => void;
  onToggle: (t: TaskRow, opts?: { felt?: boolean }) => void;
  onEdit: (t: TaskRow) => void;
  empty: { title: string; body?: string };
  children?: ReactNode;
}) {
  const { today, deviceId } = useAppState();
  const { navigate } = useAppRouter();
  const update = useMutation(api.tasks.update);
  const toast = useToast();
  const [folded, setFolded] = useLocalStorage<Record<string, true>>("folevi:iphone-tasks-folded", {});
  const chip = CHIPS.find((c) => c.id === view)!;

  const groups = useMemo(() => {
    const list = tasks ?? [];
    const out = new Map<string, { key: string; label: string; detail?: string; href?: string; items: TaskRow[] }>();
    for (const t of list) {
      const byDay = view === "upcoming";
      const key = byDay ? (t.dueDate ?? "none") : t.documentId;
      const group = out.get(key);
      if (group) group.items.push(t);
      else
        out.set(key, {
          key,
          label: byDay ? (key === "none" ? "No date" : dayLabel(key, today).name) : t.documentTitle || "Untitled",
          detail: byDay && key !== "none" ? dayLabel(key, today).date : undefined,
          href: byDay ? undefined : `/d/${t.documentId}`,
          items: [t],
        });
    }
    return [...out.values()];
  }, [tasks, view, today]);

  const moveTo = (t: TaskRow, date: string, label: string) => {
    const previous = { dueDate: t.dueDate, dueTime: t.dueTime };
    const device = deviceId ?? undefined;
    update({ blockId: t.blockId, dueDate: date, deviceId: device }).then(
      () => toast.show(`Moved to ${label}`, { action: { label: "Undo", onClick: () => void update({ blockId: t.blockId, dueDate: previous.dueDate, dueTime: previous.dueDate ? previous.dueTime : null, deviceId: device }) } }),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  };

  // The chosen view's capsule is kept in sight when the row scrolls (Completed sits at its far end).
  const chipsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const row = chipsRef.current;
    const on = row?.querySelector<HTMLElement>("[aria-current=page]");
    if (!row || !on) return;
    const left = on.offsetLeft - 16;
    const right = on.offsetLeft + on.offsetWidth + 16 - row.clientWidth;
    if (row.scrollLeft > left) row.scrollLeft = left;
    else if (row.scrollLeft < right) row.scrollLeft = right;
  }, [view]);

  return (
    <ViewChrome
      title="Tasks"
      tabTitle={`Tasks · ${chip.label}`}
      iphone={{
        title: "Tasks",
        root: true,
        leading: <RootAvatar />,
        trailing: (
          <RootPill
            more={[
              { label: "Calendar", icon: <CalendarDays size={18} />, onSelect: () => navigate("/calendar") },
              { label: "Completed tasks", icon: <CircleCheckBig size={18} />, onSelect: () => navigate("/tasks/completed") },
            ]}
          />
        ),
        header: (
          <>
            {/* 44 pt tall links around 34 pt capsules: the row reads light, the targets stay full size. */}
            <nav ref={chipsRef} aria-label="Task views" className="flex gap-2 overflow-x-auto scroll-px-4 px-4 pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {CHIPS.map(({ id, label, short, Icon }) => {
                const on = id === view;
                const count = id !== "completed" ? counts?.[id] : undefined;
                return (
                  <AppLink
                    key={id}
                    href={`/tasks/${id}`}
                    replace
                    data-iphone-tappable=""
                    aria-current={on ? "page" : undefined}
                    aria-label={count ? `${label}, ${count}` : label}
                    onClick={() => {
                      if (!on) feel("choose");
                    }}
                    className="group flex h-11 flex-none items-center outline-none"
                  >
                    <span
                      className={`flex min-h-[34px] items-center gap-1.5 rounded-capsule py-1 pl-3 pr-3.5 text-[15px] font-medium leading-5 transition-[background-color,color,transform] duration-200 group-active:scale-[0.96] group-focus-visible:ring-2 group-focus-visible:ring-focus motion-reduce:transition-none ${
                        on ? "bg-heading text-canvas" : "bg-[color-mix(in_oklab,var(--color-ink)_6.5%,transparent)] text-ink"
                      }`}
                    >
                      <Icon size={17} strokeWidth={2} aria-hidden className={on ? "" : "text-muted"} />
                      <span>{short}</span>
                      {count ? <span className={`tabular-nums ${on ? "opacity-70" : "text-muted"}`}>{count}</span> : null}
                    </span>
                  </AppLink>
                );
              })}
            </nav>
            <SearchField placeholder="Filter by task or note" value={filter} onChange={onFilter} />
          </>
        ),
      }}
    >
      {tasks === undefined ? (
        <ul className="pt-3" aria-busy aria-label="Loading tasks">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex h-[52px] items-center gap-3 pl-5 pr-4">
              <span className="h-[22px] w-[22px] flex-none animate-pulse rounded-chip bg-sunken motion-reduce:animate-none" />
              <span className="h-4 flex-1 animate-pulse rounded-chip bg-sunken motion-reduce:animate-none" style={{ maxWidth: `${80 - i * 9}%` }} />
            </li>
          ))}
        </ul>
      ) : tasks.length === 0 ? (
        <PhoneEmpty Icon={chip.id === "today" ? Sun : CircleCheckBig} title={filter ? "No tasks match that filter" : empty.title} body={filter ? undefined : empty.body} />
      ) : (
        groups.map((g) => {
          const isFolded = Boolean(folded[`${view}:${g.key}`]);
          const toggleFold = () =>
            setFolded((all) => {
              const next = { ...all };
              const k = `${view}:${g.key}`;
              if (next[k]) delete next[k];
              else next[k] = true;
              return next;
            });
          return (
            <section key={g.key} aria-label={g.detail ? `${g.label}, ${g.detail}` : g.label} className="mt-4">
              <GroupHeader label={g.label} detail={g.detail} href={g.href} count={isFolded ? g.items.length : undefined} folded={isFolded} onFold={toggleFold} />
              {isFolded ? null : (
                <ul data-iphone-tappable="">
                  {g.items.map((t) => (
                    <li key={t.blockId}>
                      <SwipeRow
                        leading={[
                          t.status === "open"
                            ? { label: "Done", icon: <Check />, tone: "#3f7d58", onAction: () => onToggle(t) }
                            : { label: "Reopen", icon: <RotateCcw />, tone: "#6b6b73", onAction: () => onToggle(t) },
                        ]}
                        trailing={
                          t.status === "open"
                            ? [
                                { label: "Tomorrow", icon: <SunMedium />, tone: "#c58a12", onAction: () => moveTo(t, addDays(today, 1), "tomorrow") },
                                { label: "Date", icon: <CalendarClock />, tone: "#5b6ad0", onAction: () => onEdit(t) },
                              ]
                            : []
                        }
                      >
                        <TaskLine task={t} today={today} onToggle={onToggle} onOpen={() => onEdit(t)} showNote={view === "upcoming"} onDay={view === "today" || view === "upcoming"} />
                      </SwipeRow>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
      {children}
    </ViewChrome>
  );
}

/**
 * A group's header: the note's name (a link to it) or the day, and a chevron that folds the group (it
 * turns as it folds; a folded group shows how many tasks it holds).
 */
function GroupHeader({ label, detail, href, count, folded, onFold }: { label: string; detail?: string; href?: string; count?: number; folded: boolean; onFold: () => void }) {
  // (A day's header is the Calendar's: the day in the heading's weight, its date muted beside it.)
  const title = (
    <h2 className="min-w-0 truncate text-[17px] leading-[22px]">
      <span className="font-semibold text-heading">{label}</span>
      {detail ? <span className="text-muted"> · {detail}</span> : null}
    </h2>
  );
  return (
    <div className="flex min-h-11 items-center pl-5 pr-2">
      {href ? (
        <AppLink href={href} data-iphone-tappable="" aria-label={`Open ${label}`} className="flex min-h-11 min-w-0 items-center gap-1.5 outline-none active:opacity-60 focus-visible:underline">
          <FileText size={17} strokeWidth={2} aria-hidden className="flex-none text-muted" />
          {title}
          <ChevronRight size={15} strokeWidth={2.4} aria-hidden className="flex-none text-faint" />
        </AppLink>
      ) : (
        title
      )}
      <span className="flex-1" />
      {count ? <span className="pr-0.5 text-[15px] tabular-nums text-muted">{count}</span> : null}
      <button type="button" aria-expanded={!folded} aria-label={folded ? `Show ${label}` : `Fold ${label}`} onClick={onFold} className="grid h-11 w-11 place-items-center rounded-capsule text-faint outline-none active:bg-[var(--liquid-press)] focus-visible:ring-2 focus-visible:ring-focus">
        <ChevronDown size={18} strokeWidth={2.4} aria-hidden className={`transition-transform duration-200 motion-reduce:transition-none ${folded ? "-rotate-90" : ""}`} />
      </button>
    </div>
  );
}

/** A whole screen with nothing on it: an icon, a short title and one line, centred (docs/IOS_POLISH_PLAN.md 2.1). */
export function PhoneEmpty({ Icon, title, body, action }: { Icon?: LucideIcon; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div data-empty-state="" className="mx-auto flex w-[280px] max-w-full flex-col items-center px-2 pt-[14vh] text-center">
      {Icon ? <Icon size={44} strokeWidth={1.5} aria-hidden className="mb-3 text-faint" /> : null}
      <h2 className="text-[17px] font-semibold leading-[22px] text-heading">{title}</h2>
      {body ? <p className="mt-1 text-[15px] leading-5 text-muted">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** A day's header in Upcoming: "Tomorrow" and "Friday, Oct 23", or "Saturday" and "Oct 24" (as in the Calendar). */
function dayLabel(date: string, today: string): { name: string; date: string } {
  if (date === today) return { name: "Today", date: formatCalendarDate(date, { weekday: "long", month: "short", day: "numeric" }) };
  if (date === addDays(today, 1)) return { name: "Tomorrow", date: formatCalendarDate(date, { weekday: "long", month: "short", day: "numeric" }) };
  return { name: formatCalendarDate(date, { weekday: "long" }), date: formatCalendarDate(date, { month: "short", day: "numeric", ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) }) };
}

/**
 * Folevi's rounded-square task box at the iPhone's size (22 pt, a 1.5 pt edge): checking it fills the box
 * and draws the tick in 180 ms; Reduce Motion makes it appear at once.
 */
export function TaskBox({ status }: { status: "open" | "done" | "canceled" }) {
  const done = status === "done";
  return (
    <span className="relative grid h-[22px] w-[22px] place-items-center">
      <span
        aria-hidden
        className={`absolute inset-0 rounded-chip border-[1.5px] border-solid transition-[background-color,border-color,transform] duration-[180ms] ease-out motion-reduce:transition-none ${
          done ? "scale-100 border-transparent bg-heading" : status === "canceled" ? "border-line-strong bg-sunken" : "[border-color:color-mix(in_oklab,var(--color-ink)_34%,transparent)] bg-transparent"
        }`}
      />
      {status === "canceled" ? (
        <span aria-hidden className="relative h-[1.5px] w-2.5 rounded-tiny bg-faint" />
      ) : (
        <svg aria-hidden viewBox="0 0 22 22" className="relative h-[22px] w-[22px] text-canvas">
          <path
            d="M6.4 11.6 9.6 14.7 15.8 7.9"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={15}
            strokeDashoffset={done ? 0 : 15}
            className="transition-[stroke-dashoffset] delay-[60ms] duration-[180ms] ease-out motion-reduce:transition-none"
          />
        </svg>
      )}
    </span>
  );
}

/** A task as a row: its box, its words, and a quieter line with when it's due and what else it carries. */
export function TaskLine({
  task,
  today,
  onToggle,
  onOpen,
  showNote,
  onDay,
}: {
  task: TaskRow;
  today: string;
  onToggle: (t: TaskRow, opts?: { felt?: boolean }) => void;
  onOpen: () => void;
  showNote?: boolean;
  /** Listed under its day (the agenda): only its time, and only when overdue its date. */
  onDay?: boolean;
}) {
  // Checked here first: the box fills and ticks at once, and the task leaves the list a moment later.
  const [pending, setPending] = useState<TaskRow["status"] | null>(null);
  useEffect(() => setPending(null), [task.status]);
  const status = pending ?? task.status;
  const overdue = status === "open" && task.dueDate !== null && task.dueDate < today;
  const closed = status !== "open";
  const facts = [
    task.dueDate && (!onDay || overdue) ? `${overdue ? "Overdue · " : ""}${dueLabel(task.dueDate, today)}${task.dueTime ? ` ${task.dueTime}` : ""}` : onDay && task.dueTime ? task.dueTime : null,
    showNote ? task.documentTitle || "Untitled" : null,
    task.assigneeName,
    task.priority !== "none" ? `${task.priority[0]!.toUpperCase()}${task.priority.slice(1)} priority` : null,
  ].filter(Boolean);
  const twoLines = facts.length > 0 || Boolean(task.repeat);
  const toggle = () => {
    if (pending) return;
    if (task.status === "open") {
      setPending("done");
      feel("check");
      window.setTimeout(() => onToggle(task, { felt: true }), CHECK_HOLD_MS);
    } else {
      setPending("open");
      onToggle(task);
    }
  };
  return (
    <div className="flex items-start gap-3 pl-5 pr-4">
      <button
        type="button"
        role="checkbox"
        aria-checked={status === "done"}
        aria-label={status === "done" ? `Mark “${task.title}” as not done` : status === "canceled" ? `Reopen canceled task “${task.title}”` : `Mark “${task.title}” as done`}
        onClick={toggle}
        className={`-ml-[11px] ${twoLines ? "mt-0" : "mt-1"} grid h-11 w-11 flex-none place-items-center rounded-capsule outline-none focus-visible:ring-2 focus-visible:ring-focus`}
      >
        <TaskBox status={status} />
      </button>
      <button type="button" onClick={onOpen} className={`ui-row-sep -ml-[11px] flex min-w-0 flex-1 flex-col justify-center text-left outline-none ${twoLines ? "min-h-16 py-2.5" : "min-h-[52px] py-[15px]"}`}>
        <span className={`text-[17px] leading-[22px] transition-colors duration-[250ms] motion-reduce:transition-none ${closed ? "text-muted line-through decoration-[color-mix(in_oklab,var(--color-ink)_30%,transparent)]" : "text-ink"}`}>{task.title || "Untitled task"}</span>
        {twoLines ? (
          <span className={`mt-0.5 flex items-center gap-1 text-[15px] leading-5 ${overdue ? "text-danger" : "text-muted"}`}>
            {task.repeat ? <Repeat size={13} strokeWidth={2.2} aria-label={task.repeat} className="flex-none" /> : null}
            <span className="truncate">{facts.join(" · ")}</span>
          </span>
        ) : null}
      </button>
    </div>
  );
}
