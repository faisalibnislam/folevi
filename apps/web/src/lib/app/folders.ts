"use client";

import { useCallback, type DragEvent } from "react";
import { useMutation } from "convex/react";
import { MAX_FOLDER_DEPTH, folderMoveProblem, type FolderLink, type FolderMoveProblem } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useLocalStorage } from "@/lib/hooks/useEngine";

/** A dragged folder (sidebar rows), by id. */
export const FOLDER_MIME = "application/x-folevi-folder";

// Drop targets decide whether they take a folder while it's still in the air, when the drag's data can't be
// read yet (only its types): the folder being dragged is kept here from dragstart to dragend.
let dragging: string | null = null;

export function startFolderDrag(e: DragEvent, id: string) {
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(FOLDER_MIME, id);
  dragging = id;
}

export function endFolderDrag() {
  dragging = null;
}

export function isFolderDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(FOLDER_MIME);
}

/** The folder being dragged right now (null when it isn't a folder, or it came from another window). */
export function draggingFolderId(): string | null {
  return dragging;
}

export function draggedFolderId(e: DragEvent): string | null {
  return e.dataTransfer.getData(FOLDER_MIME) || dragging;
}

/** What to tell someone whose folder can't go there. */
export function folderMoveMessage(problem: Exclude<FolderMoveProblem, null>): string {
  return problem === "depth" ? `Folders can be nested up to ${MAX_FOLDER_DEPTH} levels deep.` : "A folder can't go inside itself or one of its subfolders.";
}

/**
 * The folder list with `folderId` moved into `parentFolderId` (null: the top level), or null when the move
 * isn't allowed (the server refuses it too) or changes nothing. Used for the sidebar's optimistic update.
 */
export function moveFolderLocally<T extends FolderLink>(folders: readonly T[], folderId: string, parentFolderId: string | null): T[] | null {
  const folder = folders.find((f) => f.id === folderId);
  if (!folder || folder.parentFolderId === parentFolderId) return null;
  if (parentFolderId !== null && !folders.some((f) => f.id === parentFolderId)) return null;
  if (folderMoveProblem(folders, folderId, parentFolderId)) return null;
  return folders.map((f) => (f.id === folderId ? { ...f, parentFolderId } : f));
}

/** organization.moveFolder, shown in every open folder list at once (and put back if the server refuses). */
export function useMoveFolder() {
  return useMutation(api.organization.moveFolder).withOptimisticUpdate((store, args) => {
    for (const q of store.getAllQueries(api.organization.sidebar)) {
      if (!q.value) continue;
      const folders = moveFolderLocally(q.value.folders, args.folderId, args.parentFolderId);
      if (folders) store.setQuery(api.organization.sidebar, q.args, { ...q.value, folders });
    }
  });
}

/**
 * Which folders are open in the sidebar tree, remembered on this device. Folder ids are unique everywhere,
 * so one map serves Personal and every workspace. A folder is open until it's closed.
 */
export function useOpenFolders(): [(id: string) => boolean, (id: string, open: boolean) => void] {
  const [closed, setClosed] = useLocalStorage<Record<string, true>>("folevi:sidebar-folders-closed", {});
  const isOpen = useCallback((id: string) => !closed[id], [closed]);
  const setOpen = useCallback(
    (id: string, open: boolean) =>
      setClosed((current) => {
        const next = { ...current };
        if (open) delete next[id];
        else next[id] = true;
        return next;
      }),
    [setClosed],
  );
  return [isOpen, setOpen];
}
