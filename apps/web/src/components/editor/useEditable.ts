"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/core";

/**
 * Whether the editor is editable right now, kept current in a block view. React node views only re-render
 * when their node changes, so reading `editor.isEditable` at render would miss a note turning read-only
 * (setEditable emits "update"; a view becoming ready or losing focus comes as a transaction).
 */
export function useEditable(editor: Editor): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      editor.on("update", onChange);
      editor.on("transaction", onChange);
      editor.on("destroy", onChange);
      return () => {
        editor.off("update", onChange);
        editor.off("transaction", onChange);
        editor.off("destroy", onChange);
      };
    },
    [editor],
  );
  const read = useCallback(() => !editor.isDestroyed && Boolean(editor.isEditable), [editor]);
  return useSyncExternalStore(subscribe, read, () => false);
}
