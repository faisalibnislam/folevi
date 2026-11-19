// A collection's text fields (components/editor/collection/LiveInput.tsx): what is typed in one is saved when
// it is left, and "left" includes every way a field goes away without a blur. Each of those used to lose the
// typing: the note closing, the page hiding or closing, and the field's own row leaving the view.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LiveInput, commitTypedFields, useCommitOnLeave } from "@/components/editor/collection/LiveInput";
import { FLUSH_BLOCKS_EVENT } from "@/components/editor/canvas/leaveFlush";
import { entriesOfCollection, sameEntries } from "@/components/editor/collection/collectionData";
import { useOutboxSelect } from "@/lib/sync/queryCache";
import type { Outbox, OutboxEntry } from "@/lib/sync/outbox";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let mounted: { root: Root; host: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    act(() => mounted!.root.unmount());
    mounted.host.remove();
  }
  mounted = null;
  vi.restoreAllMocks();
});

function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  mounted = { root, host };
  return { host, root, input: () => host.querySelector("input")! };
}

/** Typing, as React hears it: the field's own value set, then the event a key sends. */
function typeIn(input: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("typing in a collection field", () => {
  test("leaving the field saves it once; a field nobody typed in saves nothing", () => {
    const commit = vi.fn();
    const t = render(<LiveInput value="Tea" onCommit={commit} aria-label="Name" />);
    act(() => t.input().focus());
    act(() => t.input().blur());
    expect(commit).not.toHaveBeenCalled();
    act(() => t.input().focus());
    typeIn(t.input(), "Green tea");
    expect(t.input().value).toBe("Green tea");
    act(() => t.input().blur());
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("Green tea", { badInput: false });
    // Shown again as the value (the collection's own, which is what was saved).
    expect(t.input().value).toBe("Tea");
  });

  test("the field going away without a blur saves what was typed (the note closing, its row leaving the view)", () => {
    const commit = vi.fn();
    const t = render(<LiveInput value="" onCommit={commit} aria-label="Value" />);
    act(() => t.input().focus());
    typeIn(t.input(), "half a sentence");
    act(() => t.root.render(null));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("half a sentence", { badInput: false });
  });

  test("the page closing, the app going to the background and the note's last save each save it, and only once", () => {
    for (const leave of [
      () => window.dispatchEvent(new Event("pagehide")),
      () => window.dispatchEvent(new CustomEvent(FLUSH_BLOCKS_EVENT)),
      () => {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
      },
      () => commitTypedFields(),
    ]) {
      const commit = vi.fn();
      const t = render(<LiveInput value="12" onCommit={commit} aria-label="Value" />);
      act(() => t.input().focus());
      typeIn(t.input(), "1250");
      act(() => leave());
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith("1250", { badInput: false });
      // Leaving it afterwards, or the field going away, doesn't save it a second time.
      act(() => t.input().blur());
      act(() => t.root.unmount());
      expect(commit).toHaveBeenCalledTimes(1);
      t.host.remove();
      mounted = null;
      vi.restoreAllMocks();
    }
  });

  test("becoming visible again saves nothing; Escape gives the typing up, whatever happens next", () => {
    const commit = vi.fn();
    const t = render(<LiveInput value="12" onCommit={commit} aria-label="Value" />);
    act(() => t.input().focus());
    typeIn(t.input(), "99");
    act(() => void document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
    expect(commit).not.toHaveBeenCalled();
    act(() => void t.input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(t.input().value).toBe("12");
    act(() => void window.dispatchEvent(new Event("pagehide")));
    act(() => t.root.render(null));
    expect(commit).not.toHaveBeenCalled();
  });

  test("says when the browser couldn't read what was typed (letters in a number field)", () => {
    const commit = vi.fn();
    const t = render(<LiveInput type="number" value="1200" onCommit={commit} aria-label="Pages" />);
    act(() => t.input().focus());
    // WebKit lets "12-" be typed in a number field and reports its text as empty, with badInput.
    Object.defineProperty(t.input(), "validity", { configurable: true, value: { badInput: true } });
    typeIn(t.input(), "");
    act(() => t.input().blur());
    expect(commit).toHaveBeenCalledWith("", { badInput: true });
    // The same when the field goes away with it still typed.
    typeIn(t.input(), "7");
    typeIn(t.input(), "");
    act(() => t.root.render(null));
    expect(commit).toHaveBeenLastCalledWith("", { badInput: true });
    expect(commit).toHaveBeenCalledTimes(2);
  });

  test("useCommitOnLeave runs the latest commit when the field goes away, for a field of its own (a new row's name)", () => {
    const saved: string[] = [];
    function Name({ text }: { text: string }) {
      useCommitOnLeave(() => {
        if (text) saved.push(text);
      });
      return <input aria-label="New row name" defaultValue={text} />;
    }
    const t = render(<Name text="Mid" />);
    act(() => t.root.render(<Name text="Middlemarch" />));
    act(() => t.root.render(null));
    expect(saved).toEqual(["Middlemarch"]);
  });
});

describe("a collection listening to the outbox", () => {
  test("is drawn again for its own waiting changes, not for anything else's", () => {
    const listeners = new Set<() => void>();
    const entry = (collectionId: string, n: number) => ({ id: `e${n}`, name: "collections.setValue", args: { collectionId }, keys: [], label: "", createdAt: n, attempts: 0 }) as unknown as OutboxEntry;
    const outbox = { entries: [] as OutboxEntry[], subscribe: (cb: () => void) => (listeners.add(cb), () => listeners.delete(cb)) };
    const queue = (e: OutboxEntry) =>
      act(() => {
        outbox.entries = [...outbox.entries, e];
        for (const l of [...listeners]) l();
      });
    let draws = 0;
    function Watcher() {
      // As the embed reads its collection's entries (CollectionEmbed's useCollection).
      const select = useCallback((entries: readonly OutboxEntry[]) => entriesOfCollection(entries, "A"), []);
      const mine = useOutboxSelect(outbox as unknown as Outbox, select, sameEntries);
      const [, force] = useState(0);
      void force;
      draws++;
      return <p>{mine.length}</p>;
    }
    const t = render(<Watcher />);
    const start = draws;
    queue(entry("B", 1));
    queue({ ...entry("B", 2), name: "comments.add", args: { threadId: "t" } } as unknown as OutboxEntry);
    expect(draws).toBe(start);
    queue(entry("A", 3));
    expect(draws).toBe(start + 1);
    expect(t.host.textContent).toBe("1");
  });
});
