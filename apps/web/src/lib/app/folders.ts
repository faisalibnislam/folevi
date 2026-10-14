"use client";

import { useCallback, useMemo, type DragEvent } from "react";
import { MAX_FOLDER_DEPTH, folderMoveProblem, ulid, type FolderLink, type FolderMoveProblem, type WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { useCachedQuery, useOutboxEntries } from "@/lib/sync/queryCache";
import { overlaySidebar, type SidebarData } from "@/lib/sync/overlays";
import type { Outbox } from "@/lib/sync/outbox";
import { useAppState } from "./state";

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

/** The account's outbox, or an error to show while it's still opening (a moment after the app starts). */
export function requireOutbox(outbox: Outbox | null): Outbox {
  if (!outbox) throw new Error("Folevi is still starting. Try again in a moment.");
  return outbox;
}

/**
 * The folder tree of a Personal or workspace (organization.sidebar), as last seen on this device while
 * there's no connection, with folder changes still waiting to be sent already in place.
 */
export function useFolderTree(scope: WireScope | "skip"): SidebarData | undefined {
  return useFolderTreeState(scope).data;
}

/** `useFolderTree`, saying whether the tree is the copy kept on this device (it may miss folders made elsewhere). */
export function useFolderTreeState(scope: WireScope | "skip"): { data: SidebarData | undefined; fromCache: boolean } {
  const { outbox } = useAppState();
  const { data, fromCache } = useCachedQuery(api.organization.sidebar, scope === "skip" ? "skip" : { scope });
  const entries = useOutboxEntries(outbox);
  const tree = useMemo(() => (data && scope !== "skip" ? overlaySidebar(data, entries, scope) : data), [data, entries, scope]);
  return { data: tree, fromCache };
}

/**
 * Folder changes, through the outbox: shown at once everywhere the tree is, kept on this device, and sent
 * in order when there's a connection. A folder made here has its id from the start, so notes can be
 * filed in it and folders made inside it before the server has it.
 */
export function useFolderActions() {
  const { outbox, scope } = useAppState();
  return useMemo(
    () => ({
      /** Makes a folder (in `where`, by default the current context) and returns its id. */
      create(name: string, parentFolderId?: string | null, where: WireScope = scope): string {
        const id = ulid();
        const label = `New folder “${name.trim()}”`;
        requireOutbox(outbox).enqueue(
          "organization.createFolder",
          { scope: where, name, ...(parentFolderId ? { parentFolderId } : {}), id },
          { keys: [`folder:${id}`, ...(parentFolderId ? [`folder:${parentFolderId}`] : [])], label, creates: [id] },
        );
        return id;
      },
      rename(folderId: string, name: string) {
        requireOutbox(outbox).enqueue("organization.renameFolder", { folderId, name }, { keys: [`folder:${folderId}`], label: `Rename folder to “${name.trim()}”` });
      },
      setColor(folderId: string, color: string | null) {
        requireOutbox(outbox).enqueue("organization.setFolderColor", { folderId, color }, { keys: [`folder:${folderId}`], label: "Folder color" });
      },
      move(folderId: string, parentFolderId: string | null) {
        requireOutbox(outbox).enqueue(
          "organization.moveFolder",
          { folderId, parentFolderId },
          { keys: [`folder:${folderId}`, ...(parentFolderId ? [`folder:${parentFolderId}`] : [])], label: "Move folder" },
        );
      },
      remove(folderId: string, name: string) {
        requireOutbox(outbox).enqueue("organization.deleteFolder", { folderId }, { keys: [`folder:${folderId}`], label: `Delete folder “${name}”` });
      },
    }),
    [outbox, scope],
  );
}

/** Moves a folder (organization.moveFolder through the outbox); resolves once it's queued. */
export function useMoveFolder() {
  const actions = useFolderActions();
  return useCallback(
    async (args: { folderId: string; parentFolderId: string | null }) => {
      actions.move(args.folderId, args.parentFolderId);
      return null;
    },
    [actions],
  );
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
