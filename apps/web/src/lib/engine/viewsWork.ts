// Revision 5's views (docs/NATIVE_APP_PLAN.md sections 5.8 and 5.12): task lists grouped as the web groups them,
// task counts, tasks in a date range and subscribed calendars' events for the calendar, workspace members for
// assigning, and what Quick Add reads in a typed task.
import { isOverdue } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import type { ViewContext } from "./context";
import type { Snapshot } from "./live";
import { planQuickTask } from "./quickTask";
import { requireSpace, source, type LiveValue, type ValueViewDef } from "./views";
import { bool, invalid, num, oneOf, only, optionalId, text } from "./validate";
import { TASK_VIEWS, type CalendarEvent, type CalendarSubscription, type MemberRow, type TaskGroup, type TaskRow, type TaskViewName, type TasksValue, type ViewName } from "./protocol";

type Args = Record<string, unknown>;

export type TaskData = {
  blockId: string;
  documentId: string;
  documentTitle: string;
  documentIcon: string | null;
  title: string;
  status: string;
  dueDate: string | null;
  dueTime: string | null;
  priority?: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  reminderAt: number | null;
  repeat: string | null;
  completedAt: number | null;
  updatedAt: number;
};

export function taskRow(t: TaskData, today: string): TaskRow {
  const priority = t.priority && t.priority !== "none" ? t.priority : null;
  return {
    id: t.blockId,
    noteId: t.documentId,
    noteTitle: t.documentTitle ?? "",
    noteIcon: t.documentIcon ?? null,
    title: t.title ?? "",
    status: t.status,
    dueDate: t.dueDate ?? null,
    dueTime: t.dueTime ?? null,
    priority,
    assigneeId: t.assigneeId ?? null,
    assigneeName: t.assigneeName ?? null,
    reminderAt: t.reminderAt ?? null,
    repeat: t.repeat ?? null,
    completedAt: t.completedAt ?? null,
    updatedAt: t.updatedAt,
    overdue: isOverdue({ status: t.status as "open", dueDate: t.dueDate ?? null }, today),
  };
}

const DAY = 86_400_000;
const dayMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Tomorrow", "Monday 27 October", "Monday 27 October 2027" (another year). */
export function dayTitle(date: string, today: string): string {
  const diff = Math.round((dayMs(date) - dayMs(today)) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  const d = new Date(dayMs(date));
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${sameYear ? "" : ` ${d.getUTCFullYear()}`}`;
}

/**
 * The view's groups: Upcoming by day, every other view by note (in the order the tasks come, which the server
 * sorts by due date), as components/iphone/Tasks.tsx and TasksView.tsx show them.
 */
export function taskGroups(view: TaskViewName, rows: TaskRow[], today: string): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  for (const t of rows) {
    const byDay = view === "upcoming" && t.dueDate;
    const key = byDay ? `day:${t.dueDate}` : `note:${t.noteId}`;
    let g = groups.get(key);
    if (!g) {
      g = byDay ? { id: t.dueDate!, kind: "day", title: dayTitle(t.dueDate!, today), icon: null, tasks: [] } : { id: t.noteId, kind: "note", title: t.noteTitle || "Untitled", icon: t.noteIcon, tasks: [] };
      groups.set(key, g);
    }
    g.tasks.push(t);
  }
  const out = [...groups.values()];
  if (view === "upcoming") out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

function one<T>(src: { snapshot(): Snapshot<T> }, map: (v: T) => unknown): LiveValue["compute"] {
  return () => {
    const s = src.snapshot();
    if (s.error) return { value: undefined, stale: false, error: s.error };
    return { value: s.value === undefined ? undefined : map(s.value), stale: s.stale, error: null };
  };
}

const tasksList: ValueViewDef = {
  kind: "value",
  parse: (args) => {
    only(args, ["space", "view"]);
    const out: Args = { view: oneOf(args, "view", TASK_VIEWS) };
    const space = optionalId(args, "space");
    if (space !== undefined) out.space = space;
    return out;
  },
  create: (ctx: ViewContext, args) => {
    const deps = ctx.deps();
    const space = requireSpace(deps, args.space as string | undefined);
    const view = args.view as TaskViewName;
    const today = deps.app.today;
    const src = source<TaskData[]>(ctx, api.tasks.list, { scope: space.scope, view, today }, space.scope);
    return {
      signals: [src, ctx.appSignal],
      compute: one(src, (v): TasksValue => {
        const rows = v.map((t) => taskRow(t, today));
        return { view, groups: taskGroups(view, rows, today), total: rows.length };
      }),
    };
  },
};

const spaceOnly = (args: Args) => {
  only(args, ["space"]);
  const space = optionalId(args, "space");
  return space === undefined ? {} : { space };
};

const tasksCounts: ValueViewDef = {
  kind: "value",
  parse: spaceOnly,
  create: (ctx, args) => {
    const deps = ctx.deps();
    const space = requireSpace(deps, args.space as string | undefined);
    const src = source<{ inbox: number; today: number; upcoming: number; all: number; mine: number }>(ctx, api.tasks.counts, { scope: space.scope, today: deps.app.today }, space.scope);
    return { signals: [src], compute: one(src, (c) => ({ inbox: c.inbox, today: c.today, upcoming: c.upcoming, all: c.all, mine: c.mine })) };
  },
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const tasksRange: ValueViewDef = {
  kind: "value",
  parse: (args) => {
    only(args, ["space", "from", "to", "includeCompleted"]);
    const from = text(args, "from", { max: 10 }) as string;
    const to = text(args, "to", { max: 10 }) as string;
    if (!DATE.test(from) || !DATE.test(to) || to < from) throw invalid("from and to must be days (YYYY-MM-DD), from first.");
    const out: Args = { from, to };
    const space = optionalId(args, "space");
    if (space !== undefined) out.space = space;
    if (args.includeCompleted !== undefined) out.includeCompleted = bool(args, "includeCompleted");
    return out;
  },
  create: (ctx, args) => {
    const deps = ctx.deps();
    const space = requireSpace(deps, args.space as string | undefined);
    const src = source<TaskData[]>(ctx, api.tasks.range, { scope: space.scope, from: args.from, to: args.to, ...(args.includeCompleted ? { includeCompleted: true } : {}) }, space.scope);
    return { signals: [src, ctx.appSignal], compute: one(src, (v) => ({ tasks: v.map((t) => taskRow(t, ctx.deps().app.today)) })) };
  },
};

type EventData = CalendarEvent[];

const calendarsEvents: ValueViewDef = {
  kind: "value",
  parse: (args) => {
    only(args, ["from", "to"]);
    const from = num(args, "from", { min: 0 });
    const to = num(args, "to", { min: 0 });
    if (to <= from || to - from > 400 * DAY) throw invalid("to must come after from, at most 400 days later.");
    return { from, to };
  },
  create: (ctx, args) => {
    if (ctx.deps().app.mode === "local") return { signals: [], compute: () => ({ value: { events: [] }, stale: false, error: null }) };
    const src = source<EventData>(ctx, api.externalCalendars.events, { from: args.from, to: args.to }, null);
    return {
      signals: [src],
      compute: one(src, (v) => ({ events: v.map((e) => ({ id: e.id, calendarId: e.calendarId, calendarName: e.calendarName, color: e.color, title: e.title, location: e.location ?? "", description: e.description ?? "", start: e.start, end: e.end, allDay: Boolean(e.allDay) })) })),
    };
  },
};

const calendarsList: ValueViewDef = {
  kind: "value",
  parse: (args) => (only(args, []), {}),
  create: (ctx) => {
    if (ctx.deps().app.mode === "local") return { signals: [], compute: () => ({ value: { calendars: [] }, stale: false, error: null }) };
    const src = source<(CalendarSubscription & { truncated?: boolean })[]>(ctx, api.externalCalendars.list, {}, null);
    return {
      signals: [src],
      compute: one(src, (v) => ({ calendars: v.map((c) => ({ id: c.id, name: c.name, url: c.url, color: c.color, visible: c.visible, lastFetchedAt: c.lastFetchedAt ?? null, lastError: c.lastError ?? null, eventCount: c.eventCount ?? null, loading: Boolean(c.loading) })) })),
    };
  },
};

type MemberData = { profileId: string; displayName: string; email: string; role: string; isYou: boolean }[];

const members: ValueViewDef = {
  kind: "value",
  parse: spaceOnly,
  create: (ctx, args) => {
    const deps = ctx.deps();
    const space = requireSpace(deps, args.space as string | undefined);
    // In Personal it's you (tasks there are assigned to people the note is shared with on the web, not here).
    if (space.kind === "personal") {
      const me: MemberRow = { id: deps.app.profile.id, name: deps.app.profile.name, email: deps.app.profile.email, role: "owner", isYou: true };
      return { signals: [], compute: () => ({ value: { members: [me] }, stale: false, error: null }) };
    }
    const src = source<MemberData>(ctx, api.workspaces.members, { workspaceId: space.id }, null);
    return { signals: [src], compute: one(src, (v) => ({ members: v.map((m) => ({ id: m.profileId, name: m.displayName, email: m.email, role: m.role, isYou: m.isYou })) })) };
  },
};

const taskParse: ValueViewDef = {
  kind: "value",
  parse: (args) => {
    only(args, ["text"]);
    return { text: text(args, "text", { max: 500, allowEmpty: true }) as string };
  },
  create: (ctx, args) => ({
    signals: [ctx.appSignal],
    compute: () => {
      const plan = planQuickTask(args.text as string, ctx.deps().app.today);
      return { value: { title: plan.title, dueDate: plan.dueDate, dueTime: plan.dueTime, dateText: plan.dateText, repeatLabel: plan.repeatLabel, repeatText: plan.repeatText }, stale: false, error: null };
    },
  }),
};

export const WORK_VALUE_VIEWS = {
  "tasks.list": tasksList,
  "tasks.counts": tasksCounts,
  "tasks.range": tasksRange,
  "calendars.events": calendarsEvents,
  "calendars.list": calendarsList,
  members,
  "task.parse": taskParse,
} satisfies Partial<Record<ViewName, ValueViewDef>>;
