// Local mode's reactive query cache (lib/local/queryCache.ts): minimal re-runs in one batch, stable results,
// pinned page ends, eviction, and a change of runner (handover between windows).
import { afterEach, describe, expect, test, vi } from "vitest";
import { QueryCache, type QueryRunner } from "@/lib/local/queryCache";
import { END_CURSOR, paginate, sortKey } from "@/lib/local/paginate";

const tick = () => new Promise((r) => setTimeout(r, 0));

function counter(results: Record<string, () => { value: unknown; deps: string[] }>) {
  const calls: string[] = [];
  const run: QueryRunner = async (name, args) => {
    calls.push(`${name}${JSON.stringify(args)}`);
    return results[name]!();
  };
  return { run, calls };
}

afterEach(() => vi.useRealTimers());

describe("QueryCache", () => {
  test("one entry per function and canonical args, shared by every watch", async () => {
    const { run, calls } = counter({ a: () => ({ value: 1, deps: ["doc:1"] }) });
    const cache = new QueryCache(run);
    const w1 = cache.watch("a", { x: 1, y: 2 });
    const w2 = cache.watch("a", { y: 2, x: 1 });
    w1.subscribe(() => {});
    w2.subscribe(() => {});
    await tick();
    expect(calls).toHaveLength(1);
    expect(w1.current()).toEqual({ value: 1 });
    expect(w2.current()).toBe(w1.current());
  });

  test("a batch of changes re-runs each dirty entry once, and only those", async () => {
    let n = 0;
    const { run, calls } = counter({ a: () => ({ value: ++n, deps: ["doc:1"] }), b: () => ({ value: "b", deps: ["doc:2"] }) });
    const cache = new QueryCache(run);
    const seen: number[] = [];
    const a = cache.watch("a", {});
    a.subscribe(() => seen.push((a.current() as { value: number }).value));
    cache.watch("b", {}).subscribe(() => {});
    await tick();
    calls.length = 0;
    cache.invalidate(["doc:1"]);
    cache.invalidate(["doc:1", "catalog"]);
    cache.invalidate(["doc:3"]);
    await tick();
    expect(calls).toEqual(["a{}"]);
    expect(seen).toEqual([1, 2]);
  });

  test("an unchanged result keeps its object, and subscribers aren't told", async () => {
    let title = "One";
    const { run } = counter({ a: () => ({ value: { title, list: [1, 2] }, deps: ["doc:1"] }) });
    const cache = new QueryCache(run);
    const w = cache.watch("a", {});
    const cb = vi.fn();
    w.subscribe(cb);
    await tick();
    const first = w.current();
    cache.invalidate(["doc:1"]);
    await tick();
    expect(w.current()).toBe(first);
    expect(cb).toHaveBeenCalledTimes(1);
    title = "Two";
    cache.invalidate(["doc:1"]);
    await tick();
    expect(w.current()).not.toBe(first);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  test("a change while a run is in flight runs it again afterwards", async () => {
    let release: () => void = () => {};
    let n = 0;
    const run: QueryRunner = async () => {
      const mine = ++n;
      if (mine === 2) await new Promise<void>((r) => (release = r));
      return { value: mine, deps: ["k"] };
    };
    const cache = new QueryCache(run);
    const w = cache.watch("a", {});
    w.subscribe(() => {});
    await tick();
    cache.invalidate(["k"]);
    await tick();
    cache.invalidate(["k"]);
    await tick();
    release();
    await tick();
    await tick();
    expect(w.current()).toEqual({ value: 3 });
  });

  test("nobody subscribed: a change marks it stale, and the next look runs it", async () => {
    let n = 0;
    const { run, calls } = counter({ a: () => ({ value: ++n, deps: ["k"] }) });
    const cache = new QueryCache(run);
    const w = cache.watch("a", {});
    const off = w.subscribe(() => {});
    await tick();
    off();
    cache.invalidate(["k"]);
    await tick();
    expect(calls).toHaveLength(1);
    expect(w.current()).toEqual({ value: 1 });
    await tick();
    expect(calls).toHaveLength(2);
    expect(w.current()).toEqual({ value: 2 });
  });

  test("entries nobody subscribes to are dropped after the grace period", async () => {
    vi.useFakeTimers();
    const { run } = counter({ a: () => ({ value: 1, deps: [] }) });
    const cache = new QueryCache(run, 5000);
    const w = cache.watch("a", {});
    const off = w.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cache.size).toBe(1);
    off();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(cache.size).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(cache.size).toBe(0);
  });

  test("an error is the state, and stays the same error until the result changes", async () => {
    let fail = true;
    const run: QueryRunner = async () => {
      if (fail) throw new Error("nope");
      return { value: "ok", deps: ["k"] };
    };
    const cache = new QueryCache(run);
    const w = cache.watch("a", {});
    w.subscribe(() => {});
    await tick();
    const e = w.current();
    expect(e).toMatchObject({ error: { message: "nope" } });
    fail = false;
    cache.invalidateAll();
    await tick();
    expect(w.current()).toEqual({ value: "ok" });
  });

  test("a page keeps its end: later runs get the first run's continueCursor as endCursor", async () => {
    const rows = ["b", "c", "d", "e"];
    const seenOpts: unknown[] = [];
    const run: QueryRunner = async (_name, args) => {
      const opts = args.paginationOpts as { cursor: string | null; numItems: number; endCursor?: string | null };
      seenOpts.push(opts);
      return { value: paginate(rows, (r) => r, opts), deps: ["catalog"] };
    };
    const cache = new QueryCache(run);
    const w = cache.watch("list", { paginationOpts: { cursor: null, numItems: 2 } });
    w.subscribe(() => {});
    await tick();
    expect((w.current() as { value: { page: string[] } }).value.page).toEqual(["b", "c"]);
    rows.unshift("a");
    cache.invalidate(["catalog"]);
    await tick();
    expect((w.current() as { value: { page: string[]; continueCursor: string } }).value).toMatchObject({ page: ["a", "b", "c"], continueCursor: "c" });
    expect(seenOpts[1]).toEqual({ cursor: null, numItems: 2, endCursor: "c" });
  });

  test("setRunner re-runs everything on the new runner", async () => {
    const cache = new QueryCache(async () => ({ value: "old", deps: [] }));
    const w = cache.watch("a", {});
    w.subscribe(() => {});
    await tick();
    cache.setRunner(async () => ({ value: "new", deps: [] }));
    await tick();
    expect(w.current()).toEqual({ value: "new" });
  });
});

describe("paginate", () => {
  const rows = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, key: sortKey(String(i), id) }));
  const key = (r: { key: string }) => r.key;
  test("pages by numItems, then to the end", () => {
    const one = paginate(rows, key, { cursor: null, numItems: 2 });
    expect(one.page.map((r) => r.id)).toEqual(["a", "b"]);
    expect(one.isDone).toBe(false);
    const two = paginate(rows, key, { cursor: one.continueCursor, numItems: 5 });
    expect(two.page.map((r) => r.id)).toEqual(["c", "d", "e"]);
    expect(two).toMatchObject({ isDone: true, continueCursor: END_CURSOR });
  });
  test("a pinned end takes the rows up to it, and the end cursor everything after", () => {
    expect(paginate(rows, key, { cursor: null, numItems: 1, endCursor: rows[2]!.key }).page.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(paginate(rows, key, { cursor: rows[2]!.key, numItems: 1, endCursor: END_CURSOR })).toMatchObject({ isDone: true, continueCursor: END_CURSOR });
  });
  test("an empty list is done at once", () => {
    expect(paginate([], key, { cursor: null, numItems: 10 })).toEqual({ page: [], isDone: true, continueCursor: END_CURSOR });
  });
});
