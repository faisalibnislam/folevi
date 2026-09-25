"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome, useShell } from "@/components/app/Shell";
import { SyncStatus } from "@/components/app/SyncStatus";
import { dueLabel, formatRelative } from "@/lib/format";

type View = "inbox" | "today" | "upcoming" | "all" | "completed" | "mine";
const VIEWS: { id: View; label: string; empty: string }[] = [
  { id: "inbox", label: "Inbox", empty: "No undated tasks. Tasks without a due date land here." },
  { id: "today", label: "Today", empty: "Nothing due today. Enjoy the quiet." },
  { id: "upcoming", label: "Upcoming", empty: "Nothing scheduled ahead." },
  { id: "all", label: "All", empty: "No open tasks." },
  { id: "completed", label: "Completed", empty: "Completed tasks appear here." },
  { id: "mine", label: "My Tasks", empty: "Nothing is assigned to you." },
];

export type TaskRow = NonNullable<ReturnType<typeof useTasks>>[number];
function useTasks(view: View) {
  const { workspace, today } = useAppState();
  return useQuery(api.tasks.list, { workspaceId: workspace.id, view, today });
}

export function TaskItem({ task, today, onToggle }: { task: TaskRow; today: string; onToggle: (t: TaskRow) => void }) {
  const overdue = task.status === "open" && task.dueDate !== null && task.dueDate < today;
  return (
    <li className="group flex items-start gap-3 px-4 py-2.5 hover:bg-surface" draggable onDragStart={(e) => e.dataTransfer.setData("application/x-folevi-task", task.blockId)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={task.status === "done"}
        aria-label={task.status === "done" ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`}
        onClick={() => onToggle(task)}
        className={`mt-0.5 grid h-[18px] w-[18px] flex-none place-items-center rounded-[5px] border-[1.5px] ${task.status === "done" ? "border-accent bg-accent text-accent-ink" : "border-line-strong hover:border-accent"}`}
      >
        {task.status === "done" ? <span className="text-[11px] leading-none">✓</span> : null}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`text-[15px] leading-snug ${task.status === "done" ? "text-muted line-through" : ""}`}>{task.title || "Untitled task"}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <AppLink href={`/d/${task.documentId}#block-${task.blockId}`} className="truncate hover:text-ink hover:underline">
            {task.documentIcon ? `${task.documentIcon} ` : ""}
            {task.documentTitle || "Untitled"}
          </AppLink>
          {task.assigneeName ? <span>· {task.assigneeName}</span> : null}
          {task.completedAt && task.status === "done" ? <span>· done {formatRelative(task.completedAt)}</span> : null}
        </p>
      </div>
      {task.priority !== "none" ? (
        <span className={`mt-0.5 rounded-[5px] px-1.5 text-[11px] font-medium ${task.priority === "high" ? "bg-coral-soft text-coral-ink" : task.priority === "medium" ? "bg-marigold-soft text-marigold-ink" : "bg-sunken text-muted"}`}>{task.priority}</span>
      ) : null}
      {task.dueDate ? (
        <span className={`mt-0.5 whitespace-nowrap text-xs ${overdue ? "font-medium text-danger" : "text-muted"}`}>
          {overdue ? "Overdue · " : ""}
          {dueLabel(task.dueDate, today)}
          {task.dueTime ? ` ${task.dueTime}` : ""}
        </span>
      ) : null}
    </li>
  );
}

export function useToggleTask() {
  const update = useMutation(api.tasks.update);
  const { deviceId } = useAppState();
  const toast = useToast();
  return (task: TaskRow) => {
    const checked = task.status !== "done";
    update({ blockId: task.blockId, checked, deviceId: deviceId ?? undefined }).then(
      () =>
        toast.show(checked ? "Task completed" : "Task reopened", {
          action: { label: "Undo", onClick: () => void update({ blockId: task.blockId, checked: !checked, deviceId: deviceId ?? undefined }) },
        }),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  };
}

export function TasksView({ view }: { view: View }) {
  const { today, workspace } = useAppState();
  const tasks = useTasks(view);
  const counts = useQuery(api.tasks.counts, { workspaceId: workspace.id, today });
  const { openQuickAdd } = useShell();
  const toggle = useToggleTask();
  const [filter, setFilter] = useState("");
  const shown = (tasks ?? []).filter((t) => !filter || t.title.toLowerCase().includes(filter.toLowerCase()) || t.documentTitle.toLowerCase().includes(filter.toLowerCase()));
  const groups = view === "upcoming" ? groupByDate(shown) : [{ key: "all", label: null as string | null, items: shown }];
  const meta = VIEWS.find((v) => v.id === view)!;

  return (
    <ViewChrome
      title={<h1 className="text-sm font-semibold">Tasks</h1>}
      tabTitle={`Tasks · ${meta.label}`}
      actions={
        <>
          <SyncStatus />
          <Button size="sm" variant="primary" onClick={openQuickAdd}>
            <Plus size={14} aria-hidden /> Add task
          </Button>
        </>
      }
    >
      <div className="mx-auto max-w-3xl px-4 pb-24 pt-6 sm:px-8">
        <h2 className="font-display text-[34px] leading-tight">{meta.label}</h2>
        <p className="text-sm text-muted">Every task lives in a document. Open its page to see the context it was written in.</p>
        <nav aria-label="Task views" className="mt-5 flex flex-wrap gap-1.5">
          {VIEWS.map((v) => {
            const count = counts && v.id !== "completed" ? counts[v.id as keyof typeof counts] : undefined;
            return (
              <AppLink
                key={v.id}
                href={`/tasks/${v.id}`}
                aria-current={v.id === view ? "page" : undefined}
                className={`inline-flex h-8 items-center gap-1.5 rounded-[7px] border px-3 text-sm ${v.id === view ? "border-ink bg-ink text-canvas" : "border-line bg-raised hover:border-line-strong"}`}
              >
                {v.label}
                {count ? <span className={`text-xs tabular-nums ${v.id === view ? "opacity-80" : "text-faint"}`}>{count}</span> : null}
              </AppLink>
            );
          })}
        </nav>
        <label className="mt-4 block">
          <span className="sr-only">Filter tasks</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by task or page" className="h-9 w-full rounded-[8px] border border-line bg-surface px-3 text-sm" />
        </label>
        {tasks === undefined ? (
          <div className="mt-6 space-y-2" aria-busy>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-[10px] bg-surface motion-reduce:animate-none" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="mt-10 text-center font-display text-2xl text-muted">{meta.empty}</p>
        ) : (
          groups.map((g) => (
            <section key={g.key} className="mt-6" aria-label={g.label ?? meta.label}>
              {g.label ? <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">{g.label}</h3> : null}
              <ul className="divide-y divide-line overflow-hidden rounded-[12px] border border-line bg-raised">
                {g.items.map((t) => (
                  <TaskItem key={t.blockId} task={t} today={today} onToggle={toggle} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </ViewChrome>
  );
}

function groupByDate(tasks: TaskRow[]) {
  const groups = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    const key = t.dueDate ?? "none";
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.entries()].map(([key, items]) => ({
    key,
    label: key === "none" ? "No date" : new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }),
    items,
  }));
}
