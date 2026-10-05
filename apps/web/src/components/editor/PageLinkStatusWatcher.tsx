"use client";
// Looks up the pages a note's [[ links point to and hands their state to the PageLinkStatus plugin
// (kept apart so the editor's extensions don't pull in the app's data layer).
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import type { Editor } from "@tiptap/core";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { pageLinkStatusKey as key, type Status } from "./pageLinkStatus";

function linkedIds(editor: Editor): string {
  const ids = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "pageLink" && node.attrs.documentId) ids.add(String(node.attrs.documentId));
  });
  return [...ids].sort().join(",");
}

/** Looks up the pages the note's [[ links point to and marks the ones that are gone. */
export function PageLinkStatusWatcher({ editor }: { editor: Editor }) {
  const { engine } = useAppState();
  const [ids, setIds] = useState(() => linkedIds(editor));
  useEffect(() => {
    const update = () => setIds(linkedIds(editor));
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);
  const list = ids ? ids.split(",") : [];
  const titles = useQuery(api.documents.titles, list.length ? { documentIds: list } : "skip");
  useEffect(() => {
    if (editor.isDestroyed) return;
    const next: Record<string, Status> = {};
    if (titles) {
      const creating = new Set(
        engine ? [...engine.state.pending, ...engine.state.inflight].flatMap((op) => (op.kind === "document.create" ? [op.document.id] : [])) : [],
      );
      for (const id of list) {
        const info = titles[id];
        if (info?.inTrash) next[id] = "trash";
        else if (!info && !creating.has(id)) next[id] = "missing";
      }
    }
    const now = key.getState(editor.state) ?? {};
    if (JSON.stringify(now) === JSON.stringify(next)) return;
    editor.view.dispatch(editor.state.tr.setMeta(key, next).setMeta("addToHistory", false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `list` is derived from `ids`
  }, [titles, ids, editor, engine]);
  return null;
}
