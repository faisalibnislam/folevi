"use client";

// Blocks pasted from another note can show its images, files and recordings. Each needs a file row of this
// note (files.shareForPaste) so this note's readers can open it and deleting the other note for good doesn't
// take it away: in the same place the row shares the stored bytes (no extra storage), elsewhere it's a copy.
// Until the server answers, the pasted block shows the original file (whoever pastes can open it).
import type { Editor } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import { useMutation } from "convex/react";
import { useEffect } from "react";
import { api } from "@/lib/convex/api";
import { useToast, errorMessage } from "@/components/ui/Toast";

/** Blocks with a file that weren't in the note before the paste: block id → file id. */
function pastedFiles(editor: Editor, before: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  editor.state.doc.forEach((n) => {
    const id = n.attrs.id as string | null;
    const fileId = n.attrs.fileId as string | null | undefined;
    if (id && fileId && !before.has(id)) out.set(id, fileId);
  });
  return out;
}

export function usePastedFiles(editor: Editor | null, documentId: string) {
  const share = useMutation(api.files.shareForPaste);
  const toast = useToast();
  useEffect(() => {
    if (!editor) return;
    let stopped = false;
    const adopt = async (before: Set<string>, attempt = 0) => {
      if (stopped || editor.isDestroyed || !editor.isEditable) return;
      const found = pastedFiles(editor, before);
      if (!found.size) return;
      let map: Record<string, string>;
      try {
        map = await share({ documentId, fileIds: [...new Set(found.values())] });
      } catch (e) {
        // Offline: once the connection is back. Refused (storage full): the blocks keep the original files.
        if (!navigator.onLine && attempt < 3) window.addEventListener("online", () => void adopt(before, attempt + 1), { once: true });
        else toast.show(`Pasted files stay linked to the note they came from. ${errorMessage(e)}`, { tone: "error" });
        return;
      }
      if (stopped || editor.isDestroyed) return;
      const tr = editor.state.tr;
      editor.state.doc.forEach((n, pos) => {
        const want = found.get(n.attrs.id as string);
        const next = want ? map[want] : undefined;
        if (next && n.attrs.fileId === want && next !== want) tr.setNodeMarkup(pos, undefined, { ...n.attrs, fileId: next });
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
  }, [editor, documentId, share, toast]);
}
