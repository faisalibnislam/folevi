// [[ page links to a page that's in Trash, deleted or no longer shared are drawn crossed out (with a
// tooltip). The links are plain editor nodes, so a small component next to the editor looks their pages up
// and hands the result to a decoration plugin.
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type Status = "trash" | "missing";
/** The statuses by page id, and the crossed-out links they make (kept, and moved with edits). */
export interface PageLinkStatusState {
  statuses: Record<string, Status>;
  decorations: DecorationSet;
}
export const pageLinkStatusKey = new PluginKey<PageLinkStatusState>("pageLinkStatus");

/** Whether a transaction may add, remove or change a [[ page link (typing and formatting around them can't). */
export function touchesPageLinks(tr: Transaction): boolean {
  return tr.steps.some((step, i) => {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return false;
    if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) return true;
    const { from, to, slice } = step as unknown as { from: number; to: number; slice: ReplaceStep["slice"] };
    let found = false;
    const look = (node: PMNode) => {
      if (node.type.name === "pageLink") found = true;
      return !found;
    };
    slice.content.descendants(look);
    if (!found && from < to) tr.docs[i]!.nodesBetween(from, to, look);
    return found;
  });
}

function paint(doc: PMNode, statuses: Record<string, Status>): DecorationSet {
  if (!Object.keys(statuses).length) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
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
  return DecorationSet.create(doc, decos);
}

export const PageLinkStatus = Extension.create({
  name: "pageLinkStatus",
  addProseMirrorPlugins() {
    return [
      new Plugin<PageLinkStatusState>({
        key: pageLinkStatusKey,
        state: {
          init: () => ({ statuses: {}, decorations: DecorationSet.empty }),
          apply: (tr, value) => {
            const statuses = tr.getMeta(pageLinkStatusKey) as Record<string, Status> | undefined;
            if (statuses) return { statuses, decorations: paint(tr.doc, statuses) };
            if (!tr.docChanged || !Object.keys(value.statuses).length) return value;
            // Links are only looked for again when an edit adds or removes one; otherwise the marks move with the text.
            return { statuses: value.statuses, decorations: touchesPageLinks(tr) ? paint(tr.doc, value.statuses) : value.decorations.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations: (state) => pageLinkStatusKey.getState(state)?.decorations ?? null,
        },
      }),
    ];
  },
});
