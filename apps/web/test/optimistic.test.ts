import { describe, expect, it } from "vitest";
import { getFunctionName } from "convex/server";
import type { OptimisticLocalStore } from "convex/browser";
import { api } from "@/lib/convex/api";
import { archivedSet, bulkUpdated, restored, starSet, taskUpdated, trashed } from "@/lib/convex/optimistic";

// Clicks that show at once (lib/convex/optimistic.ts): what each one does to the lists and the note on screen,
// against a stand-in for Convex's local store.

type Entry = { name: string; args: Record<string, unknown>; value: unknown };

function fakeStore(entries: Entry[]) {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const writes: Entry[] = [];
  const store = {
    getQuery: (ref: never, args: Record<string, unknown>) => entries.find((e) => e.name === getFunctionName(ref) && same(e.args, args))?.value,
    getAllQueries: (ref: never) => entries.filter((e) => e.name === getFunctionName(ref)).map((e) => ({ args: e.args, value: e.value })),
    setQuery: (ref: never, args: Record<string, unknown>, value: unknown) => {
      const name = getFunctionName(ref);
      const at = entries.findIndex((e) => e.name === name && same(e.args, args));
      if (at >= 0) entries[at] = { name, args, value };
      writes.push({ name, args, value });
    },
  } as unknown as OptimisticLocalStore;
  return { store, writes, read: (name: string, args: Record<string, unknown>) => entries.find((e) => e.name === name && same(e.args, args))?.value };
}

const LIST = getFunctionName(api.documents.list);
const GET = getFunctionName(api.documents.get);
const TASKS = getFunctionName(api.tasks.list);
const RANGE = getFunctionName(api.tasks.range);
const page = (ids: string[], starred: string[] = []) => ({ page: ids.map((id) => ({ id, title: id, starred: starred.includes(id) })), isDone: true, continueCursor: "end" });
const ids = (v: unknown) => (v as { page: { id: string }[] }).page.map((r) => r.id);

describe("notes change at the click", () => {
  it("a bookmark shows on the note in every list and on the note itself", () => {
    const all = { view: "all" };
    const { store, read } = fakeStore([
      { name: LIST, args: all, value: page(["a", "b"]) },
      { name: GET, args: { documentId: "a" }, value: { document: { title: "a", starred: false }, role: "owner" } },
    ]);
    starSet(store, { documentId: "a", starred: true });
    expect((read(LIST, all) as { page: { id: string; starred: boolean }[] }).page).toEqual([
      { id: "a", title: "a", starred: true },
      { id: "b", title: "b", starred: false },
    ]);
    expect(read(GET, { documentId: "a" })).toEqual({ document: { title: "a", starred: true }, role: "owner" });
  });

  it("removing a bookmark takes the note out of Bookmarks and leaves it in other lists", () => {
    const starred = { view: "starred" };
    const all = { view: "all" };
    const { store, read } = fakeStore([
      { name: LIST, args: starred, value: page(["a", "b"], ["a", "b"]) },
      { name: LIST, args: all, value: page(["a", "b", "c"], ["a", "b"]) },
    ]);
    bulkUpdated(store, { documentIds: ["a"], action: { kind: "star", starred: false } });
    expect(ids(read(LIST, starred))).toEqual(["b"]);
    expect(ids(read(LIST, all))).toEqual(["a", "b", "c"]);
  });

  it("trash and archive take notes out of the lists they were in, and only those", () => {
    const all = { view: "all" };
    const archive = { view: "archive" };
    const trash = { view: "trash" };
    const make = () =>
      fakeStore([
        { name: LIST, args: all, value: page(["a", "b"]) },
        { name: LIST, args: archive, value: page(["x", "a"]) },
        { name: LIST, args: trash, value: page(["t", "a"]) },
      ]);
    let s = make();
    trashed(s.store, { documentId: "a" });
    expect([ids(s.read(LIST, all)), ids(s.read(LIST, archive)), ids(s.read(LIST, trash))]).toEqual([["b"], ["x"], ["t", "a"]]);
    s = make();
    archivedSet(s.store, { documentId: "a", archived: true });
    expect([ids(s.read(LIST, all)), ids(s.read(LIST, archive)), ids(s.read(LIST, trash))]).toEqual([["b"], ["x", "a"], ["t", "a"]]);
    s = make();
    archivedSet(s.store, { documentId: "a", archived: false });
    expect([ids(s.read(LIST, all)), ids(s.read(LIST, archive))]).toEqual([["a", "b"], ["x"]]);
    s = make();
    restored(s.store, { documentId: "a" });
    expect([ids(s.read(LIST, all)), ids(s.read(LIST, trash))]).toEqual([["a", "b"], ["t"]]);
    s = make();
    bulkUpdated(s.store, { documentIds: ["a", "t"], action: { kind: "delete" } });
    expect([ids(s.read(LIST, all)), ids(s.read(LIST, trash))]).toEqual([["a", "b"], []]);
  });

  it("writes nothing where nothing changes (no list re-renders for a click that isn't its own)", () => {
    const { store, writes } = fakeStore([
      { name: LIST, args: { view: "all" }, value: page(["b", "c"]) },
      { name: LIST, args: { view: "folder", folderId: "f" }, value: undefined },
      { name: LIST, args: { view: "starred" }, value: page(["a"], ["a"]) },
    ]);
    bulkUpdated(store, { documentIds: ["a"], action: { kind: "star", starred: true } });
    bulkUpdated(store, { documentIds: ["a"], action: { kind: "move" } });
    bulkUpdated(store, { documentIds: [], action: { kind: "trash" } });
    expect(writes).toEqual([]);
  });
});

describe("tasks change at the click", () => {
  const rows = () => [
    { blockId: "t1", title: "One", status: "open" },
    { blockId: "t2", title: "Two", status: "done" },
    { blockId: "t3", title: "Three", status: "canceled" },
  ];
  const status = (v: unknown) => (v as { status: string }[]).map((t) => t.status);

  it("checks a task off in Tasks and in Calendar", () => {
    const today = { view: "today" };
    const week = { from: "2026-11-23", to: "2026-11-29" };
    const { store, read } = fakeStore([
      { name: TASKS, args: today, value: rows() },
      { name: RANGE, args: week, value: rows() },
    ]);
    taskUpdated(store, { blockId: "t1", checked: true });
    expect(status(read(TASKS, today))).toEqual(["done", "done", "canceled"]);
    expect(status(read(RANGE, week))).toEqual(["done", "done", "canceled"]);
  });

  it("reopens a done or canceled task, and cancels one", () => {
    const all = { view: "all" };
    const { store, read } = fakeStore([{ name: TASKS, args: all, value: rows() }]);
    taskUpdated(store, { blockId: "t2", checked: false });
    taskUpdated(store, { blockId: "t3", canceled: false });
    taskUpdated(store, { blockId: "t1", canceled: true });
    expect(status(read(TASKS, all))).toEqual(["canceled", "open", "open"]);
  });

  it("leaves the lists alone for a change that isn't the task's status, or a task that isn't there", () => {
    const { store, writes } = fakeStore([
      { name: TASKS, args: { view: "all" }, value: rows() },
      { name: TASKS, args: { view: "inbox" }, value: undefined },
    ]);
    taskUpdated(store, { blockId: "t1" });
    taskUpdated(store, { blockId: "t2", checked: true });
    taskUpdated(store, { blockId: "nope", checked: true });
    expect(writes).toEqual([]);
  });
});
