"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { Button, IconButton } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome } from "@/components/app/Shell";
import { SyncStatus } from "@/components/app/SyncStatus";
import { TaskItem, useToggleTask, type TaskRow } from "./TasksView";

function monthStart(month: string) {
  return `${month}-01`;
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
function weekdayOf(date: string): number {
  // Monday = 0
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (d + 6) % 7;
}

/** Month grid and agenda for dated tasks. Drag a task to a day to reschedule it (with Undo). */
export function CalendarView({ month }: { month: string | null }) {
  const { workspace, today, deviceId } = useAppState();
  const { navigate } = useAppRouter();
  const current = month ?? today.slice(0, 7);
  const [mode, setMode] = useState<"month" | "agenda">("month");
  const first = monthStart(current);
  const gridStart = addDays(first, -weekdayOf(first));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const from = mode === "month" ? days[0]! : today;
  const to = mode === "month" ? days[41]! : addDays(today, 30);
  const tasks = useQuery(api.tasks.range, { workspaceId: workspace.id, from, to, includeCompleted: true });
  const update = useMutation(api.tasks.update);
  const toast = useToast();
  const toggle = useToggleTask();
  const [selected, setSelected] = useState<string>(today);
  const gridRef = useRef<HTMLDivElement>(null);

  const byDate = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const t of tasks ?? []) if (t.dueDate) m.set(t.dueDate, [...(m.get(t.dueDate) ?? []), t]);
    return m;
  }, [tasks]);

  const reschedule = (blockId: string, date: string) => {
    const task = tasks?.find((t) => t.blockId === blockId);
    if (!task || task.dueDate === date) return;
    const previous = task.dueDate;
    update({ blockId, dueDate: date, deviceId: deviceId ?? undefined }).then(
      () =>
        toast.show(`Moved to ${new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}`, {
          action: { label: "Undo", onClick: () => void update({ blockId, dueDate: previous, deviceId: deviceId ?? undefined }) },
        }),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  };

  const monthLabel = new Date(`${first}T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }));

  const moveFocus = (date: string, delta: number) => {
    const next = addDays(date, delta);
    setSelected(next);
    if (next.slice(0, 7) !== current) navigate(`/calendar/${next.slice(0, 7)}`, { replace: true });
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus());
  };

  return (
    <ViewChrome
      title={<h1 className="text-sm font-semibold">Calendar</h1>}
      tabTitle="Calendar"
      actions={
        <>
          <SyncStatus />
          <div role="radiogroup" aria-label="Calendar layout" className="flex ui-well rounded-full p-0.5 text-xs">
            {(["month", "agenda"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`h-7 rounded-[8px] px-2.5 capitalize ${mode === m ? "bg-raised shadow-sm" : "text-muted"}`}>
                {m}
              </button>
            ))}
          </div>
        </>
      }
    >
      <div className="mx-auto max-w-[1180px] px-4 pb-24 pt-6 sm:px-8">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="ui-display text-[34px] leading-tight">{mode === "month" ? monthLabel : "Next 30 days"}</h2>
          {mode === "month" ? (
            <div className="ml-auto flex items-center gap-1">
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
          ) : null}
        </div>

        {mode === "month" ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
            <div ref={gridRef} role="grid" aria-label={monthLabel} className="overflow-hidden ui-card rounded-[18px]">
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
                    const isToday = date === today;
                    return (
                      <div
                        key={date}
                        role="gridcell"
                        aria-selected={selected === date}
                        tabIndex={selected === date ? 0 : -1}
                        data-date={date}
                        aria-label={`${new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}, ${items.length} task${items.length === 1 ? "" : "s"}`}
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
                          <span className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs tabular-nums ${isToday ? "bg-[var(--color-ember-ink)] font-semibold text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]" : inMonth ? "text-ink" : "text-faint"}`}>{Number(date.slice(8))}</span>
                        </div>
                        <ul className="mt-1 space-y-0.5">
                          {items.slice(0, 3).map((t) => (
                            <li
                              key={t.blockId}
                              draggable
                              onDragStart={(e) => e.dataTransfer.setData("application/x-folevi-task", t.blockId)}
                              className={`cursor-grab truncate rounded-[4px] px-1 text-[11.5px] leading-5 ${t.status === "done" ? "bg-sunken text-faint line-through" : "bg-accent-soft text-accent-soft-ink"}`}
                              title={t.title}
                            >
                              {t.dueTime ? `${t.dueTime} ` : ""}
                              {t.title}
                            </li>
                          ))}
                          {items.length > 3 ? <li className="px-1 text-[11px] text-muted">+{items.length - 3} more</li> : null}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <aside aria-label="Selected day">
              <h3 className="font-semibold">{new Date(`${selected}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}</h3>
              <ul className="mt-3 divide-y divide-line overflow-hidden ui-card rounded-[18px]">
                {(byDate.get(selected) ?? []).length === 0 ? <li className="px-4 py-3 text-sm text-muted">No tasks due. Drag a task here to schedule it.</li> : null}
                {(byDate.get(selected) ?? []).map((t) => (
                  <TaskItem key={t.blockId} task={t} today={today} onToggle={toggle} />
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">Tip: drag tasks between days to reschedule. Arrow keys move between days.</p>
            </aside>
          </div>
        ) : (
          <div className="space-y-6">
            {Array.from({ length: 31 }, (_, i) => addDays(today, i))
              .filter((d) => byDate.has(d) || d === today)
              .map((d) => (
                <section key={d} aria-label={d}>
                  <h3 className="mb-2 flex items-center gap-3 text-sm font-semibold">
                    {d === today ? "Today" : new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}
                  </h3>
                  <ul className="divide-y divide-line overflow-hidden ui-card rounded-[18px]">
                    {(byDate.get(d) ?? []).length === 0 ? <li className="px-4 py-3 text-sm text-muted">Nothing due.</li> : null}
                    {(byDate.get(d) ?? []).map((t) => (
                      <TaskItem key={t.blockId} task={t} today={today} onToggle={toggle} />
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </div>
    </ViewChrome>
  );
}
