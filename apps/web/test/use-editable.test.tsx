// useEditable (components/editor/useEditable.ts), performance review S14: every block view listened to the
// editor itself, so each key called every image, file and formula in the note twice. The editor is now heard
// once for all of them, and they are told only when the note turns read-only or back.
import { afterEach, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/core";
import { useEditable } from "@/components/editor/useEditable";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeEditor() {
  const handlers = new Map<string, Set<() => void>>();
  const editor = {
    isEditable: true,
    isDestroyed: false,
    on: vi.fn((name: string, cb: () => void) => void (handlers.get(name) ?? handlers.set(name, new Set()).get(name)!).add(cb)),
    off: vi.fn((name: string, cb: () => void) => void handlers.get(name)?.delete(cb)),
    emit: (name: string) => [...(handlers.get(name) ?? [])].forEach((cb) => cb()),
    count: (name: string) => handlers.get(name)?.size ?? 0,
  };
  return editor;
}

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

test("twenty views share one listener on the editor, and redraw only when the answer changes", async () => {
  const editor = fakeEditor();
  const draws = vi.fn();
  function View({ n }: { n: number }) {
    const editable = useEditable(editor as unknown as Editor);
    draws(n, editable);
    return <span>{editable ? "can edit" : "read only"}</span>;
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(Array.from({ length: 20 }, (_, n) => <View key={n} n={n} />)));
  expect(editor.count("transaction")).toBe(1);
  expect(editor.count("update")).toBe(1);
  expect(draws).toHaveBeenCalledTimes(20);

  // Typing: a transaction and an update per key, and nothing to tell the views.
  await act(async () => {
    for (let i = 0; i < 50; i++) {
      editor.emit("transaction");
      editor.emit("update");
    }
  });
  expect(draws).toHaveBeenCalledTimes(20);

  // The note turns read-only: every view hears, once.
  editor.isEditable = false;
  await act(async () => editor.emit("update"));
  expect(draws).toHaveBeenCalledTimes(40);
  expect(host.textContent).toContain("read only");
  expect(host.textContent).not.toContain("can edit");

  // The views gone, the editor is let go of.
  act(() => root!.unmount());
  root = null;
  expect(editor.count("transaction")).toBe(0);
  expect(editor.count("update")).toBe(0);
  expect(editor.count("destroy")).toBe(0);
});
