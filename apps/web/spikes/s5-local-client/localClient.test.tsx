// SPIKE S5 (docs/LOCAL_MODE.md): the real convex/react hooks against LocalClient in jsdom.
// Run: cd apps/web && npx vitest run --config spikes/vitest.config.ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, Component, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConvexProvider, ConvexReactClient, useAction, useConvexConnectionState, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { makeFunctionReference, type FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "@/lib/convex/api";
import { defineLocal, LocalClient, MemoryStore } from "./localClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TitleRow = FunctionReturnType<typeof api.documents.titles>[string];
// `style` is the server's own type, so a handler that returned a wrong shape fails to typecheck (the
// first draft of this spike returned `undefined` for both and tsc refused it).
type Doc = { id: string; title: string; updatedAt: number; starred: boolean; style?: TitleRow["style"] };
const cursorOf = (d: Doc) => `${String(1e15 - d.updatedAt).padStart(16, "0")}|${d.id}`;

// ---- handlers (typed against the server functions where the shape is simple) ----
defineLocal("query", api.documents.titles, (ctx, args) => {
  const out: FunctionReturnType<typeof api.documents.titles> = {};
  for (const id of args.documentIds) {
    const d = ctx.get("documents", id) as Doc | undefined;
    if (d) out[id] = { title: d.title, icon: null, excerpt: "", inTrash: false, cover: { kind: "none" }, style: d.style! };
  }
  return out;
});
defineLocal("query", api.documents.list, (ctx, args) => {
  const all = (ctx.all("documents") as Doc[]).filter((d) => args.view !== "starred" || d.starred).sort((a, b) => cursorOf(a).localeCompare(cursorOf(b)));
  const { cursor, numItems, endCursor } = args.paginationOpts;
  const from = cursor ? all.filter((d) => cursorOf(d) > cursor) : all;
  // A pinned page (endCursor) grows or shrinks with writes instead of shifting into the next one.
  const page = endCursor !== undefined && endCursor !== null ? from.filter((d) => cursorOf(d) <= endCursor) : from.slice(0, numItems);
  const last = page[page.length - 1];
  const continueCursor = endCursor ?? (last ? cursorOf(last) : (cursor ?? ""));
  const isDone = from.filter((d) => cursorOf(d) > continueCursor).length === 0;
  return { page, isDone, continueCursor } as unknown as FunctionReturnType<typeof api.documents.list>;
});
defineLocal("mutation", api.documents.setStarred, (ctx, args) => {
  const d = ctx.get("documents", args.documentId) as Doc | undefined;
  if (!d) throw new ConvexError({ code: "not_found" });
  ctx.put("documents", d.id, { ...d, starred: args.starred, updatedAt: d.updatedAt + 1 });
  return null as unknown as FunctionReturnType<typeof api.documents.setStarred>;
});
defineLocal("mutation", api.clock.now, () => 1234);
defineLocal("action", api.bookmarks.preview, async (_ctx, args) => ({ url: args.url, title: "Local", description: "", image: null, icon: null, siteName: "" }) as unknown as FunctionReturnType<typeof api.bookmarks.preview>);

// A mutation that inserts a document (no server twin; registered by name for the test).
const insertRef = makeFunctionReference<"mutation", { id: string; title: string; updatedAt: number }, null>("spike:insert");
defineLocal("mutation", insertRef, (ctx, args) => {
  ctx.put("documents", args.id, { ...args, starred: false });
  return null;
});

let store: MemoryStore;
let client: LocalClient;
let root: Root;
let host: HTMLDivElement;
const seen: Record<string, unknown[]> = {};

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)));
};
function mount(node: ReactNode) {
  act(() => root.render(createElement(ConvexProvider, { client: client as unknown as ConvexReactClient }, node)));
}

beforeEach(() => {
  store = new MemoryStore();
  const docs: Doc[] = Array.from({ length: 7 }, (_, i) => ({ id: `D${i}`, title: `Note ${i}`, updatedAt: 100 - i, starred: i % 2 === 0 }));
  store.commit(new Map(docs.map((d) => [`documents:${d.id}`, d])), new Set());
  client = new LocalClient(store);
  host = document.createElement("div");
  root = createRoot(host);
  for (const k of Object.keys(seen)) delete seen[k];
});
afterEach(() => act(() => root.unmount()));

describe("LocalClient drives the real convex/react hooks", () => {
  test("useQuery: undefined while loading, then the result; a write re-runs it", async () => {
    let star: ((a: { documentId: string; starred: boolean }) => Promise<unknown>) | null = null;
    function Titles() {
      const titles = useQuery(api.documents.titles, { documentIds: ["D1", "D2"] });
      (seen.titles ??= []).push(titles);
      star = useMutation(api.documents.setStarred);
      return createElement("p", null, titles ? Object.values(titles).map((t) => t.title).join(",") : "loading");
    }
    mount(createElement(Titles));
    expect(seen.titles![0]).toBeUndefined();
    await flush();
    expect(host.textContent).toBe("Note 1,Note 2");
    const before = seen.titles![seen.titles!.length - 1];
    // A write to D1 that doesn't change the result keeps the same object (stable reference).
    await act(async () => void (await star!({ documentId: "D1", starred: true })));
    await flush();
    expect(seen.titles![seen.titles!.length - 1]).toBe(before);
    expect(client.stats.runs.get(`documents:titles|${JSON.stringify({ documentIds: ["D1", "D2"] })}`)).toBe(2);
  });

  test("reactivity is scoped to what a query read", async () => {
    function Two() {
      const a = useQuery(api.documents.titles, { documentIds: ["D1"] });
      const b = useQuery(api.documents.titles, { documentIds: ["D2"] });
      return createElement("p", null, `${a?.D1?.title}|${b?.D2?.title}`);
    }
    mount(createElement(Two));
    await flush();
    await act(async () => void (await client.mutation(api.documents.setStarred, { documentId: "D1", starred: false })));
    await flush();
    // D1's query re-ran; D2's didn't. (The "documents:*" key is only read by list queries.)
    expect(client.stats.runs.get(`documents:titles|{"documentIds":["D1"]}`)).toBe(2);
    expect(client.stats.runs.get(`documents:titles|{"documentIds":["D2"]}`)).toBe(1);
  });

  test("usePaginatedQuery: first page, loadMore, Exhausted, and an insert at the top doesn't shift pages", async () => {
    let api_: ReturnType<typeof usePaginatedQuery<typeof api.documents.list>> | null = null;
    function List() {
      api_ = usePaginatedQuery(api.documents.list, { scope: { kind: "personal" }, view: "all" } as never, { initialNumItems: 3 });
      return createElement("p", null, `${api_.status}:${(api_.results as unknown as Doc[]).map((d) => d.id).join(",")}`);
    }
    mount(createElement(List));
    expect(host.textContent).toBe("LoadingFirstPage:");
    await flush();
    expect(host.textContent).toBe("CanLoadMore:D0,D1,D2");
    act(() => api_!.loadMore(3));
    await flush();
    expect(host.textContent).toBe("CanLoadMore:D0,D1,D2,D3,D4,D5");
    // A new note at the top: the pinned first page grows; nothing is duplicated or skipped.
    await act(async () => void (await client.mutation(insertRef, { id: "N", title: "New", updatedAt: 999 })));
    await flush();
    expect(host.textContent).toBe("CanLoadMore:N,D0,D1,D2,D3,D4,D5");
    act(() => api_!.loadMore(3));
    await flush();
    expect(host.textContent).toBe("Exhausted:N,D0,D1,D2,D3,D4,D5,D6");
  });

  test("useAction and useConvexConnectionState", async () => {
    let preview: ((a: { url: string }) => Promise<unknown>) | null = null;
    function A() {
      preview = useAction(api.bookmarks.preview);
      const state = useConvexConnectionState();
      return createElement("p", null, String(state.isWebSocketConnected));
    }
    mount(createElement(A));
    expect(host.textContent).toBe("true");
    await expect(preview!({ url: "https://example.com" })).resolves.toMatchObject({ title: "Local" });
    await expect(client.mutation(api.clock.now, {})).resolves.toBe(1234);
  });

  test("an unported function throws local_unsupported into the error boundary", async () => {
    class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
      override state = { error: null as unknown };
      static getDerivedStateFromError(error: unknown) {
        return { error };
      }
      override render() {
        const e = this.state.error;
        return e ? createElement("p", null, `caught:${e instanceof ConvexError ? (e.data as { code: string }).code : String(e)}`) : this.props.children;
      }
    }
    function Unported() {
      useQuery(api.sharing.get as never, { documentId: "D1" } as never);
      return createElement("p", null, "rendered");
    }
    const errors = console.error;
    console.error = () => {};
    try {
      mount(createElement(Boundary, null, createElement(Unported)));
      await flush();
    } finally {
      console.error = errors;
    }
    expect(host.textContent).toBe("caught:local_unsupported");
    await expect(client.mutation(api.sharing.get as never, {})).rejects.toBeInstanceOf(ConvexError);
  });

  test("mutations run in call order, one at a time", async () => {
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((i) => client.mutation(insertRef, { id: `O${i}`, title: "", updatedAt: i }).then(() => order.push(i))));
    expect(order).toEqual([1, 2, 3]);
  });
});
