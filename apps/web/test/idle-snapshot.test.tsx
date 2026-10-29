import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IDLE_SNAPSHOT_MS, useIdleSnapshot } from "@/lib/hooks/useIdleSnapshot";
import type { SyncEngine } from "@/lib/sync/engine";

// The note's idle version (lib/hooks/useIdleSnapshot.ts): followed outside rendering since docs/WEB_PERFORMANCE.md,
// with the same timing as when the page drew again on every save.

type Op = { documentId: string };
function fakeEngine() {
  const listeners = new Set<() => void>();
  const engine = {
    state: { pending: [] as Op[], inflight: [] as Op[] },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const set = (pending: Op[], inflight: Op[] = []) => {
    engine.state = { pending, inflight };
    for (const l of [...listeners]) l();
  };
  return { engine: engine as unknown as SyncEngine, set, listeners };
}

let host: HTMLDivElement;
let root: Root;
let renders = 0;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  root = createRoot(host);
  renders = 0;
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

function Note({ engine, writable = true, create, restart }: { engine: SyncEngine; writable?: boolean; create: (a: { documentId: string; reason: "idle" }) => Promise<unknown>; restart?: unknown }) {
  renders++;
  const lastEditAt = useRef<number | null>(null);
  useIdleSnapshot(engine, "doc1", writable, restart, create, lastEditAt);
  return null;
}

describe("idle version", () => {
  test("a version once the note's saves have settled for two minutes, and the page isn't drawn again for each save", () => {
    const { engine, set } = fakeEngine();
    const create = vi.fn(async () => undefined);
    act(() => root.render(<Note engine={engine} create={create} />));
    const drawn = renders;
    // Typing: saves queued, sent and done, several times.
    for (let i = 0; i < 5; i++) {
      act(() => set([{ documentId: "doc1" }]));
      act(() => set([], [{ documentId: "doc1" }]));
      act(() => set([]));
      act(() => vi.advanceTimersByTime(10_000));
    }
    expect(renders).toBe(drawn);
    expect(create).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(IDLE_SNAPSHOT_MS - 10_001));
    expect(create).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ documentId: "doc1", reason: "idle" });
    // Nothing edited since: no other version.
    act(() => vi.advanceTimersByTime(IDLE_SNAPSHOT_MS * 2));
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("no version without an edit, for a read-only note, or while anything is still on its way", () => {
    const { engine, set } = fakeEngine();
    const create = vi.fn(async () => undefined);
    act(() => root.render(<Note engine={engine} create={create} />));
    act(() => vi.advanceTimersByTime(IDLE_SNAPSHOT_MS * 2));
    expect(create).not.toHaveBeenCalled();
    // Another note's save in flight counts as on its way too (as before).
    act(() => set([{ documentId: "doc1" }]));
    act(() => set([], [{ documentId: "other" }]));
    act(() => vi.advanceTimersByTime(IDLE_SNAPSHOT_MS * 2));
    expect(create).not.toHaveBeenCalled();
    act(() => set([]));
    act(() => vi.advanceTimersByTime(IDLE_SNAPSHOT_MS));
    expect(create).toHaveBeenCalledTimes(1);

    const readOnly = fakeEngine();
    const create2 = vi.fn(async () => undefined);
    act(() => root.render(<Note engine={readOnly.engine} writable={false} create={create2} />));
    act(() => readOnly.set([{ documentId: "doc1" }]));
    act(() => readOnly.set([]));
    act(() => vi.advanceTimersByTime(IDLE_SNAPSHOT_MS * 2));
    expect(create2).not.toHaveBeenCalled();
  });

  test("the note's details arriving start the wait again; unmounting stops it", () => {
    const { engine, set, listeners } = fakeEngine();
    const create = vi.fn(async () => undefined);
    act(() => root.render(<Note engine={engine} create={create} restart={1} />));
    act(() => set([{ documentId: "doc1" }]));
    act(() => set([]));
    act(() => vi.advanceTimersByTime(IDLE_SNAPSHOT_MS - 1000));
    act(() => root.render(<Note engine={engine} create={create} restart={2} />));
    act(() => vi.advanceTimersByTime(1000));
    expect(create).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(IDLE_SNAPSHOT_MS - 1000));
    expect(create).toHaveBeenCalledTimes(1);
    act(() => set([{ documentId: "doc1" }]));
    act(() => set([]));
    act(() => root.unmount());
    root = createRoot(host);
    expect(listeners.size).toBe(0);
    act(() => vi.advanceTimersByTime(IDLE_SNAPSHOT_MS * 2));
    expect(create).toHaveBeenCalledTimes(1);
  });
});
