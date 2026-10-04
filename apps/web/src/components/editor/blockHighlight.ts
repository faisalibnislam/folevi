// One block shown highlighted (the line a resolved comment was made on, while its thread is open). Set with
// `setBlockHighlight(view, id)`; null clears it.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

const key = new PluginKey<string | null>("blockHighlight");

export function setBlockHighlight(view: EditorView, id: string | null) {
  if ((key.getState(view.state) ?? null) === id) return;
  view.dispatch(view.state.tr.setMeta(key, id).setMeta("addToHistory", false));
}

export const BlockHighlight = Extension.create({
  name: "blockHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<string | null>({
        key,
        state: {
          init: () => null,
          apply: (tr, id) => {
            const next = tr.getMeta(key) as string | null | undefined;
            return next === undefined ? id : next;
          },
        },
        props: {
          decorations: (state) => {
            const id = key.getState(state);
            if (!id) return null;
            let deco: Decoration | null = null;
            state.doc.forEach((n, offset) => {
              if (!deco && n.attrs.id === id) deco = Decoration.node(offset, offset + n.nodeSize, { class: "fb-block-highlight" });
            });
            return deco ? DecorationSet.create(state.doc, [deco]) : null;
          },
        },
      }),
    ];
  },
});
