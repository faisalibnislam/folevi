import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, Selection } from "@tiptap/pm/state";

/** How long after the window has the keyboard again the browser may still be moving the caret. */
const SETTLE_MS = 60;

/**
 * The caret stays where it was when the keyboard comes back to the note.
 *
 * In the Mac app the keyboard leaves the note's page for a moment whenever something of the window takes it
 * (the Cmd+K palette, a dialog, the Find field) and is handed back when that closes. WebKit then puts the
 * caret at the very start of the note, as if the page had been tabbed into, and ProseMirror takes that as the
 * person's doing: typing went on at the top of the note instead of where they were.
 *
 * So the selection is remembered when the window loses the keyboard while the note has it, and put back when
 * the window gets it again, but only if what is found then is exactly that reset (a caret at the very start,
 * the note unchanged) and no press came with it: a click that brings the window back puts the caret where it
 * was clicked, and that is the person's.
 */
export const KeepCaret = Extension.create({
  name: "keepCaret",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view(view) {
          let left: { doc: PMNode; selection: Selection } | null = null;
          let timer: ReturnType<typeof setTimeout> | null = null;
          const stop = () => {
            if (timer !== null) clearTimeout(timer);
            timer = null;
          };
          const onBlur = () => {
            stop();
            left = document.activeElement === view.dom ? { doc: view.state.doc, selection: view.state.selection } : null;
          };
          const onFocus = () => {
            const was = left;
            left = null;
            stop();
            if (!was || document.activeElement !== view.dom) return;
            timer = setTimeout(() => {
              timer = null;
              if (view.isDestroyed || !view.hasFocus()) return;
              const { doc, selection, tr } = view.state;
              if (doc !== was.doc || selection.eq(was.selection)) return;
              if (!selection.empty || selection.from !== Selection.atStart(doc).from) return;
              view.dispatch(tr.setSelection(was.selection).setMeta("addToHistory", false));
            }, SETTLE_MS);
          };
          // (A press is the person choosing a place: nothing is put back over it.)
          const onPress = () => {
            stop();
            left = null;
          };
          window.addEventListener("blur", onBlur);
          window.addEventListener("focus", onFocus);
          window.addEventListener("pointerdown", onPress, true);
          return {
            destroy() {
              stop();
              window.removeEventListener("blur", onBlur);
              window.removeEventListener("focus", onFocus);
              window.removeEventListener("pointerdown", onPress, true);
            },
          };
        },
      }),
    ];
  },
});
