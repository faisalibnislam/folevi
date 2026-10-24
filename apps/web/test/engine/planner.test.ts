// Revision 9 through the bridge host: repeating tasks, clearing with null, the calendar feed, unscheduled tasks,
// file links, recent notes across spaces, and the Created by search filter.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeHost } from "@/lib/engine/host";
import { resetNoteHost } from "@/lib/engine/noteHost";
import { resetGates } from "@/lib/engine/gates";
import { repeatRuleFrom } from "@/lib/engine/commandsWork";
import type { FileUrlsValue, RecentValue, Reply, TasksRangeValue } from "@/lib/engine/protocol";
import { Posts, rig, summary, type Rig } from "./fakes";

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

describe("tasks", () => {
  it("repeat rules from words", () => {
    expect(repeatRuleFrom("Weekly")).toEqual({ repeat: "weekly" });
    expect(repeatRuleFrom("every 2 weeks on mon,thu")).toMatchObject({ repeat: "weekly", every: 2, days: [1, 4] });
    expect(repeatRuleFrom("3 days")).toMatchObject({ repeat: "daily", every: 3 });
    expect(() => repeatRuleFrom("when the moon is full")).toThrow();
  });

  it("task.update repeat changes the to-do's block through the sync engine; null removes it", async () => {
    r.engine.blocks.set("d1", [{ id: "t1", type: "todo", props: { checked: false, dueDate: "2026-10-24" }, revision: 4 }]);
    await command("task.update", { id: "t1", noteId: "d1", repeat: "every 2 weeks on mon" });
    expect(r.engine.upserts[0]).toMatchObject({ documentId: "d1", block: { id: "t1", props: { checked: false, dueDate: "2026-10-24", repeat: "weekly", repeatEvery: 2, repeatDays: "1" } }, baseRevision: 4 });
    expect(r.client.mutations).toEqual([]);
    r.engine.blocks.set("d1", [{ id: "t1", type: "todo", props: { repeat: "weekly", repeatEvery: 2, repeatDays: "1" }, revision: 5 }]);
    await command("task.update", { id: "t1", noteId: "d1", repeat: null, dueDate: null });
    expect(r.engine.upserts[1]!.block.props).toEqual({});
    expect(r.client.mutations[0]).toEqual({ name: "tasks:update", args: { blockId: "t1", dueDate: null } });
    expect(await code({ kind: "command", place: PLACE, name: "task.update", args: { id: "t1", repeat: "daily" } })).toBe("invalid_args");
  });

  it("tasks.unscheduled: open tasks with no date, newest first", async () => {
    r.client.answer("tasks:list", [
      { blockId: "a", documentId: "d1", documentTitle: "", documentIcon: null, title: "A", status: "open", dueDate: null, dueTime: null, assigneeId: null, assigneeName: null, reminderAt: null, repeat: null, completedAt: null, updatedAt: 1 },
      { blockId: "b", documentId: "d1", documentTitle: "", documentIcon: null, title: "B", status: "open", dueDate: "2026-10-30", dueTime: null, assigneeId: null, assigneeName: null, reminderAt: null, repeat: null, completedAt: null, updatedAt: 3 },
      { blockId: "c", documentId: "d1", documentTitle: "", documentIcon: null, title: "C", status: "open", dueDate: null, dueTime: null, assigneeId: null, assigneeName: null, reminderAt: null, repeat: null, completedAt: null, updatedAt: 2 },
    ]);
    expect(((await query("tasks.unscheduled")) as TasksRangeValue).tasks.map((t) => t.id)).toEqual(["c", "a"]);
  });
});

describe("calendar feed, files, recents, search", () => {
  it("the calendar feed", async () => {
    r.client.answer("calendarFeeds:status", null);
    expect(await query("calendar.feed")).toEqual({ active: false, url: null, createdAt: null, lastFetchedAt: null, includeWorkspaces: false });
    r.client.mutate = (name) => (name === "calendarFeeds:create" ? { token: "tok123" } : null);
    expect(await command("calendar.feedCreate", { includeWorkspaces: true })).toEqual({ url: "https://app.folevi.com/api/calendar/tok123.ics" });
    await command("calendar.feedWorkspaces", { includeWorkspaces: false });
    await command("calendar.feedRevoke");
    expect(r.client.mutations.map((m) => m.name)).toEqual(["calendarFeeds:create", "calendarFeeds:setIncludeWorkspaces", "calendarFeeds:remove"]);
  });

  it("files.urls", async () => {
    r.client.answer("files:urls", { f1: { url: "https://x/f1", mimeType: "application/zip", filename: "e.zip", size: 9 } });
    expect(((await query("files.urls", { ids: ["f1", "f2"] })) as FileUrlsValue).urls).toEqual({ f1: { url: "https://x/f1", filename: "e.zip", mimeType: "application/zip", size: 9, sealed: false }, f2: { url: null, filename: null, mimeType: null, size: null, sealed: false } });
  });

  it("recent across spaces, newest first, a locked space left out", async () => {
    r.encrypted.add("ws_vault");
    r.locked.add("ws_vault");
    r.client.answer("documents:recentNotes", (args: { scope: { kind: string; workspaceId?: string } }) => (args.scope.kind === "personal" ? [summary(1, { updatedAt: 10 })] : args.scope.workspaceId === "ws1" ? [summary(2, { updatedAt: 20 })] : [summary(3, { updatedAt: 30 })]));
    const v = (await query("recent", { scope: "everywhere" })) as RecentValue;
    expect(v.rows.map((x) => [x.row.id, x.space])).toEqual([["doc_2", "ws1"], ["doc_1", "personal"]]);
    const here = (await query("recent")) as RecentValue;
    expect(here.rows.map((x) => x.space)).toEqual(["personal"]);
  });

  it("search passes Created by", async () => {
    let asked: Record<string, unknown> | null = null;
    r.client.answer("search:documents", (a: Record<string, unknown>) => ((asked = a), []));
    await query("search", { text: "plan", creatorId: "prof_2" });
    expect(asked).toMatchObject({ creatorId: "prof_2" });
  });
});
