"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { addDays } from "@folevi/editor-schema";
import { CalendarDays, ChevronRight, Clock, FileText, Flag, Repeat, UserRound } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { dueLabel } from "@/lib/format";
import { formatCalendarDate } from "@/i18n";
import { feel, pickDate } from "@/lib/native/ui";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { useToast, errorMessage } from "@/components/ui/Toast";
import type { TaskRow } from "@/components/views/TasksView";
import { Sheet } from "./Sheet";
import { TaskBox } from "./Tasks";

type Status = TaskRow["status"];
type Priority = "none" | "low" | "medium" | "high";
const PRIORITY: { id: Priority; label: string }[] = [
  { id: "none", label: "None" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

/** A row of the sheet's grouped lists: 52 pt, an icon, the label, the value in muted, a chevron. */
const ROW = "relative flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-body leading-[22px] outline-none transition-colors active:bg-[var(--liquid-press)] focus-visible:bg-[var(--liquid-active)] disabled:opacity-40";

/**
 * A task's details on the iPhone, as a sheet (Reminders' details, in Folevi's look): the task with its box,
 * then its status as a segmented control, its date and time (the system's date picker in the app, Folevi's
 * calendar elsewhere), priority and assignee as menus, and the note it lives in. Every change is saved as it's
 * made, so there's nothing to confirm; the sheet closes with its button or a drag down.
 */
export function IphoneTaskSheet({ task, onClose }: { task: TaskRow | null; onClose: () => void }) {
  // Kept while the sheet plays its closing animation.
  const [shown, setShown] = useState(task);
  useEffect(() => {
    if (task) setShown(task);
  }, [task]);
  return (
    <Sheet open={task !== null} onClose={onClose} title="Task" size="fit" bodyClassName="pb-3">
      {shown ? <TaskDetails key={shown.blockId} task={task ?? shown} onClose={onClose} /> : null}
    </Sheet>
  );
}

function TaskDetails({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const { workspace, profile, deviceId, today } = useAppState();
  const { navigate } = useAppRouter();
  const members = useQuery(api.workspaces.members, workspace ? { workspaceId: workspace.id } : "skip");
  // Personal has no members: its tasks are yours (a guest on a page can still be the assignee already set).
  const people = workspace ? (members?.members ?? []) : [{ profileId: profile.id, displayName: profile.displayName, isYou: true }];
  const update = useMutation(api.tasks.update);
  const toast = useToast();
  // What's shown follows each change at once; the task's own values catch up when the change is saved.
  const [draft, setDraft] = useState<{ status: Status; dueDate: string | null; dueTime: string | null; priority: Priority; assigneeId: string | null }>(() => ({
    status: task.status,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    priority: (task.priority as Priority) ?? "none",
    assigneeId: task.assigneeId,
  }));
  useEffect(() => {
    setDraft({ status: task.status, dueDate: task.dueDate, dueTime: task.dueTime, priority: (task.priority as Priority) ?? "none", assigneeId: task.assigneeId });
  }, [task.status, task.dueDate, task.dueTime, task.priority, task.assigneeId]);

  const save = (patch: Partial<typeof draft>) => {
    const before = draft;
    const next = { ...draft, ...patch };
    setDraft(next);
    const args: Parameters<typeof update>[0] = { blockId: task.blockId, deviceId: deviceId ?? undefined };
    if (patch.status !== undefined && patch.status !== before.status) {
      if (patch.status === "canceled") args.canceled = true;
      else if (patch.status === "done") args.checked = true;
      else if (before.status === "canceled") args.canceled = false;
      else args.checked = false;
    }
    if (patch.dueDate !== undefined) args.dueDate = patch.dueDate;
    if (patch.dueTime !== undefined) args.dueTime = patch.dueTime;
    if (patch.priority !== undefined) args.priority = patch.priority;
    if (patch.assigneeId !== undefined) args.assigneeId = patch.assigneeId;
    update(args).catch((e) => {
      setDraft(before);
      feel("failed");
      toast.show(errorMessage(e), { tone: "error" });
    });
  };

  /** A choice from a menu: felt and saved when it changes something. */
  const pick = (changes: boolean, patch: Partial<typeof draft>) => {
    if (!changes) return;
    feel("choose");
    save(patch);
  };
  const chooseDate = async () => {
    const picked = await pickDate({ mode: "date", value: draft.dueDate ?? today, title: "Due date", clearable: Boolean(draft.dueDate) });
    if (!picked) return;
    if (picked.value === null) save({ dueDate: null, dueTime: null });
    else if (picked.value !== draft.dueDate) save({ dueDate: picked.value });
  };
  const chooseTime = async () => {
    const picked = await pickDate({ mode: "time", value: draft.dueTime ?? "09:00", title: "Time", clearable: Boolean(draft.dueTime) });
    if (!picked) return;
    if (picked.value !== draft.dueTime) save({ dueTime: picked.value });
  };

  const overdue = draft.status === "open" && draft.dueDate !== null && draft.dueDate < today;
  const dateValue = draft.dueDate ? whenLabel(draft.dueDate, today) : "None";
  const assignee = draft.assigneeId ? (people.find((m) => m.profileId === draft.assigneeId)?.displayName ?? task.assigneeName ?? "Someone") : "Nobody";
  const noteHref = `/d/${task.documentId}#block-${task.blockId}`;

  const quickDays: { label: string; date: string }[] = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    { label: "Next week", date: addDays(today, 7 - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)) },
  ];

  return (
    <div className="space-y-5 px-4 pt-1">
      {/* The task itself, with its box (it checks off from here too). */}
      <div className="flex items-start gap-3 px-1">
        <button
          type="button"
          role="checkbox"
          aria-checked={draft.status === "done"}
          aria-label={draft.status === "done" ? "Mark as not done" : "Mark as done"}
          onClick={() => {
            const status: Status = draft.status === "open" ? "done" : "open";
            if (status === "done") feel("check");
            save({ status });
          }}
          className="-ml-[11px] -mt-[11px] grid h-11 w-11 flex-none place-items-center rounded-capsule outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <TaskBox status={draft.status} />
        </button>
        <p className={`-ml-[11px] min-w-0 flex-1 text-body font-medium leading-[22px] [overflow-wrap:anywhere] transition-colors duration-[250ms] ${draft.status === "open" ? "text-heading" : "text-muted"}`}>{task.title || "Untitled task"}</p>
      </div>

      <Segmented
        label="Status"
        value={draft.status}
        onChange={(status) => save({ status })}
        options={[
          { id: "open", label: "Open" },
          { id: "done", label: "Done" },
          { id: "canceled", label: "Canceled" },
        ]}
      />

      <Group>
        <button type="button" onClick={() => void chooseDate()} className={ROW}>
          <RowIcon>
            <CalendarDays />
          </RowIcon>
          <span className="flex-1">Date</span>
          <span className={`flex-none ${overdue ? "text-danger" : "text-muted"}`}>{dateValue}</span>
          <ChevronRight size={15} strokeWidth={2.4} aria-hidden className="-mr-1 flex-none text-faint" />
        </button>
        {draft.dueDate ? (
          <button type="button" onClick={() => void chooseTime()} className={ROW}>
            <RowIcon>
              <Clock />
            </RowIcon>
            <span className="flex-1">Time</span>
            <span className="flex-none text-muted">{draft.dueTime ?? "All day"}</span>
            <ChevronRight size={15} strokeWidth={2.4} aria-hidden className="-mr-1 flex-none text-faint" />
          </button>
        ) : null}
        {/* The days people pick most, a tap away (the picker has the rest). */}
        <div role="group" aria-label="Quick dates" className="flex gap-2 px-4 pb-3 pt-1">
          {quickDays.map((d) => (
            <button
              key={d.label}
              type="button"
              aria-pressed={draft.dueDate === d.date}
              onClick={() => {
                feel("choose");
                save({ dueDate: d.date });
              }}
              className={`min-h-[34px] flex-1 rounded-capsule py-1 text-subheadline font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${draft.dueDate === d.date ? "bg-heading text-canvas" : "bg-[color-mix(in_oklab,var(--color-ink)_7%,transparent)] text-ink active:bg-[color-mix(in_oklab,var(--color-ink)_12%,transparent)]"}`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </Group>

      <Group>
        <MenuRow
          label="Priority"
          icon={<Flag />}
          value={PRIORITY.find((p) => p.id === draft.priority)?.label ?? "None"}
          items={PRIORITY.map((p) => ({ label: p.label, checked: draft.priority === p.id, onSelect: () => pick(draft.priority !== p.id, { priority: p.id }) }))}
        />
        {workspace || task.assigneeId ? (
          <MenuRow
            label="Assignee"
            icon={<UserRound />}
            value={assignee}
            items={[
              { label: "Nobody", checked: !draft.assigneeId, onSelect: () => pick(Boolean(draft.assigneeId), { assigneeId: null }) },
              "separator",
              ...people.map((m) => ({ label: `${m.displayName}${m.isYou ? " (you)" : ""}`, checked: draft.assigneeId === m.profileId, onSelect: () => pick(m.profileId !== draft.assigneeId, { assigneeId: m.profileId }) })),
            ]}
          />
        ) : null}
        {task.repeat ? (
          <div className={ROW.replace("active:bg-[var(--liquid-press)]", "")}>
            <RowIcon>
              <Repeat />
            </RowIcon>
            <span className="flex-1">Repeats</span>
            <span className="max-w-[55%] flex-none truncate text-muted">{task.repeat}</span>
          </div>
        ) : null}
      </Group>

      <Group>
        <button
          type="button"
          onClick={() => {
            onClose();
            navigate(noteHref);
          }}
          className={ROW}
        >
          <RowIcon>
            <FileText />
          </RowIcon>
          <span className="min-w-0 flex-1">
            <span className="block text-footnote leading-[18px] text-muted">In the note</span>
            <span className="block truncate">{task.documentTitle || "Untitled"}</span>
          </span>
          <ChevronRight size={15} strokeWidth={2.4} aria-hidden className="-mr-1 flex-none text-faint" />
        </button>
      </Group>
    </div>
  );
}

/** "Today, Thu Oct 22", "Tomorrow, Fri Oct 23", "Mon, Nov 2", with the year when it isn't this one. */
function whenLabel(date: string, today: string): string {
  const full = formatCalendarDate(date, { weekday: "short", month: "short", day: "numeric", ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) });
  const near = dueLabel(date, today);
  return near === "Today" || near === "Tomorrow" || near === "Yesterday" ? `${near}, ${full}` : full;
}

/** A grouped list inside the sheet: rows on a quiet fill with hairlines between them, inset past the icon. */
function Group({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-container bg-[color-mix(in_oklab,var(--color-ink)_5%,transparent)] [&>*+*]:shadow-[inset_0_0.5px_0_var(--iphone-separator)]">{children}</div>;
}

function RowIcon({ children }: { children: ReactNode }) {
  return <span aria-hidden className="grid w-6 flex-none place-items-center text-muted [&_svg]:h-[20px] [&_svg]:w-[20px] [&_svg]:stroke-[2]">{children}</span>;
}

/** A row that opens a menu of choices (Folevi's menu, in Folevi's fonts) with the chosen one shown at its end. */
function MenuRow({ label, icon, value, items }: { label: string; icon: ReactNode; value: string; items: MenuEntry[] }) {
  return (
    <MenuButton
      label={`${label}: ${value}`}
      align="end"
      className="block w-full"
      triggerClassName={ROW}
      trigger={
        <>
          <RowIcon>{icon}</RowIcon>
          <span className="flex-1">{label}</span>
          <span className="max-w-[55%] flex-none truncate text-muted">{value}</span>
          <ChevronRight size={15} strokeWidth={2.4} aria-hidden className="-mr-1 flex-none rotate-90 text-faint" />
        </>
      }
      items={items}
    />
  );
}

/**
 * iOS's segmented control in Folevi's neutrals: a quiet track, the chosen segment a raised canvas-coloured
 * capsule that slides to the one picked (a selection tap in the hand).
 */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div role="radiogroup" aria-label={label} className="relative flex min-h-9 rounded-capsule bg-[color-mix(in_oklab,var(--color-ink)_7%,transparent)] p-0.5">
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 rounded-capsule bg-canvas shadow-[0_3px_8px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none dark:bg-raised"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          onClick={() => {
            if (o.id === value) return;
            feel("choose");
            onChange(o.id);
          }}
          className={`relative flex-1 rounded-capsule py-1.5 text-subheadline leading-tight outline-none focus-visible:ring-2 focus-visible:ring-focus ${o.id === value ? "font-semibold text-heading" : "font-medium text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
