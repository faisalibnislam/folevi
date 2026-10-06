import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ConvexReactClient } from "convex/react";
import type { WireScope } from "@folevi/editor-schema";
import { SyncEngine } from "@/lib/sync/engine";
import { useEngineSelector, useLocalStorage } from "@/lib/hooks/useEngine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PERSONAL: WireScope = { kind: "personal" };
const offline = { mutation: vi.fn(async () => { throw new Error("offline"); }) } as unknown as ConvexReactClient;
const block = (id: string, text: string, revision?: number) => ({ id, type: "paragraph", parentId: null, rank: "V", schemaVersion: 1, text: [{ type: "text" as const, text }], props: {}, ...(revision ? { revision } : {}) });

/** Counts the sync state's saves to IndexedDB. */
function countSaves() {
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  return {
    get count() {
      return put.mock.contexts.filter((store) => (store as IDBObjectStore).name === "syncState").length;
    },
    restore: () => put.mockRestore(),
  };
}

describe("engine saves", () => {
  test("commits in a row share one save, and persisted() saves straight away", async () => {
    const engine = await SyncEngine.open(offline, "acct-perf-1", PERSONAL, "web-p1");
    engine.setOnline(false);
    await engine.persisted();
    const saves = countSaves();
    try {
      engine.upsertBlock("doc-1", block("a", "one"), ["content", "position"]);
      engine.upsertBlock("doc-1", block("b", "two"), ["content", "position"]);
      engine.reconcileDocument("doc-2", [block("c", "three", 1), block("d", "four", 1)]);
      await engine.persisted();
      expect(saves.count).toBe(1);
      const reopened = await SyncEngine.open(offline, "acct-perf-1", PERSONAL, "web-p1");
      expect(reopened.documentBlocks("doc-1").map((b) => b.id)).toEqual(["a", "b"]);
      expect(reopened.documentBlocks("doc-2").map((b) => b.id)).toEqual(["c", "d"]);
      reopened.dispose();
    } finally {
      saves.restore();
      engine.dispose();
    }
  });

  test("a commit is saved on its own a moment later", async () => {
    const engine = await SyncEngine.open(offline, "acct-perf-2", PERSONAL, "web-p2");
    engine.setOnline(false);
    await engine.persisted();
    const saves = countSaves();
    try {
      engine.upsertBlock("doc-1", block("a", "one"), ["content", "position"]);
      expect(saves.count).toBe(0);
      await new Promise((r) => setTimeout(r, 150));
      expect(saves.count).toBe(1);
    } finally {
      saves.restore();
      engine.dispose();
    }
  });

  test("once the page is hidden every commit is saved at once", async () => {
    const engine = await SyncEngine.open(offline, "acct-perf-3", PERSONAL, "web-p3");
    engine.setOnline(false);
    engine.upsertBlock("doc-1", block("a", "before"), ["content", "position"]);
    const saves = countSaves();
    try {
      // Sooner than a visible page's save would go.
      const soon = () => new Promise((r) => setTimeout(r, 10));
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      await soon();
      expect(saves.count).toBe(1);
      engine.upsertBlock("doc-1", block("a", "after"), ["content"]);
      await soon();
      expect(saves.count).toBe(2);
    } finally {
      saves.restore();
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      engine.dispose();
    }
  });
});

describe("a document's blocks", () => {
  test("come back as the same array until something in that document changes", async () => {
    const engine = await SyncEngine.open(offline, "acct-perf-4", PERSONAL, "web-p4");
    engine.setOnline(false);
    engine.reconcileDocument("doc-1", [block("a", "one", 1), block("b", "two", 1)]);
    engine.reconcileDocument("doc-2", [block("c", "three", 1)]);
    const first = engine.documentBlocks("doc-1");
    expect(first.map((b) => b.id)).toEqual(["a", "b"]);
    // Another note changes: this one's array stays.
    engine.upsertBlock("doc-2", block("c", "edited"), ["content"]);
    expect(engine.documentBlocks("doc-1")).toBe(first);
    // This one changes: a new array with the change.
    engine.upsertBlock("doc-1", block("b", "edited"), ["content"]);
    const second = engine.documentBlocks("doc-1");
    expect(second).not.toBe(first);
    expect(second[1]!.text[0]).toEqual({ type: "text", text: "edited" });
    // Rows the server no longer has are dropped (not ones with unsent edits), and other notes are left alone.
    engine.reconcileDocument("doc-1", [block("b", "two", 1)]);
    expect(engine.documentBlocks("doc-1").map((b) => b.id)).toEqual(["b"]);
    expect(engine.documentBlocks("doc-2").map((b) => b.id)).toEqual(["c"]);
    engine.dispose();
  });
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));

describe("useLocalStorage", () => {
  test("keeps its value and setter between renders, and function updates build on each other", () => {
    const seen: { value: string[]; set: (v: string[] | ((cur: string[]) => string[])) => void }[] = [];
    function Probe({ tick }: { tick: number }) {
      const [value, set] = useLocalStorage<string[]>("folevi:test-list", []);
      seen.push({ value, set });
      return <span>{tick}</span>;
    }
    act(() => root.render(<Probe tick={1} />));
    act(() => root.render(<Probe tick={2} />));
    expect(seen[1]!.value).toBe(seen[0]!.value);
    expect(seen[1]!.set).toBe(seen[0]!.set);
    act(() => {
      seen[1]!.set((cur) => [...cur, "a"]);
      seen[1]!.set((cur) => [...cur, "b"]);
    });
    const last = seen[seen.length - 1]!;
    expect(last.value).toEqual(["a", "b"]);
    expect(last.set).toBe(seen[0]!.set);
    act(() => root.render(<Probe tick={3} />));
    expect(seen[seen.length - 1]!.value).toBe(last.value);
  });
});

describe("useEngineSelector", () => {
  test("re-renders only when the selected value changes", async () => {
    const engine = await SyncEngine.open(offline, "acct-perf-5", PERSONAL, "web-p5");
    engine.setOnline(false);
    let renders = 0;
    function Probe() {
      renders++;
      const count = useEngineSelector(engine, (s) => s.conflicts.length);
      return <span>{count}</span>;
    }
    act(() => root.render(<Probe />));
    const before = renders;
    act(() => {
      engine.upsertBlock("doc-1", block("a", "one"), ["content", "position"]);
      engine.upsertBlock("doc-1", block("a", "two"), ["content"]);
    });
    expect(renders).toBe(before);
    engine.dispose();
  });
});
