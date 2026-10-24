// Revision 5 through the bridge host: task lists grouped like the web's, counts, the calendar's range and events,
// members, Quick Add's reading of a task, and the task and calendar commands (online and offline).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeHost } from "@/lib/engine/host";
import { resetNoteHost } from "@/lib/engine/noteHost";
import { resetGates } from "@/lib/engine/gates";
import { dayTitle } from "@/lib/engine/viewsWork";
import type { MembersValue, Reply, TaskParseValue, TasksRangeValue, TasksValue } from "@/lib/engine/protocol";
import { Posts, rig, type Rig } from "./fakes";

const PLACE = "acct:user_1";
let host: BridgeHost;
let r: Rig;
let n = 0;
const send = async (m: Record<string, unknown>) => JSON.parse(await host.handle(JSON.stringify({ v: 1, id: String(++n), ...m }))) as Reply;
const ok = async (m: Record<string, unknown>) => {
  const reply = await send(m);
  if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
  return reply.value;
};
const code = async (m: Record<string, unknown>) => {
  const reply = await send(m);
  return reply.ok ? null : reply.error.code;
};
const query = (name: string, args: Record<string, unknown> = {}) => ok({ kind: "query", place: PLACE, name, args });
const command = (name: string, args: Record<string, unknown> = {}) => ok({ kind: "command", place: PLACE, name, args });

const task = (i: number, over: Record<string, unknown> = {}) => ({ blockId: `t${i}`, documentId: i % 2 ? "d1" : "d2", documentTitle: i % 2 ? "Kyoto" : "", documentIcon: null, title: `Task ${i}`, status: "open", dueDate: "2026-10-24", dueTime: null, priority: "none", assigneeId: null, assigneeName: null, reminderAt: null, repeat: null, completedAt: null, updatedAt: i, ...over });

beforeEach(() => {
  host = new BridgeHost({ post: new Posts().post, schedule: () => undefined, marker: { platform: "ios", protocol: 1, place: PLACE }, queryTimeoutMs: 50 });
  r = rig(PLACE);
  host.attach(r.deps());
  n = 0;
});
afterEach(() => {
  host.dispose();
  resetNoteHost();
  resetGates();
});

describe("task views", () => {
  it("tasks.list groups by note; Upcoming by day in order", async () => {
    let asked: Record<string, unknown> | null = null;
    r.client.answer("tasks:list", (args: Record<string, unknown>) => {
      asked = args;
      return args.view === "upcoming" ? [task(1, { dueDate: "2026-10-27" }), task(2, { dueDate: "2026-10-25" }), task(3, { dueDate: "2026-10-27" })] : [task(1, { dueDate: "2026-10-20" }), task(2), task(3)];
    });
    const today = (await query("tasks.list", { view: "today" })) as TasksValue;
    expect(asked).toEqual({ scope: { kind: "personal" }, view: "today", today: "2026-10-24" });
    expect(today.groups.map((g) => [g.kind, g.id, g.title, g.tasks.map((t) => t.id)])).toEqual([["note", "d1", "Kyoto", ["t1", "t3"]], ["note", "d2", "Untitled", ["t2"]]]);
    expect(today.groups[0]!.tasks[0]).toMatchObject({ overdue: true, priority: null });
    const upcoming = (await query("tasks.list", { view: "upcoming", space: "ws1" })) as TasksValue;
    expect(upcoming.groups.map((g) => [g.id, g.title])).toEqual([["2026-10-25", "Tomorrow"], ["2026-10-27", "Tuesday 27 October"]]);
    expect(await code({ kind: "query", place: PLACE, name: "tasks.list", args: { view: "someday" } })).toBe("invalid_args");
  });

  it("day titles", () => {
    expect(dayTitle("2026-10-24", "2026-10-24")).toBe("Today");
    expect(dayTitle("2027-01-04", "2026-10-24")).toBe("Monday 4 January 2027");
  });

  it("tasks.counts, tasks.range and the calendar's events", async () => {
    r.client.answer("tasks:counts", { inbox: 1, today: 2, upcoming: 3, all: 6, mine: 4 });
    expect(await query("tasks.counts")).toEqual({ inbox: 1, today: 2, upcoming: 3, all: 6, mine: 4 });
    r.client.answer("tasks:range", [task(1, { status: "done", completedAt: 9 })]);
    const range = (await query("tasks.range", { from: "2026-10-19", to: "2026-10-25", includeCompleted: true })) as TasksRangeValue;
    expect(range.tasks[0]).toMatchObject({ id: "t1", status: "done", overdue: false });
    expect(await code({ kind: "query", place: PLACE, name: "tasks.range", args: { from: "2026-10-25", to: "2026-10-19" } })).toBe("invalid_args");
    r.client.answer("externalCalendars:events", [{ id: "e1", calendarId: "c1", calendarName: "Work", color: "accent", title: "Standup", location: "", description: "", start: 1, end: 2, allDay: false }]);
    expect(await query("calendars.events", { from: 0, to: 86_400_000 })).toEqual({ events: [{ id: "e1", calendarId: "c1", calendarName: "Work", color: "accent", title: "Standup", location: "", description: "", start: 1, end: 2, allDay: false }] });
    expect(await code({ kind: "query", place: PLACE, name: "calendars.events", args: { from: 0, to: 500 * 86_400_000 } })).toBe("invalid_args");
  });

  it("members: a workspace's, or just you in Personal", async () => {
    r.client.answer("workspaces:members", [{ profileId: "p2", displayName: "Maya", email: "m@x", role: "member", isYou: false }]);
    expect(((await query("members", { space: "ws1" })) as MembersValue).members).toEqual([{ id: "p2", name: "Maya", email: "m@x", role: "member", isYou: false }]);
    expect(((await query("members")) as MembersValue).members[0]).toMatchObject({ id: "prof_1", isYou: true });
  });

  it("task.parse reads a repeat and a date as the web's Quick Add does", async () => {
    const v = (await query("task.parse", { text: "water plants every monday" })) as TaskParseValue;
    expect(v).toMatchObject({ title: "water plants", repeatLabel: "Every Monday", repeatText: "every monday" });
    expect(v.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await query("task.parse", { text: "Buy milk" })).toEqual({ title: "Buy milk", dueDate: null, dueTime: null, dateText: null, repeatLabel: null, repeatText: null });
  });
});

describe("task and calendar commands", () => {
  it("task.create: Quick Add online with the date read, and the note's title for where it went", async () => {
    r.client.mutate = () => ({ blockId: "t9", documentId: "d1" });
    r.client.answer("documents:titles", { d1: { title: "Kyoto" } });
    const res = await command("task.create", { text: "call Sam every monday", noteId: "d1", priority: "high" });
    expect(res).toEqual({ id: "t9", noteId: "d1", where: "Kyoto" });
    const m = r.client.mutations[0]!;
    expect(m.name).toBe("tasks:quickAdd");
    expect(m.args).toMatchObject({ scope: { kind: "personal" }, title: "call Sam", priority: "high", documentId: "d1", repeat: { repeat: "weekly", repeatEvery: null, repeatDays: "1" } });
    expect(await code({ kind: "command", place: PLACE, name: "task.create", args: { text: "   " } })).toBe("invalid_args");
  });

  it("task.create keeps the words when asked, and takes a date given", async () => {
    r.client.mutate = () => ({ blockId: "t9", documentId: "inbox" });
    await command("task.create", { text: "read by friday", keepText: true });
    expect(r.client.mutations[0]!.args.title).toBe("read by friday");
    expect(r.client.mutations[0]!.args.dueDate).toBeUndefined();
    await command("task.create", { text: "pack", dueDate: "2026-11-01", dueTime: "08:30" });
    expect(r.client.mutations[1]!.args).toMatchObject({ title: "pack", dueDate: "2026-11-01", dueTime: "08:30" });
  });

  it("task.update, task.moveToNote and the calendar commands", async () => {
    await command("task.update", { id: "t1", checked: true, dueDate: null, priority: "none" });
    expect(r.client.mutations.at(-1)).toEqual({ name: "tasks:update", args: { blockId: "t1", checked: true, dueDate: null, priority: "none" } });
    expect(await code({ kind: "command", place: PLACE, name: "task.update", args: { id: "t1" } })).toBe("invalid_args");
    expect(await code({ kind: "command", place: PLACE, name: "task.update", args: { id: "t1", dueDate: "tomorrow" } })).toBe("invalid_args");
    await command("task.moveToNote", { id: "t1" });
    expect(r.client.mutations.at(-1)).toEqual({ name: "tasks:moveToDocument", args: { blockId: "t1" } });
    r.client.mutate = (name) => (name === "externalCalendars:add" ? { id: "c9" } : null);
    expect(await command("calendar.add", { url: "https://x.example/c.ics" })).toEqual({ id: "c9" });
    await command("calendar.update", { id: "c9", visible: false });
    await command("calendar.refresh", { id: "c9" });
    await command("calendar.remove", { id: "c9" });
    expect(r.client.mutations.slice(-3).map((m) => [m.name, m.args])).toEqual([
      ["externalCalendars:update", { calendarId: "c9", visible: false }],
      ["externalCalendars:refresh", { calendarId: "c9" }],
      ["externalCalendars:remove", { calendarId: "c9" }],
    ]);
  });
});
