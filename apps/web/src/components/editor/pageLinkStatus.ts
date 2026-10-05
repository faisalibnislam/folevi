// [[ page links to a page that's in Trash, deleted or no longer shared are drawn crossed out (with a
// tooltip). The links are plain editor nodes, so a small component next to the editor looks their pages up
// and hands the result to a decoration plugin.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type Status = "trash" | "missing";
export const pageLinkStatusKey = new PluginKey<Record<string, Status>>("pageLinkStatus");

export const PageLinkStatus = Extension.create({
  name: "pageLinkStatus",
  addProseMirrorPlugins() {
    return [
      new Plugin<Record<string, Status>>({
        key: pageLinkStatusKey,
        state: {
          init: () => ({}),
          apply: (tr, value) => (tr.getMeta(pageLinkStatusKey) as Record<string, Status> | undefined) ?? value,
        },
        props: {
          decorations: (state) => {
            const statuses = pageLinkStatusKey.getState(state) ?? {};
            if (!Object.keys(statuses).length) return null;
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "pageLink") return;
              const s = statuses[String(node.attrs.documentId)];
              if (s) {
                decos.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: "fb-page-link-gone",
                    title: s === "trash" ? "This page is in Trash" : "This page is unavailable or you no longer have access",
                  }),
                );
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

