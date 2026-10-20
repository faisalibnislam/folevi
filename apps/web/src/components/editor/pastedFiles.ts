"use client";

// Blocks pasted from another note can show its images, files and recordings. Each needs a file row of this
// note (files.shareForPaste) so this note's readers can open it and deleting the other note for good doesn't
// take it away: in the same place the row shares the stored bytes (no extra storage), elsewhere it's a copy.
// Until the server answers, the pasted block shows the original file (whoever pastes can open it). Images
// inside a pasted flowchart's shapes are adopted the same way.
import type { Editor } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { blockFileIds, remapBlockFiles } from "@folevi/editor-schema";
import { useMutation } from "convex/react";
import { useEffect } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useBackendMode } from "@/lib/mode";
import { useToast, errorMessage } from "@/components/ui/Toast";

/**
 * Blocks showing files that weren't in the note before the paste: block id → the file ids it shows (a file
 * block's own, and the images in a flowchart's shapes).
 */
export function pastedFiles(doc: PMNode, before: Set<string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  doc.forEach((n) => {
    const id = n.attrs.id as string | null;
    if (!id || before.has(id)) return;
    const ids = blockFileIds({ type: n.type.name, props: n.attrs });
    if (ids.length) out.set(id, ids);
  });
  return out;
}

/** A pasted block's attributes pointing at this note's own copies of its files (null: nothing to change). */
export function adoptedAttrs(n: PMNode, map: Record<string, string>): Record<string, unknown> | null {
  const block = { type: n.type.name, props: n.attrs as Record<string, unknown> };
  const next = remapBlockFiles(block, (id) => map[id]);
  return next === block ? null : next.props;
}

export function usePastedFiles(editor: Editor | null, documentId: string) {
  const share = useMutation(api.files.shareForPaste);
  const toast = useToast();
  const { engine } = useAppState();
  // In local mode notes are in the library at once: nothing to wait for.
  const local = useBackendMode() === "local";
  useEffect(() => {
    if (!editor) return;
    let stopped = false;
    const adopt = async (before: Set<string>, attempt = 0) => {
      if (stopped || editor.isDestroyed || !editor.isEditable) return;
      const found = pastedFiles(editor.state.doc, before);
      if (!found.size) return;
      let map: Record<string, string>;
      try {
        // A note made a moment ago has to reach the server before its files can.
        if (!local) await engine?.whenDocumentOnServer(documentId, 60_000);
        map = await share({ documentId, fileIds: [...new Set([...found.values()].flat())] });
      } catch (e) {
        // Offline: once the connection is back. Refused (storage full): the blocks keep the original files.
        if (!navigator.onLine && attempt < 3) window.addEventListener("online", () => void adopt(before, attempt + 1), { once: true });
        else toast.show(`Pasted files stay linked to the note they came from. ${errorMessage(e)}`, { tone: "error" });
        return;
      }
      if (stopped || editor.isDestroyed) return;
      const tr = editor.state.tr;
      editor.state.doc.forEach((n, pos) => {
        if (!found.has(n.attrs.id as string)) return;
        const attrs = adoptedAttrs(n, map);
        if (attrs) tr.setNodeMarkup(pos, undefined, attrs);
      });
      // Part of the paste: undoing the paste takes the blocks away; there's nothing else to undo.
      if (tr.docChanged) editor.view.dispatch(tr.setMeta("addToHistory", false));
    };
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged || !transaction.getMeta("paste") || transaction.getMeta("remote")) return;
      const before = new Set<string>();
      transaction.before.forEach((n) => {
        if (n.attrs.id) before.add(n.attrs.id as string);
      });
      // After the pasted blocks have their new ids (BlockIdentity gives them in the next transaction).
      setTimeout(() => void adopt(before), 0);
    };
    editor.on("transaction", onTransaction);
    return () => {
      stopped = true;
      editor.off("transaction", onTransaction);
    };
  }, [editor, documentId, share, toast, engine, local]);
}
