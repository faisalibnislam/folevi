"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/core";

/**
 * One listener per editor for all of its block views. Each view once listened to the editor itself (every
 * update and every transaction, twice per key for every image, file and formula in the note); now the editor
 * is heard once, and the views are told only when the answer changes.
 */
interface EditableWatch {
  listeners: Set<() => void>;
  last: boolean;
  check: () => void;
}
const watches = new WeakMap<Editor, EditableWatch>();

const read = (editor: Editor) => !editor.isDestroyed && Boolean(editor.isEditable);

function watch(editor: Editor, onChange: () => void): () => void {
  let w = watches.get(editor);
  if (!w) {
    const made: EditableWatch = {
      listeners: new Set(),
      last: read(editor),
      check: () => {
        const now = read(editor);
        if (now === made.last) return;
        made.last = now;
        for (const listener of [...made.listeners]) listener();
      },
    };
    watches.set(editor, (w = made));
  }
  const mine = w;
  if (!mine.listeners.size) {
    mine.last = read(editor);
    // setEditable emits "update"; a view becoming ready or losing focus comes as a transaction.
    editor.on("update", mine.check);
    editor.on("transaction", mine.check);
    editor.on("destroy", mine.check);
  }
  mine.listeners.add(onChange);
  return () => {
    mine.listeners.delete(onChange);
    if (mine.listeners.size) return;
    editor.off("update", mine.check);
    editor.off("transaction", mine.check);
    editor.off("destroy", mine.check);
  };
}

/**
 * Whether the editor is editable right now, kept current in a block view. React node views only re-render
 * when their node changes, so reading `editor.isEditable` at render would miss a note turning read-only.
 */
export function useEditable(editor: Editor): boolean {
  const subscribe = useCallback((onChange: () => void) => watch(editor, onChange), [editor]);
  const get = useCallback(() => read(editor), [editor]);
  return useSyncExternalStore(subscribe, get, () => false);
}
