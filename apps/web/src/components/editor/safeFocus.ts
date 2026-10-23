// Tiptap's `focus` command, the same, except that it never leaves an editor behind (docs/MAC_WEBKIT_PLAN.md
// "Memory"). Tiptap focuses on the next animation frame, and a hidden page draws no frames: in a window behind others
// or with the app hidden, every focus waited there, holding its editor (its document, its whole DOM, about 10 MB with a
// flowchart and a whiteboard) long after the note's page had gone. Here a hidden page focuses at once, the frame a
// visible one waits for is cancelled when the editor goes, and nothing else changes.
import { Extension, isAndroid, isiOS, isSafari, isTextSelection, resolveFocusPosition } from "@tiptap/core";

interface SafeFocusStorage {
  frames: Set<number>;
}

export const SafeFocus = Extension.create<Record<string, never>, SafeFocusStorage>({
  name: "safeFocus",
  // Last of all, so this `focus` is the one the editor's commands use.
  priority: 1,
  addStorage: () => ({ frames: new Set<number>() }),
  addCommands() {
    const frames = this.storage.frames;
    return {
      focus:
        (position = null, options = {}) =>
        ({ editor, view, tr, dispatch }) => {
          const opts = { scrollIntoView: true, ...options };
          const focusNow = () => {
            if (editor.isDestroyed) return;
            view.focus();
            if (opts.scrollIntoView) editor.commands.scrollIntoView();
          };
          const delayedFocus = () => {
            if (isiOS() || isAndroid()) view.dom.focus();
            if (isSafari() && !isiOS() && !isAndroid()) view.dom.focus({ preventScroll: true });
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return focusNow();
            const id = requestAnimationFrame(() => {
              frames.delete(id);
              focusNow();
            });
            frames.add(id);
          };
          try {
            if ((view.hasFocus() && position === null) || position === false) return true;
          } catch {
            return false;
          }
          if (dispatch && position === null && !isTextSelection(editor.state.selection)) {
            delayedFocus();
            return true;
          }
          const selection = resolveFocusPosition(tr.doc, position) || editor.state.selection;
          const isSameSelection = editor.state.selection.eq(selection);
          if (dispatch) {
            if (!isSameSelection) tr.setSelection(selection);
            if (isSameSelection && tr.storedMarks) tr.setStoredMarks(tr.storedMarks);
            delayedFocus();
          }
          return true;
        },
    };
  },
  onDestroy() {
    for (const id of this.storage.frames) cancelAnimationFrame(id);
    this.storage.frames.clear();
  },
});
