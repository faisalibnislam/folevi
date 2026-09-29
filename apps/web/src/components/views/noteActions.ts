"use client";

import { useMutation } from "convex/react";
import { useCallback, useMemo } from "react";
import { api } from "@/lib/convex/api";
import { useToast, errorMessage } from "@/components/ui/Toast";

/** The server takes at most this many notes per bulk call (documents.MAX_BULK); bigger sets go in turns. */
const CHUNK = 50;

type Action =
  | { kind: "move"; folderId: string | null }
  | { kind: "star"; starred: boolean }
  | { kind: "archive"; archived: boolean }
  | { kind: "trash" }
  | { kind: "restore" }
  | { kind: "delete" };

/** A folder to move notes into; `id: null` is Drafts (no folder). */
export interface FolderTarget {
  id: string | null;
  name: string;
}

const notes = (n: number) => (n === 1 ? "1 note" : `${n.toLocaleString()} notes`);

/**
 * Actions on one or many notes (multi-select, drag to a folder, the card and page menus), with the toast
 * and Undo each one shows. All go through documents.bulkUpdate, which authorizes every note on its own;
 * notes the person can't change are skipped and reported.
 */
export function useNoteActions() {
  const bulk = useMutation(api.documents.bulkUpdate);
  const hide = useMutation(api.documents.hideFromRecent);
  const unhide = useMutation(api.documents.showInRecent);
  const toast = useToast();

  const run = useCallback(
    async (ids: string[], action: Action) => {
      const done: string[] = [];
      const previousFolders: Record<string, string | null> = {};
      let skipped = 0;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const r = await bulk({ documentIds: ids.slice(i, i + CHUNK), action });
        done.push(...r.done);
        skipped += r.skipped;
        Object.assign(previousFolders, r.previousFolders);
      }
      return { done, skipped, previousFolders };
    },
    [bulk],
  );

  /** Runs an action and reports it: `message(n)` on success (with Undo when given), and any skipped notes. */
  const perform = useCallback(
    async (ids: string[], action: Action, message: (n: number) => string, undo?: (r: Awaited<ReturnType<typeof run>>) => void) => {
      if (!ids.length) return false;
      try {
        const r = await run(ids, action);
        if (r.skipped) toast.show(`${notes(r.skipped)} couldn’t be changed. You may not have permission.`, { tone: "error" });
        if (r.done.length) toast.show(message(r.done.length), undo ? { action: { label: "Undo", onClick: () => undo(r) } } : undefined);
        return r.done.length > 0;
      } catch (e) {
        toast.show(errorMessage(e), { tone: "error" });
        return false;
      }
    },
    [run, toast],
  );

  const quietly = useCallback(
    (ids: string[], action: Action) => void run(ids, action).catch((e) => toast.show(errorMessage(e), { tone: "error" })),
    [run, toast],
  );

  return useMemo(
    () => ({
      moveTo: (ids: string[], folder: FolderTarget) =>
        perform(
          ids,
          { kind: "move", folderId: folder.id },
          (n) => (n === 1 ? `Moved to ${folder.name}` : `Moved ${notes(n)} to ${folder.name}`),
          (r) => {
            // Each note goes back to the folder it came from.
            const byFolder = new Map<string | null, string[]>();
            for (const id of r.done) {
              const from = r.previousFolders[id] ?? null;
              byFolder.set(from, [...(byFolder.get(from) ?? []), id]);
            }
            for (const [folderId, back] of byFolder) quietly(back, { kind: "move", folderId });
          },
        ),
      star: (ids: string[], starred: boolean) =>
        perform(ids, { kind: "star", starred }, (n) => (starred ? (n === 1 ? "Starred" : `Starred ${notes(n)}`) : n === 1 ? "Removed from Starred" : `Unstarred ${notes(n)}`), (r) =>
          quietly(r.done, { kind: "star", starred: !starred }),
        ),
      archive: (ids: string[], archived: boolean) =>
        perform(ids, { kind: "archive", archived }, (n) => (archived ? (n === 1 ? "Archived" : `Archived ${notes(n)}`) : n === 1 ? "Moved out of Archive" : `Moved ${notes(n)} out of Archive`), (r) =>
          quietly(r.done, { kind: "archive", archived: !archived }),
        ),
      trash: (ids: string[]) =>
        perform(ids, { kind: "trash" }, (n) => (n === 1 ? "Moved to Trash" : `Moved ${notes(n)} to Trash`), (r) => quietly(r.done, { kind: "restore" })),
      restore: (ids: string[]) => perform(ids, { kind: "restore" }, (n) => (n === 1 ? "Restored" : `Restored ${notes(n)}`), (r) => quietly(r.done, { kind: "trash" })),
      deleteForever: (ids: string[]) => perform(ids, { kind: "delete" }, (n) => `${notes(n)} will be permanently deleted.`),
      removeFromRecent: async (ids: string[]) => {
        try {
          const r = await hide({ documentIds: ids.slice(0, CHUNK) });
          if (r.hidden)
            toast.show(r.hidden === 1 ? "Removed from Recent notes" : `Removed ${notes(r.hidden)} from Recent notes`, {
              action: { label: "Undo", onClick: () => void unhide({ documentIds: ids.slice(0, CHUNK) }).catch((e) => toast.show(errorMessage(e), { tone: "error" })) },
            });
        } catch (e) {
          toast.show(errorMessage(e), { tone: "error" });
        }
      },
    }),
    [perform, quietly, hide, unhide, toast],
  );
}
