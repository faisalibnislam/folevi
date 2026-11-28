"use client";

import { DateField, TimeField } from "@/components/ui/DateField";
import { useMutation } from "convex/react";
import { useQuery } from "@/lib/convex/queries";
import { useCachedQuery, useOfflineQuery } from "@/lib/sync/queryCache";
import { useCallback, useDeferredValue, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRightLeft, CalendarDays, Check, FileText, Flag, Funnel, Minus, Plus, Repeat, RotateCcw, SlidersHorizontal, SquareCheckBig, X } from "lucide-react";
import { DocumentPicker, type Target } from "@/components/app/QuickAddTask";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { ContextMenu } from "@/components/ui/Menu";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome, useShell } from "@/components/app/Shell";
import { dueLabel, formatRelative } from "@/lib/format";
import { formatCalendarDate } from "@/i18n";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadFailed } from "@/components/ui/LoadFailed";
import { haptic } from "@/lib/nativeApp";
import { useIphoneApp } from "@/lib/iphone";
import { IphoneTasks, IphoneTaskSheet } from "@/components/iphone/lazy";
import { useKeyLabels } from "@/lib/shortcuts";
import { taskUpdated, useOptimisticMutation } from "@/lib/convex/optimistic";

type View = "inbox" | "today" | "upcoming" | "all" | "completed" | "mine";
const VIEWS: { id: View; label: string; empty: { title: string; body?: string } }[] = [
  { id: "inbox", label: "Inbox", empty: { title: "No undated tasks", body: "Tasks without a due date land here." } },
  { id: "today", label: "Today", empty: { title: "Nothing due today" } },
  { id: "upcoming", label: "Upcoming", empty: { title: "Nothing scheduled ahead" } },
  { id: "all", label: "All", empty: { title: "No open tasks" } },
  { id: "completed", label: "Completed", empty: { title: "Nothing completed yet", body: "Completed and canceled tasks appear here." } },
  { id: "mine", label: "My tasks", empty: { title: "Nothing is assigned to you" } },
];

type Priority = "none" | "low" | "medium" | "high";
const PRIORITY_LABEL: Record<Priority, string> = { none: "None", low: "Low", medium: "Medium", high: "High" };

export type TaskRow = NonNullable<ReturnType<typeof useTasks>["data"]>[number];
// Kept per view on the device, so a visit (or a chip tap back to a view seen before) draws its rows at once.
function useTasks(view: View) {
  const { scope, today } = useAppState();
  return useCachedQuery(api.tasks.list, { scope, view, today });
}

/** Moves a task (its to-do) to the end of another page, or to the Inbox page. */
function MoveTaskDialog({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const { scope, deviceId } = useAppState();
  const move = useMutation(api.tasks.moveToDocument);
  const toast = useToast();
  const [target, setTarget] = useState<Target>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} title="Move task" description={`Move “${task.title || "Untitled task"}” to the end of another page.`} size="sm">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await move({ blockId: task.blockId, documentId: target?.id, deviceId: deviceId ?? undefined });
            toast.show(`Task moved to ${target ? target.title || "Untitled" : "Inbox"}`, { tone: "success" });
            onClose();
          } catch (err) {
            toast.show(errorMessage(err), { tone: "error" });
          } finally {
            setBusy(false);
          }
        }}
      >
        <DocumentPicker scope={scope} value={target} onChange={setTarget} label="Move to" exclude={task.documentId} />
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" aria-busy={busy || undefined}>
            Move
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function TaskItem({ task, today, onToggle, onEdit, draggable = true, action }: { task: TaskRow; today: string; onToggle: (t: TaskRow) => void; onEdit?: (t: TaskRow) => void; draggable?: boolean; action?: ReactNode }) {
  const overdue = task.status === "open" && task.dueDate !== null && task.dueDate < today;
  const closed = task.status !== "open";
  const { navigate } = useAppRouter();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const noteHref = `/d/${task.documentId}#block-${task.blockId}`;
  return (
    // A row as Reminders draws it (the owner, 28 November 2026: "vastly improve"): a round check, the task, then one
    // quiet line with its due date (red when late), repeat and the note it lives in; priority is a small flag.
    // Hairlines start at the text, like the note lists; no card round the list.
    <li
      className="group flex items-start gap-3 rounded-chip px-3 transition-colors hover:bg-[var(--glass-hover)] [&:last-child_[data-task-body]]:border-b-transparent"
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData("application/x-folevi-task", task.blockId)}
      onContextMenu={(e) => {
        if (e.shiftKey) return;
        e.preventDefault();
        setMenuAt({ x: e.clientX, y: e.clientY });
      }}
    >
      {menuAt ? (
        <ContextMenu
          at={menuAt}
          label="Task options"
          onClose={() => setMenuAt(null)}
          items={[
            task.status === "open"
              ? { label: "Mark as done", icon: <Check size={14} />, onSelect: () => onToggle(task) }
              : { label: task.status === "canceled" ? "Reopen" : "Mark as not done", icon: <RotateCcw size={14} />, onSelect: () => onToggle(task) },
            ...(onEdit ? [{ label: "Edit task…", icon: <SlidersHorizontal size={14} />, onSelect: () => onEdit(task) }] : []),
            { label: "Move to…", icon: <ArrowRightLeft size={14} />, onSelect: () => setMoving(true) },
            "separator",
            { label: "Open note", icon: <FileText size={14} />, onSelect: () => navigate(noteHref) },
          ]}
        />
      ) : null}
      {moving ? <MoveTaskDialog task={task} onClose={() => setMoving(false)} /> : null}
      <button
        type="button"
        role="checkbox"
        aria-checked={task.status === "done"}
        aria-label={task.status === "done" ? `Mark “${task.title}” as not done` : task.status === "canceled" ? `Reopen canceled task “${task.title}”` : `Mark “${task.title}” as done`}
        title={task.status === "done" ? "Mark as not done" : task.status === "canceled" ? "Reopen" : "Mark as done"}
        onClick={() => onToggle(task)}
        className={`group/check relative mt-3 grid size-5 flex-none place-items-center rounded-control border-[1.5px] transition-colors before:absolute before:-inset-1.5 before:content-[''] ${
          task.status === "done"
            ? "border-transparent bg-[var(--color-moss)] text-white"
            : task.status === "canceled"
              ? "border-line-strong bg-sunken text-faint"
              : `bg-surface hover:border-[var(--color-moss)] ${overdue ? "border-[color-mix(in_oklab,var(--color-danger)_55%,var(--color-line-strong))]" : "border-line-strong"}`
        }`}
      >
        {task.status === "done" ? (
          <Check size={12} strokeWidth={3} aria-hidden />
        ) : task.status === "canceled" ? (
          <Minus size={12} aria-hidden />
        ) : (
          <Check size={12} aria-hidden className="text-[var(--color-moss)] opacity-0 transition-opacity group-hover/check:opacity-100" />
        )}
      </button>
      <div data-task-body="" className="flex min-w-0 flex-1 items-start gap-3 border-b border-[var(--color-line)] py-2.5">
      <div className="min-w-0 flex-1">
        <p className={`text-body leading-[22px] text-ink ${closed ? "text-muted line-through" : ""}`}>
          {task.title || "Untitled task"}
          {task.priority !== "none" ? (
            <Flag
              size={12}
              aria-label={`${PRIORITY_LABEL[task.priority as Priority] ?? task.priority} priority`}
              className={`ml-2 inline-block -translate-y-px fill-current ${task.priority === "high" ? "text-[var(--color-coral-ink)]" : task.priority === "medium" ? "text-[var(--color-marigold-ink)]" : "text-faint"}`}
            />
          ) : null}
        </p>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-footnote text-muted">
          {task.dueDate ? (
            <span className={`whitespace-nowrap tabular-nums ${overdue ? "font-medium text-danger" : ""}`}>
              {dueLabel(task.dueDate, today)}
              {task.dueTime ? ` ${task.dueTime}` : ""}
            </span>
          ) : null}
          {task.repeat ? <Repeat size={11} aria-label={task.repeat} className="flex-none" /> : null}
          {task.dueDate || task.repeat ? <span aria-hidden className="text-faint">·</span> : null}
          <AppLink href={noteHref} className="-my-1 inline-flex min-w-0 items-center gap-1 py-1 hover:text-ink hover:underline">
            <FileText size={12} aria-hidden className="flex-none" />
            <span className="truncate">{task.documentTitle || "Untitled"}</span>
          </AppLink>
          {task.assigneeName ? (
            <>
              <span aria-hidden>·</span>
              <span>{task.assigneeName}</span>
            </>
          ) : null}
          {task.status === "canceled" ? <span className="rounded-chip bg-sunken px-1.5 text-caption-2 font-medium text-muted">Canceled</span> : null}
          {task.completedAt && task.status === "done" ? (
            <>
              <span aria-hidden>·</span>
              <span>done {formatRelative(task.completedAt)}</span>
            </>
          ) : null}
        </p>
        {action ? <div className="mt-1.5">{action}</div> : null}
      </div>
      {onEdit ? (
        <button
          type="button"
          onClick={() => onEdit(task)}
          aria-label={`Edit “${task.title || "Untitled task"}”: date, priority, assignee, status`}
          title="Edit task"
          className="-my-0.5 grid h-7 w-7 flex-none place-items-center rounded-chip text-faint opacity-0 transition-opacity hover:bg-sunken hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
        >
          <SlidersHorizontal size={14} aria-hidden />
        </button>
      ) : null}
      </div>
    </li>
  );
}

export function useToggleTask() {
  const update = useOptimisticMutation(api.tasks.update, taskUpdated);
  const { deviceId } = useAppState();
  const toast = useToast();
  // `felt`: the caller already gave the tap in the hand (the iPhone's box, as it fills).
  return (task: TaskRow, opts?: { felt?: boolean }) => {
    if (task.status === "canceled") {
      update({ blockId: task.blockId, canceled: false, deviceId: deviceId ?? undefined }).then(
        () => toast.show("Task reopened", { action: { label: "Undo", onClick: () => void update({ blockId: task.blockId, canceled: true, deviceId: deviceId ?? undefined }) } }),
        (e) => toast.show(errorMessage(e), { tone: "error" }),
      );
      return;
    }
    const checked = task.status !== "done";
    if (checked && !opts?.felt) haptic("light");
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
  const update = useOptimisticMutation(api.tasks.update, taskUpdated);
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
      <p className="ui-task-title -mt-2 mb-4 text-subheadline text-muted">{task.title || "Untitled task"}</p>
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
          <legend className="text-subheadline font-medium">Status</legend>
          <div className="ui-seg ui-well mt-2 w-fit">
            {(["open", "done", "canceled"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className="!min-h-8 !text-subheadline">
                {s === "open" ? "Open" : s === "done" ? "Done" : "Canceled"}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <div className="text-subheadline">
            <span className="block text-muted">Due date</span>
            <DateField value={dueDate} onChange={setDueDate} clearable={false} aria-label="Due date" size="lg" className="mt-1 w-44" />
          </div>
          {dueDate ? (
            <div className="text-subheadline">
              <span className="block text-muted">Time (optional)</span>
              <TimeField value={dueTime} onChange={setDueTime} emptyLabel="All day" aria-label="Due time" size="lg" className="mt-1 w-32" />
            </div>
          ) : null}
          {dueDate ? (
            <Button variant="quiet" className="self-end" onClick={() => { setDueDate(""); setDueTime(""); }}>
              Clear date
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="text-subheadline">
            <span className="block text-muted">Priority</span>
            <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="mt-1 h-control ui-input px-3">
              {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </label>
          <label className="min-w-0 flex-1 text-subheadline">
            <span className="block text-muted">Assignee</span>
            <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="mt-1 h-control w-full ui-input px-3">
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
          <p role="alert" className="text-subheadline text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <AppLink href={`/d/${task.documentId}#block-${task.blockId}`} onClick={onClose} className="mr-auto text-subheadline text-accent underline underline-offset-2">
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
  const keys = useKeyLabels();
  const { today, scope, context } = useAppState();
  const tasksState = useTasks(view);
  const tasks = tasksState.data;
  // The list failed (it keeps retrying): said in place of the loading rows.
  const failed = tasks === undefined && tasksState.failed ? tasksState.retry : undefined;
  const counts = useOfflineQuery(api.tasks.counts, { scope, today });
  const { openQuickAdd } = useShell();
  const toggle = useToggleTask();
  // The rows are memoized below, so they need a toggle that keeps its identity between renders.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const onToggle = useCallback((t: TaskRow, opts?: { felt?: boolean }) => toggleRef.current(t, opts), []);
  const meta = VIEWS.find((v) => v.id === view)!;
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  // Typing in the filter stays immediate; the list (up to a thousand rows) catches up when React has time.
  const query = useDeferredValue(filter);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const shown = useMemo(() => {
    const q = query.toLowerCase();
    return (tasks ?? []).filter((t) => !q || t.title.toLowerCase().includes(q) || t.documentTitle.toLowerCase().includes(q));
  }, [tasks, query]);
  const groups = useMemo(() => (view === "upcoming" ? groupByDate(shown) : view === "completed" ? [{ key: "all", label: null as string | null, items: shown }] : groupByWhen(shown, today)), [view, shown, today]);
  // The same elements while the rows haven't changed, so a keystroke in the filter doesn't re-render them all.
  const list = useMemo(
    () =>
      groups.map((g) => (
        <section key={g.key} className="mt-6" aria-label={g.label ?? meta.label}>
          {g.label ? (
            <h3 className={`mb-1 flex items-baseline gap-2 px-3 text-caption-1 font-semibold uppercase tracking-[0.06em] ${g.key === "overdue" ? "text-danger" : "text-faint"}`}>
              {g.label}
              <span className="font-medium tabular-nums opacity-80">{g.items.length}</span>
            </h3>
          ) : null}
          <ul className="-mx-3">
            {g.items.map((t) => (
              <TaskItem key={t.blockId} task={t} today={today} onToggle={onToggle} onEdit={setEditing} />
            ))}
          </ul>
        </section>
      )),
    [groups, meta, today, onToggle],
  );
  const empty = view === "mine" && context.kind === "personal" ? { title: "No open tasks", body: "In Personal every unassigned task is yours." } : meta.empty;
  const iphone = useIphoneApp();
  if (iphone) {
    return (
      <IphoneTasks view={view} tasks={tasks === undefined ? undefined : shown} counts={counts} filter={filter} onFilter={setFilter} onToggle={onToggle} onEdit={setEditing} empty={empty} onRetry={failed}>
        <IphoneTaskSheet task={editing} onClose={() => setEditing(null)} />
      </IphoneTasks>
    );
  }

  return (
    <ViewChrome
      title={<h1 className="text-subheadline font-semibold">Tasks</h1>}
      tabTitle={`Tasks · ${meta.label}`}
    >
      <div className="mx-auto max-w-3xl px-4 pb-[max(6rem,var(--fab-clearance))] pt-3 sm:px-8">
        {/* The view's count and its actions sit on the list's own column, lined up with the views, the filter and
            the tasks under them at any window width (not at the window's far edges). */}
        <header data-toolbar="" className="mb-4 flex min-h-control flex-wrap items-center gap-2">
          <span role="status" className="mr-auto min-w-0 truncate text-subheadline text-muted">
            {`${meta.label}${tasks === undefined ? "" : ` · ${shown.length} ${view === "completed" ? "done" : "open"}`}`}
          </span>
          <AppLink href="/calendar" title="Calendar" className="ui-btn ui-btn-secondary h-control gap-1.5 px-3 text-callout">
            <CalendarDays size={14} aria-hidden /> <span className="max-md:sr-only">Calendar</span>
          </AppLink>
          <Button variant="primary" title={keys("Add task (⌘⇧A)")} onClick={() => openQuickAdd()}>
            <Plus size={14} aria-hidden /> Add task
          </Button>
        </header>
        {/* Whole items wrap to a second row when they don't fit (never a label broken over two lines). */}
        <nav data-toolbar="" aria-label="Task views" className="ui-seg ui-well flex-wrap">
          {VIEWS.map((v) => {
            const count = counts && v.id !== "completed" ? counts[v.id as keyof typeof counts] : undefined;
            return (
              <AppLink
                key={v.id}
                href={`/tasks/${v.id}`}
                aria-current={v.id === view ? "page" : undefined}
                data-active={v.id === view}
                className="flex-[1_0_auto] whitespace-nowrap"
              >
                {v.label}
                {count ? <span className={`rounded-chip px-1.5 text-caption-2 font-semibold leading-[18px] tabular-nums ${v.id === view ? "bg-heading text-canvas" : "text-[var(--color-ink-faint)]"}`}>{count}</span> : null}
              </AppLink>
            );
          })}
        </nav>
        {/* A search field (the Mac's, 2026-11-19): a magnifier in front, and a clear button once there's text. */}
        <div className="relative mt-4">
          <label>
            <span className="sr-only">Filter tasks</span>
            <Funnel size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              ref={filterRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && filter) {
                  e.preventDefault();
                  setFilter("");
                }
              }}
              placeholder="Filter by task or note"
              className="h-control w-full ui-input pl-9 pr-9 text-callout"
            />
          </label>
          {filter ? (
            <button
              type="button"
              aria-label="Clear filter"
              title="Clear filter"
              onClick={() => {
                setFilter("");
                filterRef.current?.focus();
              }}
              className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-container text-faint transition-colors hover:bg-[color-mix(in_oklab,var(--color-ink)_8%,transparent)] hover:text-ink pointer-coarse:size-8"
            >
              <X size={13} aria-hidden />
            </button>
          ) : null}
        </div>
        {failed ? (
          <LoadFailed what="your tasks" onRetry={failed} />
        ) : tasks === undefined ? (
          <div className="mt-6 space-y-2" aria-busy>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-chip bg-surface motion-reduce:animate-none" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState icon={SquareCheckBig} title={query ? "No tasks match that filter" : empty.title} body={query ? undefined : empty.body} />
        ) : (
          list
        )}
        {tasks !== undefined && shown.length ? <p className="mt-8 text-center text-caption-1 text-faint">Every task lives in a note. Open its page to see the context it was written in.</p> : null}
      </div>
      <TaskEditDialog task={editing} onClose={() => setEditing(null)} />
    </ViewChrome>
  );
}

/** Overdue, Today, Upcoming and No date, in that order (empty groups left out); a view that holds one kind shows its heading too. */
function groupByWhen(tasks: TaskRow[], today: string) {
  const order = [
    { key: "overdue", label: "Overdue" },
    { key: "today", label: "Today" },
    { key: "later", label: "Upcoming" },
    { key: "none", label: "No date" },
  ];
  const by = new Map<string, TaskRow[]>(order.map((o) => [o.key, []]));
  for (const t of tasks) {
    const key = !t.dueDate ? "none" : t.status === "open" && t.dueDate < today ? "overdue" : t.dueDate === today ? "today" : t.dueDate < today ? "today" : "later";
    by.get(key)!.push(t);
  }
  return order.filter((o) => by.get(o.key)!.length).map((o) => ({ key: o.key, label: o.label as string | null, items: by.get(o.key)! }));
}

function groupByDate(tasks: TaskRow[]) {
  const groups = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    const key = t.dueDate ?? "none";
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  return [...groups.entries()].map(([key, items]) => ({
    key,
    label: key === "none" ? "No date" : formatCalendarDate(key, { weekday: "long", month: "long", day: "numeric" }),
    items,
  }));
}
