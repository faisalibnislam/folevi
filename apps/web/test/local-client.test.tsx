// The hook conformance suite for local mode (docs/LOCAL_MODE_PLAN.md §2.1, risk R4): the real convex/react
// hooks run against LocalClient in jsdom. convex is pinned; run this again on every upgrade.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, Component, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConvexProvider, ConvexReactClient, useAction, useConvexConnectionState, useMutation, usePaginatedQuery, useQueries, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { api } from "@/lib/convex/api";
import { defineLocal, localStatus, undefineLocal } from "@/lib/local/registry";
import type { LocalClient } from "@/lib/local/client";
import type { MemoryStore } from "@/lib/local/store";
import { makeDoc, makeLibrary, settle } from "./local-fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Test-only functions (no server twin), registered by name.
const star = makeFunctionReference<"mutation", { id: string; starred: boolean }, null>("test:star");
const touch = makeFunctionReference<"mutation", { id: string; updatedAt: number }, null>("test:touch");
const insert = makeFunctionReference<"mutation", { id: string; updatedAt: number }, null>("test:insert");
const failing = makeFunctionReference<"mutation", { id: string }, null>("test:failing");
const preview = makeFunctionReference<"action", { url: string }, { title: string; starredBefore: boolean }>("test:preview");

defineLocal(star, "mutation", async (ctx, args) => {
  const d = await ctx.db.get("documents", args.id);
  if (!d) throw new ConvexError({ code: "not_found" });
  ctx.db.put("documents", d.id, { ...d, starred: args.starred });
  return null;
});
defineLocal(touch, "mutation", async (ctx, args) => {
  const d = (await ctx.db.get("documents", args.id))!;
  ctx.db.put("documents", d.id, { ...d, updatedAt: args.updatedAt });
  return null;
});
defineLocal(insert, "mutation", async (ctx, args) => {
  ctx.db.put("documents", args.id, makeDoc(args.id, { updatedAt: args.updatedAt, title: `New ${args.id}` }));
  return null;
});
defineLocal(failing, "mutation", async (ctx, args) => {
  ctx.db.put("documents", args.id, makeDoc(args.id));
  throw new ConvexError({ code: "invalid_argument", message: "no" });
});
defineLocal(preview, "action", async (ctx, args) => {
  const titles = await ctx.runQuery(api.documents.titles, { documentIds: ["D1"] });
  await ctx.runMutation(star, { id: "D1", starred: true });
  return { title: `${titles.D1?.title} at ${args.url}`, starredBefore: false };
});

/** Type-level checks: never run. A handler's kind and return type must be the server's. */
export function typeChecks() {
  // @ts-expect-error documents.get is a query, not a mutation
  defineLocal(api.documents.get, "mutation", async () => null);
  // @ts-expect-error documents.titles returns a record by id, not a list
  defineLocal(api.documents.titles, "query", async () => []);
  // @ts-expect-error workspaces.mine takes no arguments the handler could read
  defineLocal(api.workspaces.mine, "query", async (_ctx, args) => args.nothing);
}

let store: MemoryStore;
let client: LocalClient;
let root: Root;
let host: HTMLDivElement;
const seen: Record<string, unknown[]> = {};

function mount(node: ReactNode) {
  act(() => root.render(createElement(ConvexProvider, { client: client as unknown as ConvexReactClient }, node)));
}

beforeEach(async () => {
  const docs = Array.from({ length: 7 }, (_, i) => makeDoc(`D${i}`, { title: `Note ${i}`, updatedAt: 100 - i, starred: i % 2 === 0 }));
  ({ store, client } = await makeLibrary(docs));
  host = document.createElement("div");
  root = createRoot(host);
  for (const k of Object.keys(seen)) delete seen[k];
});
afterEach(async () => {
  act(() => root.unmount());
  await client.close();
});

const runsOf = (name: string, args: unknown) => client.queryRuns.get(`${name}|${JSON.stringify(args)}`);

describe("LocalClient drives the real convex/react hooks", () => {
  test("convex is pinned to the version this suite was written against", () => {
    const require = createRequire(import.meta.url);
    const installed = JSON.parse(readFileSync(require.resolve("convex/package.json"), "utf8")) as { version: string };
    const declared = JSON.parse(readFileSync(require.resolve("../package.json"), "utf8")) as { dependencies: Record<string, string> };
    // An upgrade must come with a review of convex/react's client surface (lib/local/client.ts) and this suite.
    expect(declared.dependencies.convex).toBe("1.46.0");
    expect(installed.version).toBe("1.46.0");
  });

  test("useQuery: undefined while loading, then the result; a write it doesn't see keeps the same object", async () => {
    function Titles() {
      const titles = useQuery(api.documents.titles, { documentIds: ["D1", "D2"] });
      (seen.titles ??= []).push(titles);
      return createElement("p", null, titles ? Object.values(titles).map((t) => t.title).join(",") : "loading");
    }
    mount(createElement(Titles));
    expect(seen.titles![0]).toBeUndefined();
    await settle();
    expect(host.textContent).toBe("Note 1,Note 2");
    const before = seen.titles!.at(-1);
    // D1 changes, but nothing titles returns: it re-runs (it read D1) and keeps its object.
    await act(async () => void (await client.mutation(star, { id: "D1", starred: true })));
    await settle();
    expect(seen.titles!.at(-1)).toBe(before);
    expect(runsOf("documents:titles", { documentIds: ["D1", "D2"] })).toBe(2);
  });

  test("reactivity is scoped to what a query read", async () => {
    function Two() {
      const a = useQuery(api.documents.titles, { documentIds: ["D1"] });
      const b = useQuery(api.documents.titles, { documentIds: ["D2"] });
      return createElement("p", null, `${a?.D1?.title}|${b?.D2?.title}`);
    }
    mount(createElement(Two));
    await settle();
    expect(host.textContent).toBe("Note 1|Note 2");
    await act(async () => void (await client.mutation(star, { id: "D1", starred: false })));
    await settle();
    expect(runsOf("documents:titles", { documentIds: ["D1"] })).toBe(2);
    expect(runsOf("documents:titles", { documentIds: ["D2"] })).toBe(1);
  });

  test("useQueries (QueriesObserver) gets the same results", async () => {
    // (useQueries wants the same object from render to render, as the app memoizes it.)
    const requests = { a: { query: api.documents.titles, args: { documentIds: ["D3"] } }, b: { query: api.workspaces.mine, args: {} } };
    function Many() {
      const r = useQueries(requests);
      const a = r.a as Record<string, { title: string }> | undefined;
      return createElement("p", null, a ? `${a.D3!.title}|${JSON.stringify(r.b)}` : "loading");
    }
    mount(createElement(Many));
    await settle();
    expect(host.textContent).toBe("Note 3|[]");
  });

  test("usePaginatedQuery: first page, loadMore, an insert at the top doesn't shift pages, Exhausted", async () => {
    let paged: ReturnType<typeof usePaginatedQuery<typeof api.documents.list>> | null = null;
    function List() {
      paged = usePaginatedQuery(api.documents.list, { scope: { kind: "personal" }, view: "all" }, { initialNumItems: 3 });
      return createElement("p", null, `${paged.status}:${paged.results.map((d) => d.id).join(",")}`);
    }
    mount(createElement(List));
    expect(host.textContent).toBe("LoadingFirstPage:");
    await settle();
    expect(host.textContent).toBe("CanLoadMore:D0,D1,D2");
    act(() => paged!.loadMore(3));
    await settle();
    expect(host.textContent).toBe("CanLoadMore:D0,D1,D2,D3,D4,D5");
    // A new note at the top: the first page (pinned at its end) grows; nothing is duplicated or skipped.
    await act(async () => void (await client.mutation(insert, { id: "N", updatedAt: 999 })));
    await settle();
    expect(host.textContent).toBe("CanLoadMore:N,D0,D1,D2,D3,D4,D5");
    // A note on the second page edited: it moves to the top, out of the second page and into the first.
    await act(async () => void (await client.mutation(touch, { id: "D4", updatedAt: 1000 })));
    await settle();
    expect(host.textContent).toBe("CanLoadMore:D4,N,D0,D1,D2,D3,D5");
    act(() => paged!.loadMore(3));
    await settle();
    expect(host.textContent).toBe("Exhausted:D4,N,D0,D1,D2,D3,D5,D6");
    // The last page took in everything to the end: a note made long ago still shows up.
    await act(async () => void (await client.mutation(insert, { id: "OLD", updatedAt: 0 })));
    await settle();
    expect(host.textContent).toBe("Exhausted:D4,N,D0,D1,D2,D3,D5,D6,OLD");
  });

  test("useMutation, useAction (with runQuery and runMutation) and useConvexConnectionState", async () => {
    let doStar: ((a: { id: string; starred: boolean }) => Promise<null>) | null = null;
    let doPreview: ((a: { url: string }) => Promise<{ title: string }>) | null = null;
    function A() {
      doStar = useMutation(star);
      doPreview = useAction(preview);
      const state = useConvexConnectionState();
      const starred = usePaginatedQuery(api.documents.list, { scope: { kind: "personal" }, view: "starred" }, { initialNumItems: 20 });
      return createElement("p", null, `${state.isWebSocketConnected}:${starred.results.map((d) => d.id).join(",")}`);
    }
    mount(createElement(A));
    await settle();
    expect(host.textContent).toBe("true:D0,D2,D4,D6");
    await act(async () => void (await doStar!({ id: "D3", starred: true })));
    await settle();
    expect(host.textContent).toBe("true:D0,D2,D3,D4,D6");
    await expect(doPreview!({ url: "https://example.com" })).resolves.toMatchObject({ title: "Note 1 at https://example.com" });
    await settle();
    expect(host.textContent).toBe("true:D0,D1,D2,D3,D4,D6");
  });

  test("a function local mode doesn't have throws local_unsupported into the error boundary", async () => {
    class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
      override state = { error: null as unknown };
      static getDerivedStateFromError(error: unknown) {
        return { error };
      }
      override render() {
        const e = this.state.error;
        return e ? createElement("p", null, `caught:${e instanceof ConvexError ? `${(e.data as { code: string }).code}:${(e.data as { capability?: string }).capability}` : String(e)}`) : this.props.children;
      }
    }
    function Hidden() {
      useQuery(api.sharing.get, { documentId: "D1" });
      return createElement("p", null, "rendered");
    }
    const errors = console.error;
    console.error = () => {};
    try {
      mount(createElement(Boundary, null, createElement(Hidden)));
      await settle();
      expect(host.textContent).toBe("caught:local_unsupported:sharing");
      // Not ported yet (planned), and never heard of: the same error, no capability.
      await expect(client.query(api.tasks.counts, {} as never)).rejects.toMatchObject({ data: { code: "local_unsupported" } });
      await expect(client.mutation(makeFunctionReference<"mutation">("nowhere:atAll"), {})).rejects.toBeInstanceOf(ConvexError);
    } finally {
      console.error = errors;
    }
    expect(localStatus("documents.get").kind).toBe("ported");
    expect(localStatus("sharing.get")).toEqual({ kind: "hidden", capability: "sharing" });
    expect(localStatus("tasks.counts")).toEqual({ kind: "planned", phase: "L2" });
    expect(localStatus("nowhere.atAll")).toEqual({ kind: "unclassified" });
  });

  test("mutations run one at a time, in call order; one that throws writes nothing", async () => {
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((i) => client.mutation(insert, { id: `O${i}`, updatedAt: i }).then(() => order.push(i))));
    expect(order).toEqual([1, 2, 3]);
    const commits = store.commits;
    await expect(client.mutation(failing, { id: "X" })).rejects.toMatchObject({ data: { code: "invalid_argument" } });
    expect(store.commits).toBe(commits);
    expect(await store.get("documents", "X")).toBeUndefined();
  });

  test("a handler registered twice is a mistake", () => {
    expect(() => defineLocal(star, "mutation", async () => null)).toThrow(/already has a local handler/);
    undefineLocal(makeFunctionReference<"query">("never:registered"));
  });
});
