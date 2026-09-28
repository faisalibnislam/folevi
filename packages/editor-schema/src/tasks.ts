import type { TodoProps } from "./generated/schema";
import type { WireBlock } from "./types";
import { plainText } from "./richtext";

export type TaskStatus = "open" | "done" | "canceled";
export type TaskView = "inbox" | "today" | "upcoming" | "all" | "completed" | "mine";

export interface TaskProjection {
  blockId: string;
  documentId: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  dueTime: string | null;
  allDay: boolean;
  priority: "none" | "low" | "medium" | "high";
  assigneeId: string | null;
  reminderAt: number | null;
  completedAt: number | null;
}

/** Derives the task index row from its canonical todo block. The block stays the source of truth. */
export function projectTask(block: WireBlock, documentId: string): TaskProjection | null {
  if (block.type !== "todo") return null;
  const p = block.props as unknown as TodoProps;
  return {
    blockId: block.id,
    documentId,
    title: plainText(block.text).slice(0, 500),
    status: p.canceled ? "canceled" : p.checked ? "done" : "open",
    dueDate: p.dueDate ?? null,
    dueTime: p.dueTime ?? null,
    allDay: !p.dueTime,
    priority: p.priority ?? "none",
    assigneeId: p.assigneeId ?? null,
    reminderAt: p.reminderAt ?? null,
    completedAt: p.completedAt ?? null,
  };
}

/** Local calendar date (YYYY-MM-DD) for a timestamp in a given IANA time zone. */
export function localDate(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    new Date(timestamp),
  );
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Which global views a task appears in.
 * - inbox: open, no due date, not assigned to someone else
 * - today: open and due today or overdue
 * - upcoming: open and due after today
 * - completed: done
 * - mine: open and assigned to the viewer — or, in a personal workspace (where the viewer is the only
 *   member), open and unassigned, since every unassigned task there is theirs
 * - completed: done or canceled (closed tasks)
 */
export function taskViews(
  task: Pick<TaskProjection, "status" | "dueDate" | "assigneeId">,
  today: string,
  viewerId: string,
  options: { personalWorkspace?: boolean } = {},
): TaskView[] {
  const views: TaskView[] = ["all"];
  if (task.status === "done" || task.status === "canceled") return ["completed"];
  if (!task.dueDate && (!task.assigneeId || task.assigneeId === viewerId)) views.push("inbox");
  if (task.dueDate && task.dueDate <= today) views.push("today");
  if (task.dueDate && task.dueDate > today) views.push("upcoming");
  if (task.assigneeId === viewerId || (options.personalWorkspace && !task.assigneeId)) views.push("mine");
  return views;
}

export function isOverdue(task: Pick<TaskProjection, "status" | "dueDate">, today: string): boolean {
  return task.status === "open" && task.dueDate !== null && task.dueDate < today;
}
