"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";
import { CalendarDays, Plus, SlidersHorizontal } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome, useShell } from "@/components/app/Shell";
import { dueLabel, formatRelative } from "@/lib/format";
import { formatCalendarDate } from "@/i18n";
import { Select } from "@/components/ui/Select";

type View = "inbox" | "today" | "upcoming" | "all" | "completed" | "mine";
const VIEWS: { id: View; label: string; empty: string }[] = [
  { id: "inbox", label: "Inbox", empty: "No undated tasks. Tasks without a due date land here." },
  { id: "today", label: "Today", empty: "Nothing due today. Enjoy the quiet." },
  { id: "upcoming", label: "Upcoming", empty: "Nothing scheduled ahead." },
  { id: "all", label: "All", empty: "No open tasks." },
  { id: "completed", label: "Completed", empty: "Completed and canceled tasks appear here." },
  { id: "mine", label: "My Tasks", empty: "Nothing is assigned to you." },
];

type Priority = "none" | "low" | "medium" | "high";
const PRIORITY_LABEL: Record<Priority, string> = { none: "None", low: "Low", medium: "Medium", high: "High" };

export type TaskRow = NonNullable<ReturnType<typeof useTasks>>[number];
function useTasks(view: View) {
  const { scope, today } = useAppState();
  return useQuery(api.tasks.list, { scope, view, today });
}

export function TaskItem({ task, today, onToggle, onEdit, draggable = true, action }: { task: TaskRow; today: string; onToggle: (t: TaskRow) => void; onEdit?: (t: TaskRow) => void; draggable?: boolean; action?: ReactNode }) {
  const overdue = task.status === "open" && task.dueDate !== null && task.dueDate < today;
  const closed = task.status !== "open";
  return (
    <li className="group flex items-start gap-3 px-4 py-2.5 hover:bg-surface" draggable={draggable} onDragStart={(e) => e.dataTransfer.setData("application/x-folevi-task", task.blockId)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={task.status === "done"}
        aria-label={task.status === "done" ? `Mark “${task.title}” as not done` : task.status === "canceled" ? `Reopen canceled task “${task.title}”` : `Mark “${task.title}” as done`}
        onClick={() => onToggle(task)}
        className={`mt-0.5 grid h-[18px] w-[18px] flex-none place-items-center rounded-[6px] border-[1.5px] transition-colors ${
          task.status === "done"
            ? "border-transparent bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-moss)_82%,white),var(--color-moss))] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]"
            : task.status === "canceled"
              ? "border-line-strong bg-sunken text-faint"
              : "border-line-strong bg-surface hover:border-moss"
        }`}
      >
        {task.status === "done" ? <span className="text-[11px] leading-none">✓</span> : task.status === "canceled" ? <span className="text-[11px] leading-none">–</span> : null}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`text-[15px] leading-snug ${closed ? "text-muted line-through" : ""}`}>{task.title || "Untitled task"}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <AppLink href={`/d/${task.documentId}#block-${task.blockId}`} className="truncate hover:text-ink hover:underline">
            {task.documentIcon ? `${task.documentIcon} ` : ""}
            {task.documentTitle || "Untitled"}
          </AppLink>
          {task.assigneeName ? <span>· {task.assigneeName}</span> : null}
          {task.status === "canceled" ? <span className="rounded-[6px] bg-sunken px-1.5 text-[11px] font-medium text-muted">Canceled</span> : null}
          {task.completedAt && task.status === "done" ? <span>· done {formatRelative(task.completedAt)}</span> : null}
        </p>
        {action ? <div className="mt-1.5">{action}</div> : null}
      </div>
      {task.priority !== "none" ? (
        <span className={`mt-0.5 rounded-[6px] px-2 text-[11px] font-medium ${task.priority === "high" ? "bg-coral-soft text-coral-ink" : task.priority === "medium" ? "bg-marigold-soft text-marigold-ink" : "bg-sunken text-muted"}`}>{PRIORITY_LABEL[task.priority as Priority] ?? task.priority}</span>
      ) : null}
      {task.dueDate ? (
        <span className={`mt-0.5 whitespace-nowrap text-xs ${overdue ? "font-medium text-danger" : "text-muted"}`}>
          {overdue ? "Overdue · " : ""}
          {dueLabel(task.dueDate, today)}
          {task.dueTime ? ` ${task.dueTime}` : ""}
        </span>
      ) : null}
      {onEdit ? (
        <button
          type="button"
          onClick={() => onEdit(task)}
          aria-label={`Edit “${task.title || "Untitled task"}”: date, priority, assignee, status`}
          title="Edit task"
          className="-my-0.5 grid h-7 w-7 flex-none place-items-center rounded-[6px] text-faint opacity-0 transition-opacity hover:bg-sunken hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
        >
          <SlidersHorizontal size={14} aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

export function useToggleTask() {
  const update = useMutation(api.tasks.update);
  const { deviceId } = useAppState();
  const toast = useToast();
  return (task: TaskRow) => {
    if (task.status === "canceled") {
      update({ blockId: task.blockId, canceled: false, deviceId: deviceId ?? undefined }).then(
        () => toast.show("Task reopened", { action: { label: "Undo", onClick: () => void update({ blockId: task.blockId, canceled: true, deviceId: deviceId ?? undefined }) } }),
        (e) => toast.show(errorMessage(e), { tone: "error" }),
      );
      return;
    }
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

/** Edits a task's metadata (status, due date/time, priority, assignee) without opening its page. */
export function TaskEditDialog({ task, onClose }: { task: TaskRow | null; onClose: () => void }) {
  return (
    <Dialog open={task !== null} onClose={onClose} title="Edit task" size="sm">
      {task ? <TaskEditForm key={task.blockId} task={task} onClose={onClose} /> : null}
    </Dialog>
  );
}

function TaskEditForm({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const { workspace, profile, deviceId } = useAppState();
  const members = useQuery(api.workspaces.members, workspace ? { workspaceId: workspace.id } : "skip");
  // Personal has no members: its tasks are yours (a guest on a page can still be the assignee already set).
  const people = workspace ? members?.members : [{ profileId: profile.id, displayName: profile.displayName, isYou: true }];
  const update = useMutation(api.tasks.update);
  const toast = useToast();
  const [status, setStatus] = useState(task.status);
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [dueTime, setDueTime] = useState(task.dueTime ?? "");
  const [priority, setPriority] = useState<Priority>((task.priority as Priority) ?? "none");
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <p className="-mt-2 mb-4 text-sm text-muted">{task.title || "Untitled task"}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError(null);
          const args: Parameters<typeof update>[0] = { blockId: task.blockId, deviceId: deviceId ?? undefined };
          if (status !== task.status) {
            if (status === "canceled") args.canceled = true;
            else if (status === "done") args.checked = true;
            else if (task.status === "canceled") args.canceled = false;
            else args.checked = false;
          }
          if ((dueDate || null) !== task.dueDate) args.dueDate = dueDate || null;
          const time = dueDate ? dueTime || null : null;
          if (time !== task.dueTime) args.dueTime = time;
          if (priority !== task.priority) args.priority = priority;
          if ((assigneeId || null) !== task.assigneeId) args.assigneeId = assigneeId || null;
          try {
            await update(args);
            toast.show("Task updated", { tone: "success" });
            onClose();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
        className="grid gap-4"
      >
        <fieldset>
          <legend className="text-sm font-medium">Status</legend>
          <div className="ui-seg ui-well mt-2 w-fit">
            {(["open", "done", "canceled"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className="!min-h-8 !text-[13px]">
                {s === "open" ? "Open" : s === "done" ? "Done" : "Canceled"}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            <span className="block text-muted">Due date</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 h-9 ui-input rounded-[6px] px-2" />
          </label>
          {dueDate ? (
            <label className="text-sm">
              <span className="block text-muted">Time (optional)</span>
              <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="mt-1 h-9 ui-input rounded-[6px] px-2" />
            </label>
          ) : null}
          {dueDate ? (
            <Button size="sm" variant="quiet" className="self-end" onClick={() => { setDueDate(""); setDueTime(""); }}>
              Clear date
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            <span className="block text-muted">Priority</span>
            <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="mt-1 h-9 ui-input rounded-[6px] px-3">
              {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </label>
          <label className="min-w-0 flex-1 text-sm">
            <span className="block text-muted">Assignee</span>
            <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="mt-1 h-9 w-full ui-input rounded-[6px] px-3">
              <option value="">Unassigned</option>
              {people?.map((m) => (
                <option key={m.profileId} value={m.profileId}>
                  {m.displayName}
                  {m.isYou ? " (you)" : ""}
                </option>
              ))}
              {task.assigneeId && people && !people.some((m) => m.profileId === task.assigneeId) ? <option value={task.assigneeId}>{task.assigneeName ?? "Former member"}</option> : null}
            </Select>
          </label>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <AppLink href={`/d/${task.documentId}#block-${task.blockId}`} onClick={onClose} className="mr-auto text-sm text-accent underline underline-offset-2">
            Open in {task.documentTitle || "Untitled"}
          </AppLink>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" aria-busy={busy || undefined}>
            Save
          </Button>
        </div>
      </form>
    </>
  );
}

export function TasksView({ view }: { view: View }) {
  const { today, scope, context } = useAppState();
  const tasks = useTasks(view);
  const counts = useQuery(api.tasks.counts, { scope, today });
  const { openQuickAdd } = useShell();
  const toggle = useToggleTask();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const shown = (tasks ?? []).filter((t) => !filter || t.title.toLowerCase().includes(filter.toLowerCase()) || t.documentTitle.toLowerCase().includes(filter.toLowerCase()));
  const groups = view === "upcoming" ? groupByDate(shown) : [{ key: "all", label: null as string | null, items: shown }];
  const meta = VIEWS.find((v) => v.id === view)!;
  const empty = view === "mine" && context.kind === "personal" ? "No open tasks. In Personal every unassigned task is yours." : meta.empty;

  return (
    <ViewChrome
      title={<h1 className="text-sm font-semibold">Tasks</h1>}
      subtitle={`${meta.label}${tasks === undefined ? "" : ` · ${shown.length} ${view === "completed" ? "done" : "open"}`}`}
      tabTitle={`Tasks · ${meta.label}`}
      actions={
        <>
          <AppLink href="/calendar" className="ui-btn ui-btn-secondary h-8 gap-1.5 px-3 text-sm">
            <CalendarDays size={14} aria-hidden /> Calendar
          </AppLink>
          <Button size="sm" variant="primary" onClick={openQuickAdd}>
            <Plus size={14} aria-hidden /> Add task
          </Button>
        </>
      }
    >
      <div className="mx-auto max-w-3xl px-4 pb-24 pt-3 sm:px-8">
        <nav aria-label="Task views" className="ui-seg ui-well flex-wrap sm:flex-nowrap" title="Every task lives in a note — open its page to see the context it was written in.">
          {VIEWS.map((v) => {
            const count = counts && v.id !== "completed" ? counts[v.id as keyof typeof counts] : undefined;
            return (
              <AppLink
                key={v.id}
                href={`/tasks/${v.id}`}
                aria-current={v.id === view ? "page" : undefined}
                data-active={v.id === view}
                className="!min-h-8 !text-[13px]"
              >
                {v.label}
                {count ? <span className={`rounded-[6px] px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums ${v.id === view ? "bg-heading text-canvas" : "text-[var(--color-ink-faint)]"}`}>{count}</span> : null}
              </AppLink>
            );
          })}
        </nav>
        <label className="mt-4 block">
          <span className="sr-only">Filter tasks</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by task or page" className="h-9 w-full ui-input rounded-[6px] px-3 text-sm" />
        </label>
        {tasks === undefined ? (
          <div className="mt-6 space-y-2" aria-busy>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-[6px] bg-surface motion-reduce:animate-none" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="mt-10 text-center ui-display text-2xl text-muted">{filter ? "No tasks match that filter." : empty}</p>
        ) : (
          groups.map((g) => (
            <section key={g.key} className="mt-6" aria-label={g.label ?? meta.label}>
              {g.label ? <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">{g.label}</h3> : null}
              <ul className="divide-y divide-line overflow-hidden ui-card rounded-[8px]">
                {g.items.map((t) => (
                  <TaskItem key={t.blockId} task={t} today={today} onToggle={toggle} onEdit={setEditing} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <TaskEditDialog task={editing} onClose={() => setEditing(null)} />
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
    label: key === "none" ? "No date" : formatCalendarDate(key, { weekday: "long", month: "long", day: "numeric" }),
    items,
  }));
}
