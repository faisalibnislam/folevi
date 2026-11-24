// lib/convex/queries.ts: a failed query never reaches the page's error screen. It reads as still loading (or keeps
// its last good result), says it failed, and is asked again, here against LocalClient with the real convex/react.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, Component, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { defineLocal } from "@/lib/local/registry";
import type { LocalClient } from "@/lib/local/client";
import { queryRetry, resetQueryRetries, usePaginatedQuery, useQuery, useQueryState } from "@/lib/convex/queries";
import { LoadFailed } from "@/components/ui/LoadFailed";
import { makeDoc, makeLibrary, settle } from "./local-fixtures";

vi.unmock("@/lib/convex/queries");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Fails while `failing.on`; reads the documents table so a write re-runs it.
const failing = { on: true, runs: 0 };
const flaky = makeFunctionReference<"query", { tag: string }, string>("test:flaky");
defineLocal(flaky, "query", async (ctx, args) => {
  failing.runs++;
  const docs = await ctx.db.list("documents");
  if (failing.on) throw new ConvexError({ code: "unavailable" });
  return `${args.tag}:${docs.length}`;
});
const addDoc = makeFunctionReference<"mutation", { id: string }, null>("test:addSafeDoc");
defineLocal(addDoc, "mutation", async (ctx, args) => {
  ctx.db.put("documents", args.id, makeDoc(args.id));
  return null;
});
const locked = makeFunctionReference<"query", Record<string, never>, string>("test:lockedSafe");
defineLocal(locked, "query", async () => {
  throw new ConvexError({ code: "e2ee_locked_session", message: "locked" });
});
const flakyPages = makeFunctionReference<"query", { paginationOpts: { numItems: number; cursor: string | null } }, { page: string[]; isDone: boolean; continueCursor: string }>("test:flakyPages");
defineLocal(flakyPages, "query", async () => {
  if (failing.on) throw new ConvexError({ code: "unavailable" });
  return { page: ["a", "b"], isDone: true, continueCursor: "end" };
});

let client: LocalClient;
let root: Root;
let host: HTMLDivElement;
const saved = { ...queryRetry };

function mount(node: ReactNode) {
  act(() => root.render(createElement(ConvexProvider, { client: client as unknown as ConvexReactClient }, node)));
}

async function waitFor(check: () => boolean, ms = 2000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error(`still: ${host.textContent}`);
    await act(async () => await new Promise((r) => setTimeout(r, 10)));
  }
}

beforeEach(async () => {
  failing.on = true;
  failing.runs = 0;
  queryRetry.delaysMs = [40, 80];
  queryRetry.gapMs = 20;
  ({ client } = await makeLibrary([makeDoc("D1")]));
  host = document.createElement("div");
  root = createRoot(host);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  act(() => root.unmount());
  await client.close();
  resetQueryRetries();
  Object.assign(queryRetry, saved);
  vi.restoreAllMocks();
});

describe("queries that fail", () => {
  test("useQuery reads as loading instead of throwing, retries, and shows the answer once it comes", async () => {
    function View() {
      const v = useQuery(flaky, { tag: "x" });
      return createElement("p", null, v === undefined ? "loading" : v);
    }
    mount(createElement(View));
    await settle();
    expect(host.textContent).toBe("loading");
    await waitFor(() => failing.runs >= 2);
    expect(host.textContent).toBe("loading");
    failing.on = false;
    await waitFor(() => host.textContent === "x:1");
  });

  test("useQueryState says it failed, keeps the last good answer, and retry() asks at once", async () => {
    failing.on = false;
    queryRetry.delaysMs = [60_000];
    let retry: () => void = () => {};
    function View() {
      const s = useQueryState(flaky, { tag: "y" });
      retry = s.retry;
      return createElement("p", null, `${s.data ?? "none"}|${s.failed ? "failed" : "ok"}`);
    }
    mount(createElement(View));
    await waitFor(() => host.textContent === "y:1|ok");
    failing.on = true;
    await act(async () => void (await client.mutation(addDoc, { id: "D2" })));
    await waitFor(() => host.textContent === "y:1|failed");
    failing.on = false;
    act(() => retry());
    await waitFor(() => host.textContent === "y:2|ok");
  });

  test("usePaginatedQuery loads its first page after failures instead of throwing", async () => {
    function View() {
      const p = usePaginatedQuery(flakyPages, {}, { initialNumItems: 2 });
      return createElement("p", null, `${p.status}:${p.results.join(",")}:${p.failed ? "failed" : "ok"}`);
    }
    mount(createElement(View));
    await waitFor(() => host.textContent === "LoadingFirstPage::failed");
    failing.on = false;
    await waitFor(() => host.textContent === "Exhausted:a,b:ok");
  });

  test("a paginated list that failed keeps its results and stays failed through every retry", async () => {
    let pageRuns = 0;
    const listed = makeFunctionReference<"query", { paginationOpts: { numItems: number; cursor: string | null } }, { page: string[]; isDone: boolean; continueCursor: string }>("test:flakyListed");
    defineLocal(listed, "query", async (ctx) => {
      pageRuns++;
      const docs = await ctx.db.list("documents");
      if (failing.on) throw new ConvexError({ code: "unavailable" });
      return { page: docs.map((d) => d.id), isDone: true, continueCursor: "end" };
    });
    failing.on = false;
    const frames: string[] = [];
    function View() {
      const p = usePaginatedQuery(listed, {}, { initialNumItems: 5 });
      const text = `${p.results.join(",")}|${p.failed ? "failed" : "ok"}`;
      frames.push(text);
      return createElement("p", null, text);
    }
    mount(createElement(View));
    await waitFor(() => host.textContent === "D1|ok");
    failing.on = true;
    await act(async () => void (await client.mutation(addDoc, { id: "D2" })));
    await waitFor(() => host.textContent === "D1|failed");
    const from = frames.length;
    const runs = pageRuns;
    // At least two retries (each drops the query and starts it over from its first page).
    await waitFor(() => pageRuns >= runs + 2);
    expect(frames.slice(from).filter((f) => f !== "D1|failed")).toEqual([]);
    failing.on = false;
    await waitFor(() => host.textContent === "D1,D2|ok");
  });

  test("a failed list says what it couldn't load, with Try again", () => {
    const onRetry = vi.fn();
    act(() => root.render(createElement(LoadFailed, { what: "your notes", onRetry })));
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Couldn’t load your notes");
    act(() => host.querySelector("button")!.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test("the unlock refusal still reaches its boundary (E2eeGate's unlock screen)", async () => {
    class Boundary extends Component<{ children: ReactNode }, { code: string | null }> {
      override state = { code: null as string | null };
      static getDerivedStateFromError(e: unknown) {
        return { code: ((e as ConvexError<{ code: string }>).data?.code as string) ?? "other" };
      }
      override render() {
        return this.state.code ? createElement("p", null, `caught:${this.state.code}`) : this.props.children;
      }
    }
    function View() {
      useQuery(locked, {});
      return createElement("p", null, "rendered");
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount(createElement(Boundary, null, createElement(View)));
    await waitFor(() => host.textContent === "caught:e2ee_locked_session");
  });
});
