"use client";

// What a multi-selection of notes and folders can do (lib/app/multiSelect.ts decides which actions; this file
// runs them), shared by the floating selection bar and the right-click menu on a selected item: open in new tabs,
// move (the Move dialog, or a drag onto a folder), copy elsewhere, bookmark, tag, colour, archive, trash, delete.
// Each reuses the single-item action (notes: useNoteActions, with its toast and Undo; folders: useFolderActions).
import { useMutation } from "convex/react";
import { useMemo, useState, type ReactNode } from "react";
import { AppWindow, Archive, ArchiveRestore, Bookmark, BookmarkOff, CopyPlus, FolderInput, Hash, Palette, Trash2, Undo2, X } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useFolderActions, useFolderTree } from "@/lib/app/folders";
import { bulkActions, selectionNoun, type BulkAction } from "@/lib/app/multiSelect";
import { useTabs } from "@/lib/app/tabs";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { MenuItem } from "@/components/ui/Menu";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { FolderColorDialog } from "@/components/app/FolderColorDialog";
import { useShell } from "@/components/app/Shell";
import { useIphoneApp } from "@/lib/iphone";
import { MoveToFolderDialog } from "./MoveToFolderDialog";
import { CopyToDialog, useCanCopyElsewhere } from "./CopyToDialog";
import { useNoteActions } from "./noteActions";
import { useMoveItems } from "./moveItems";
import type { SelectionAction } from "./SelectionBar";

/** One selected item, as the actions need it. */
export type SelectionEntry =
  | { kind: "note"; id: string; name: string; starred?: boolean; archived?: boolean; template?: boolean; folderId?: string | null; tagIds?: string[] }
  | { kind: "folder"; id: string; name: string; color: string | null; parentFolderId: string | null };

const ICONS: Record<BulkAction, ReactNode> = {
  openTabs: <AppWindow size={15} />,
  move: <FolderInput size={15} />,
  copy: <CopyPlus size={15} />,
  bookmark: <Bookmark size={15} />,
  unbookmark: <BookmarkOff size={15} />,
  tags: <Hash size={15} />,
  color: <Palette size={15} />,
  archive: <Archive size={15} />,
  unarchive: <ArchiveRestore size={15} />,
  trash: <Trash2 size={15} />,
  restore: <Undo2 size={15} />,
  deleteForever: <Trash2 size={15} />,
  deleteFolders: <Trash2 size={15} />,
};

const LABELS: Record<BulkAction, string> = {
  openTabs: "Open in new tabs",
  move: "Move to folder…",
  copy: "Copy to…",
  bookmark: "Bookmark",
  unbookmark: "Remove bookmark",
  tags: "Add tag…",
  color: "Change color…",
  archive: "Archive",
  unarchive: "Unarchive",
  trash: "Move to Trash",
  restore: "Restore",
  deleteForever: "Delete permanently…",
  deleteFolders: "Delete folders…",
};

const DANGER = new Set<BulkAction>(["trash", "deleteForever", "deleteFolders"]);

/**
 * The actions for the selected `entries` (in the list's order): the bar's buttons, the right-click menu's items and
 * the dialogs they open. `clear` empties the selection once an action has taken the items (moved, trashed…);
 * opening tabs, bookmarking, tagging and colouring keep it, as Finder does.
 */
export function useSelectionActions({ entries, trash = false, clear }: { entries: SelectionEntry[]; trash?: boolean; clear: () => void }) {
  const { canEdit, scope } = useAppState();
  const { isNarrow } = useShell();
  const phone = useIphoneApp();
  const { openManyInBackground } = useTabs();
  const canCopy = useCanCopyElsewhere();
  const notesApi = useNoteActions();
  const folderActions = useFolderActions();
  const moveItems = useMoveItems();
  const toast = useToast();
  const tree = useFolderTree(canEdit ? scope : "skip");
  const setTags = useMutation(api.organization.setDocumentTags);

  const notes = useMemo(() => entries.filter((e): e is Extract<SelectionEntry, { kind: "note" }> => e.kind === "note"), [entries]);
  const folders = useMemo(() => entries.filter((e): e is Extract<SelectionEntry, { kind: "folder" }> => e.kind === "folder"), [entries]);
  const kinds = useMemo(() => entries.map((e) => (e.kind === "note" ? { kind: "note" as const, starred: e.starred, archived: e.archived, template: e.template } : { kind: "folder" as const })), [entries]);
  const available = bulkActions(kinds, { trash, canEdit, canCopy, tabs: !isNarrow && !phone });

  // Dialogs keep the items they were opened for: the selection may change (or clear) while one is open.
  const [moving, setMoving] = useState<{ notes: string[]; folders: string[]; current?: string | null } | null>(null);
  const [copying, setCopying] = useState<{ ids: string[]; title?: string } | null>(null);
  const [coloring, setColoring] = useState<Extract<SelectionEntry, { kind: "folder" }>[] | null>(null);
  const [tagging, setTagging] = useState<Extract<SelectionEntry, { kind: "note" }>[] | null>(null);
  const [deleting, setDeleting] = useState<{ kind: "notes" | "folders"; ids: string[]; names: string[] } | null>(null);

  const noteIds = notes.map((n) => n.id);
  /** Runs `act` on the selected notes and lets the selection go (they've left the list, or will). */
  const onNotes = (act: (ids: string[]) => Promise<unknown>) => {
    const ids = noteIds;
    clear();
    void act(ids);
  };

  const run = (a: BulkAction) => {
    switch (a) {
      case "openTabs":
        openManyInBackground(entries.map((e) => ({ kind: e.kind, id: e.id, name: e.name })));
        toast.show(entries.length === 1 ? "Opened in a new tab" : `Opened ${entries.length.toLocaleString()} new tabs`);
        return;
      case "move": {
        const shared = notes.length && notes.every((n) => (n.folderId ?? null) === (notes[0]!.folderId ?? null)) ? (notes[0]!.folderId ?? null) : undefined;
        setMoving({ notes: noteIds, folders: folders.map((f) => f.id), current: folders.length ? undefined : shared });
        return;
      }
      case "copy":
        setCopying({ ids: noteIds, title: notes[0]?.name });
        clear();
        return;
      case "bookmark":
      case "unbookmark":
        void notesApi.star(noteIds, a === "bookmark");
        return;
      case "tags":
        setTagging(notes);
        return;
      case "color":
        setColoring(folders);
        return;
      case "archive":
      case "unarchive":
        onNotes((ids) => notesApi.archive(ids, a === "archive"));
        return;
      case "trash":
        onNotes((ids) => notesApi.trash(ids));
        return;
      case "restore":
        onNotes((ids) => notesApi.restore(ids));
        return;
      case "deleteForever":
        setDeleting({ kind: "notes", ids: noteIds, names: notes.map((n) => n.name) });
        return;
      case "deleteFolders":
        setDeleting({ kind: "folders", ids: folders.map((f) => f.id), names: folders.map((f) => f.name) });
        return;
    }
  };

  const barActions: SelectionAction[] = available.map((a) => ({ label: LABELS[a], icon: ICONS[a], danger: DANGER.has(a), onClick: () => run(a) }));
  const menuItems: (MenuItem | "separator")[] = [
    ...available.flatMap((a): (MenuItem | "separator")[] => {
      const item: MenuItem = { label: LABELS[a], icon: ICONS[a], danger: DANGER.has(a), onSelect: () => run(a), desktopOnly: a === "openTabs" || undefined };
      return DANGER.has(a) ? ["separator", item] : [item];
    }),
    "separator",
    { label: "Clear selection", icon: <X size={15} />, onSelect: clear },
  ];

  const addTag = async (list: Extract<SelectionEntry, { kind: "note" }>[], tag: { id: string; name: string }) => {
    let done = 0;
    for (const n of list) {
      const cur = n.tagIds ?? [];
      if (cur.includes(tag.id)) continue;
      try {
        await setTags({ documentId: n.id, tagIds: [...cur, tag.id] });
        done++;
      } catch (e) {
        toast.show(errorMessage(e), { tone: "error" });
        return;
      }
    }
    toast.show(done ? `Tagged ${selectionNoun(done, 0)} #${tag.name}` : `Already tagged #${tag.name}`);
  };

  const runDelete = (d: NonNullable<typeof deleting>) => {
    setDeleting(null);
    clear();
    if (d.kind === "notes") {
      void notesApi.deleteForever(d.ids);
      return;
    }
    try {
      d.ids.forEach((id, i) => folderActions.remove(id, d.names[i] ?? ""));
      toast.show(d.ids.length === 1 ? "Folder deleted" : `Deleted ${selectionNoun(0, d.ids.length)}`);
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };

  const tags = tree?.tags ?? [];
  const dialogs = (
    <>
      {moving ? (
        <MoveToFolderDialog
          open
          onClose={() => setMoving(null)}
          count={moving.notes.length}
          noteTitle={notes[0]?.name}
          currentFolderId={moving.current}
          folderIds={moving.folders}
          onPick={(target) => {
            const items = { notes: moving.notes, folders: moving.folders };
            clear();
            void moveItems(items, target);
          }}
        />
      ) : null}
      {copying ? <CopyToDialog open onClose={() => setCopying(null)} documentIds={copying.ids} noteTitle={copying.title} /> : null}
      {coloring ? <FolderColorDialog open onClose={() => setColoring(null)} folders={coloring} /> : null}
      {tagging ? (
        <Dialog open onClose={() => setTagging(null)} title="Add tag" description={`Pick a tag for ${selectionNoun(tagging.length, 0)}.`} size="sm">
          {tags.length ? (
            <ul role="list" aria-label="Tags" className="max-h-[min(360px,50dvh)] space-y-0.5 overflow-y-auto">
              {tags.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="ui-menu-item w-full text-left"
                    onClick={() => {
                      const list = tagging;
                      setTagging(null);
                      void addTag(list, t);
                    }}
                  >
                    <Hash size={14} aria-hidden className="flex-none text-muted" />
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-subheadline text-muted">No tags yet. Add tags to a note from its Info panel.</p>
          )}
        </Dialog>
      ) : null}
      {deleting ? (
        <Dialog
          open
          onClose={() => setDeleting(null)}
          title={deleting.kind === "notes" ? `Delete ${selectionNoun(deleting.ids.length, 0)} permanently?` : `Delete ${deleting.ids.length === 1 ? `“${deleting.names[0]}”` : selectionNoun(0, deleting.ids.length)}?`}
          description={
            deleting.kind === "notes"
              ? "They’ll be deleted for everyone, with their nested pages, attachments and version history. This can’t be undone. Notes you don’t have permission to delete stay in Trash."
              : "The folders are removed. Their notes are kept and move to Drafts; folders inside them move up a level, with everything inside."
          }
          size="sm"
          confirm={{ label: deleting.kind === "notes" ? "Delete permanently" : "Delete folders", destructive: true, onConfirm: () => runDelete(deleting) }}
          footer={
            <>
              <Button onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => runDelete(deleting)}>
                {deleting.kind === "notes" ? "Delete permanently" : "Delete folders"}
              </Button>
            </>
          }
        />
      ) : null}
    </>
  );

  return {
    barActions,
    menuItems,
    dialogs,
    /** "Selected notes", "Selected folders" or "Selected items": the bar's name. */
    label: !folders.length ? "Selected notes" : !notes.length ? "Selected folders" : "Selected items",
    /** For a context menu's name: "2 folders and 3 notes". */
    noun: selectionNoun(notes.length, folders.length),
  };
}
