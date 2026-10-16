"use client";

import { useMemo, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { addDays } from "@folevi/editor-schema";
import { CalendarClock, CalendarDays, CalendarRange, Check, ChevronDown, ChevronRight, CircleCheckBig, FileText, Inbox, ListTodo, MoreHorizontal, Repeat, RotateCcw, Sun, SunMedium, UserRound } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { dueLabel } from "@/lib/format";
import { formatCalendarDate } from "@/i18n";
import { MenuButton } from "@/components/ui/Menu";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome } from "@/components/app/Shell";
import type { TaskRow } from "@/components/views/TasksView";
import { RootAvatar, RootPill } from "./RootBar";
import { SwipeRow } from "./Swipe";
import { SearchField } from "./Rows";

type View = "inbox" | "today" | "upcoming" | "all" | "completed" | "mine";

const CHIPS: { id: View; label: string; icon: ReactNode }[] = [
  { id: "inbox", label: "Inbox", icon: <Inbox size={20} strokeWidth={1.9} aria-hidden /> },
  { id: "today", label: "Today", icon: <SunMedium size={21} strokeWidth={1.9} aria-hidden /> },
  { id: "upcoming", label: "Upcoming", icon: <CalendarRange size={20} strokeWidth={1.9} aria-hidden /> },
  { id: "all", label: "All tasks", icon: <ListTodo size={21} strokeWidth={1.9} aria-hidden /> },
  { id: "mine", label: "My tasks", icon: <UserRound size={20} strokeWidth={1.9} aria-hidden /> },
  { id: "completed", label: "Completed", icon: <CircleCheckBig size={20} strokeWidth={1.9} aria-hidden /> },
];

/**
 * Tasks in the iPhone app: a large title, the views as glass chips (the chosen one names itself), and the
 * tasks grouped by the note they live in under headers that fold away (Upcoming groups by day instead). A
 * tap opens a task's details as a sheet, the box checks it off, and a swipe right completes it, left moves
 * it to tomorrow or opens its date.
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
  onToggle: (t: TaskRow) => void;
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
    const out = new Map<string, { key: string; label: string; href?: string; items: TaskRow[] }>();
    for (const t of list) {
      const byDay = view === "upcoming";
      const key = byDay ? (t.dueDate ?? "none") : t.documentId;
      const group = out.get(key);
      if (group) group.items.push(t);
      else
        out.set(key, {
          key,
          label: byDay ? (key === "none" ? "No date" : dayLabel(key, today)) : t.documentTitle || "Untitled",
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
            <nav aria-label="Task views" className="flex gap-2 overflow-x-auto px-4 pb-1 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {CHIPS.map((c) => {
                const on = c.id === view;
                const count = c.id !== "completed" ? counts?.[c.id] : undefined;
                return (
                  <AppLink
                    key={c.id}
                    href={`/tasks/${c.id}`}
                    replace
                    aria-current={on ? "page" : undefined}
                    aria-label={count && !on ? `${c.label}, ${count}` : c.label}
                    className={`flex h-11 flex-none items-center gap-1.5 rounded-capsule px-4 text-[16px] font-medium outline-none transition-[background-color,color] duration-200 focus-visible:ring-2 focus-visible:ring-focus ${on ? "bg-heading text-canvas" : "bg-[color-mix(in_oklab,var(--color-ink)_6.5%,transparent)] text-muted"}`}
                  >
                    {c.icon}
                    {on ? <span>{c.label}</span> : count ? <span className="text-[14px] tabular-nums">{count}</span> : null}
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
        <div className="space-y-3 px-5 pt-6" aria-busy aria-label="Loading tasks">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-panel bg-sunken motion-reduce:animate-none" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState icon={chip.id === "today" ? Sun : CircleCheckBig} title={filter ? "No tasks match that filter" : empty.title} body={filter ? undefined : empty.body} />
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
            <section key={g.key} aria-label={g.label} className="mt-5">
              <div className="flex items-center gap-1 pl-5 pr-3">
                {g.href ? <FileText size={18} aria-hidden className="mr-1 flex-none text-muted" /> : null}
                <h2 className="min-w-0 truncate text-[17px] font-semibold text-heading">{g.label}</h2>
                {g.href ? (
                  <MenuButton
                    label={`${g.label} options`}
                    align="start"
                    triggerClassName="grid h-9 w-9 flex-none place-items-center rounded-capsule text-faint outline-none active:bg-[var(--liquid-press)]"
                    trigger={<MoreHorizontal size={19} aria-hidden />}
                    items={[{ label: "Open note", icon: <FileText size={18} />, onSelect: () => navigate(g.href!) }]}
                  />
                ) : null}
                <span className="flex-1" />
                <button type="button" aria-expanded={!isFolded} aria-label={isFolded ? `Show ${g.label}` : `Fold ${g.label}`} onClick={toggleFold} className="grid h-11 w-11 place-items-center rounded-capsule text-faint outline-none active:bg-[var(--liquid-press)]">
                  {isFolded ? <ChevronRight size={20} aria-hidden /> : <ChevronDown size={20} aria-hidden />}
                </button>
              </div>
              {isFolded ? null : (
                <ul>
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

function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return formatCalendarDate(date, { weekday: "long", month: "long", day: "numeric" });
}

/** A task as a row: its box, its words, and a quieter line with when it's due and what else it carries. */
export function TaskLine({ task, today, onToggle, onOpen, showNote, onDay }: { task: TaskRow; today: string; onToggle: (t: TaskRow) => void; onOpen: () => void; showNote?: boolean; /** Listed under its day (the agenda): only its time, and only when overdue its date. */ onDay?: boolean }) {
  const overdue = task.status === "open" && task.dueDate !== null && task.dueDate < today;
  const closed = task.status !== "open";
  const facts = [
    task.dueDate && (!onDay || overdue) ? `${overdue ? "Overdue · " : ""}${dueLabel(task.dueDate, today)}${task.dueTime ? ` ${task.dueTime}` : ""}` : onDay && task.dueTime ? task.dueTime : null,
    showNote ? task.documentTitle || "Untitled" : null,
    task.assigneeName,
    task.priority !== "none" ? `${task.priority[0]!.toUpperCase()}${task.priority.slice(1)} priority` : null,
  ].filter(Boolean);
  return (
    <div className="flex items-start gap-3 pl-5 pr-4">
      <button
        type="button"
        role="checkbox"
        aria-checked={task.status === "done"}
        aria-label={task.status === "done" ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`}
        onClick={() => onToggle(task)}
        className="-ml-2.5 grid h-11 w-11 flex-none place-items-center outline-none"
      >
        <span
          className={`grid h-[22px] w-[22px] place-items-center rounded-chip border-[1.6px] border-solid transition-colors ${
            task.status === "done" ? "border-transparent bg-heading text-canvas" : task.status === "canceled" ? "border-line-strong bg-sunken text-faint" : "[border-color:color-mix(in_oklab,var(--color-ink)_34%,transparent)]"
          }`}
        >
          {task.status === "done" ? <Check size={15} strokeWidth={3} aria-hidden /> : task.status === "canceled" ? <span className="text-[12px] leading-none">–</span> : null}
        </span>
      </button>
      <button type="button" onClick={onOpen} className="ui-row-sep -ml-2 flex min-h-[54px] min-w-0 flex-1 flex-col justify-center py-2.5 text-left outline-none">
        <span className={`text-[17px] leading-snug ${closed ? "text-muted line-through" : "text-ink"}`}>{task.title || "Untitled task"}</span>
        {facts.length || task.repeat ? (
          <span className={`mt-0.5 flex items-center gap-1 text-[13px] ${overdue ? "text-danger" : "text-muted"}`}>
            {task.repeat ? <Repeat size={12} aria-label={task.repeat} className="flex-none" /> : null}
            <span className="truncate">{facts.join(" · ")}</span>
          </span>
        ) : null}
      </button>
    </div>
  );
}
