// One block shown highlighted (the line a resolved comment was made on, while its thread is open), set with
// `setBlockHighlight(view, id)`; and a range of text kept looking selected while focus is elsewhere (the text
// a link is being added to), set with `setRangeHighlight(view, range)`. null clears either.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

const key = new PluginKey<string | null>("blockHighlight");
const rangeKey = new PluginKey<{ from: number; to: number } | null>("rangeHighlight");

export function setRangeHighlight(view: EditorView, range: { from: number; to: number } | null) {
  const now = rangeKey.getState(view.state) ?? null;
  if (now === range || (now && range && now.from === range.from && now.to === range.to)) return;
  view.dispatch(view.state.tr.setMeta(rangeKey, range).setMeta("addToHistory", false));
}

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
      new Plugin<{ from: number; to: number } | null>({
        key: rangeKey,
        state: {
          init: () => null,
          apply: (tr, range) => {
            const next = tr.getMeta(rangeKey) as { from: number; to: number } | null | undefined;
            if (next !== undefined) return next;
            if (!range || !tr.docChanged) return range;
            const from = tr.mapping.map(range.from, 1);
            const to = tr.mapping.map(range.to, -1);
            return from < to ? { from, to } : null;
          },
        },
        props: {
          decorations: (state) => {
            const range = rangeKey.getState(state);
            if (!range || range.from >= range.to) return null;
            return DecorationSet.create(state.doc, [Decoration.inline(range.from, range.to, { class: "fb-range-highlight" })]);
          },
        },
      }),
    ];
  },
});
