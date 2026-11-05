"use client";

import { useCallback } from "react";
import { useAppState } from "@/lib/app/state";
import { folderMoveMessage, useFolderActions, useFolderTree, useOpenFolders } from "@/lib/app/folders";
import { folderPlace } from "@/lib/app/folderDrop";
import { planFolderMoves, selectionNoun } from "@/lib/app/multiSelect";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { useNoteActions, type FolderTarget } from "./noteActions";

/**
 * Moves a selection's folders and notes into `target` (null: notes to Drafts, folders to the top level), with one
 * toast and one Undo for everything that moved. Folders that can't go there (into themselves, their own subfolder,
 * too deep) stay and are reported.
 */
export function useMoveItems() {
  const { scope } = useAppState();
  const tree = useFolderTree(scope);
  const notesApi = useNoteActions();
  const folderActions = useFolderActions();
  const toast = useToast();
  const [, setFolderOpen] = useOpenFolders();
  return useCallback(
    async (items: { notes: string[]; folders: string[] }, target: FolderTarget) => {
      const all = tree?.folders ?? [];
      const plan = planFolderMoves(all, items.folders, target.id);
      const was: { id: string; parentFolderId: string | null; afterFolderId: string | null }[] = [];
      try {
        for (const id of plan.move) {
          const place = folderPlace(all, id);
          folderActions.move(id, target.id);
          if (place) was.push({ id, ...place });
        }
      } catch (e) {
        toast.show(errorMessage(e), { tone: "error" });
      }
      if (plan.refused.length) toast.show(`${selectionNoun(0, plan.refused.length)} couldn’t move. ${folderMoveMessage(plan.refused[0]!.problem)}`, { tone: "error" });
      if (target.id && was.length) setFolderOpen(target.id, true);
      const undo = () => {
        for (const w of [...was].reverse()) {
          try {
            folderActions.move(w.id, w.parentFolderId, w.afterFolderId);
          } catch (e) {
            toast.show(errorMessage(e), { tone: "error" });
            return;
          }
        }
      };
      if (items.notes.length) {
        await notesApi.moveTo(items.notes, target, was.length ? { folders: was.length, undo } : undefined);
        return;
      }
      if (was.length) toast.show(`Moved ${selectionNoun(0, was.length)} to ${target.name}`, { action: { label: "Undo", onClick: undo } });
    },
    [tree, folderActions, notesApi, toast, setFolderOpen],
  );
}
