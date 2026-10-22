"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AiIcon } from "@/components/ai/AiIcon";
import { ArrowRightLeft, FilePlus2, FolderInput, FolderPlus, Link2, MoreHorizontal, Palette, PencilLine, Trash2, Undo2, UserPlus } from "lucide-react";
import { placesAvailable, usePlaces } from "@/lib/places";
import { openMovePlaces } from "@/components/places/MovePlaces";
import { canNestFolderIn } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { MenuButton, type MenuItem } from "@/components/ui/Menu";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { MoveFolderDialog } from "@/components/views/MoveToFolderDialog";
import { useFolderActions, useMoveFolder, useOpenFolders, useFolderTree } from "@/lib/app/folders";
import { FolderColorDialog } from "./FolderColorDialog";
import { useCreateDocument } from "./useCreateDocument";
import { InviteDialog } from "./InviteDialog";
import { useShell } from "./Shell";
import { useAiEnabled } from "@/components/ai/useAi";
import { useLockMenuItem } from "@/components/e2ee/LockDialog";

export interface MenuFolder {
  id: string;
  name: string;
  parentFolderId: string | null;
  color: string | null;
  /** Always fully encrypted (end-to-end encryption, docs/E2EE_DESIGN.md §10.8), when the folder list says so. */
  locked?: boolean;
}

/**
 * The "…" menu for a folder (sidebar rows and folder cards): new note or folder in it, rename, change
 * colour, move it (into another folder or to the top level), copy link, invite people to the team
 * workspace (a modal), and delete.
 */
export function FolderMenu({ folder, trigger, className }: { folder: MenuFolder; trigger?: ReactNode; className?: string }) {
  const { canEdit, canManage: managesWorkspace, workspace, scope } = useAppState();
  const { openAsk } = useShell();
  const aiOn = useAiEnabled();
  const createDocument = useCreateDocument();
  const folderActions = useFolderActions();
  const moveFolder = useMoveFolder();
  const [, setFolderOpen] = useOpenFolders();
  // The folder tree (shared with the sidebar's subscription): whether there's room for a folder inside.
  const org = useFolderTree(canEdit ? scope : "skip");
  const folders = org?.folders ?? [];
  const roomInside = canNestFolderIn(folders, folder.id) || !folders.some((f) => f.id === folder.id);
  const subfolders = folders.filter((f) => f.parentFolderId === folder.id).length;
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [addingInside, setAddingInside] = useState(false);
  const [moving, setMoving] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coloring, setColoring] = useState(false);
  // Personal has no members: inviting people is for team workspaces (single pages are shared instead).
  const canManage = workspace !== null && managesWorkspace;
  // "Always fully encrypted" (only once the account has encryption set up; see LockDialog).
  const lockItem = useLockMenuItem({ kind: "folder", id: folder.id, name: folder.name, locked: folder.locked });
  const act = (p: Promise<unknown>, msg: string) => p.then(() => toast.show(msg), (e) => toast.show(errorMessage(e), { tone: "error" }));

  const copyLink = () => {
    const url = `${window.location.origin}/folders/${folder.id}`;
    void navigator.clipboard.writeText(url).then(
      () => toast.show("Link copied"),
      () => toast.show("Couldn’t copy the link", { tone: "error" }),
    );
  };

  // Several places (docs/MULTI_ACCOUNT_PLAN.md §7.3): another account, or the library on this device.
  const places = usePlaces();
  const elsewhere = placesAvailable() && places.places.some((p) => p.id !== places.current);
  const items: (MenuItem | "separator")[] = [
    ...(canEdit
      ? [
          { label: "New note in folder", icon: <FilePlus2 size={14} />, onSelect: () => void createDocument({ folderId: folder.id }) },
          ...(roomInside ? [{ label: "New folder inside…", icon: <FolderPlus size={14} />, onSelect: () => setAddingInside(true) }] : []),
          "separator" as const,
          { label: "Rename…", icon: <PencilLine size={14} />, onSelect: () => setRenaming(true) },
          { label: "Change color…", icon: <Palette size={14} />, onSelect: () => setColoring(true) },
          { label: "Move folder…", icon: <FolderInput size={14} />, onSelect: () => setMoving(true) },
          ...(elsewhere ? [{ label: "Move to another place…", icon: <ArrowRightLeft size={14} />, onSelect: () => openMovePlaces({ folders: [folder.id], notes: [] }) }] : []),
          ...(folder.parentFolderId
            ? [{ label: "Move to top level", icon: <Undo2 size={14} />, onSelect: () => void act(moveFolder({ folderId: folder.id, parentFolderId: null }), "Moved to the top level") }]
            : []),
        ]
      : []),
    ...(aiOn ? [{ label: "Ask Foli AI about this folder…", icon: <AiIcon size={14} className="text-[#7c6cf0]" />, onSelect: () => openAsk(undefined, { id: folder.id, name: folder.name }) }] : []),
    ...(lockItem ? [lockItem] : []),
    { label: "Copy link", icon: <Link2 size={14} />, onSelect: copyLink },
    ...(canManage ? [{ label: "Invite people…", icon: <UserPlus size={14} />, onSelect: () => setInviting(true) }] : []),
    ...(canEdit ? ["separator" as const, { label: "Delete folder…", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDeleting(true) }] : []),
  ];

  // The dialogs render at the end of <body>: the menu's wrapper is often hidden until hover and styled for
  // the card it sits on, and neither should reach into a dialog.
  const dialogs = (
    <>
      {coloring ? <FolderColorDialog open onClose={() => setColoring(false)} folder={folder} /> : null}
      <PromptDialog open={renaming} title="Rename folder" label="Folder name" initial={folder.name} onClose={() => setRenaming(false)} onSubmit={(name) => act(Promise.resolve().then(() => folderActions.rename(folder.id, name)), "Renamed")} />
      <PromptDialog
        open={addingInside}
        title={`New folder in “${folder.name}”`}
        label="Folder name"
        confirmLabel="Create folder"
        onClose={() => setAddingInside(false)}
        onSubmit={async (name) => {
          try {
            folderActions.create(name, folder.id);
            // Open the folder in the sidebar so the new one shows.
            setFolderOpen(folder.id, true);
          } catch (e) {
            toast.show(errorMessage(e), { tone: "error" });
          }
        }}
      />
      {moving ? (
        <MoveFolderDialog
          open
          onClose={() => setMoving(false)}
          folder={folder}
          onPick={(parent) => {
            if (parent.id) setFolderOpen(parent.id, true);
            void act(moveFolder({ folderId: folder.id, parentFolderId: parent.id }), `Moved to ${parent.name}`);
          }}
        />
      ) : null}
      {inviting && workspace ? <InviteDialog workspace={workspace} open onClose={() => setInviting(false)} /> : null}
      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete “${folder.name}”?`}
        description={
          subfolders
            ? `The folder is removed. Its documents are kept and move to Drafts. Its ${subfolders === 1 ? "subfolder moves" : "subfolders move"} up a level, with everything inside.`
            : "The folder is removed. Its documents are kept and move to Drafts."
        }
        size="sm"
        // In the apps: the system's alert.
        confirm={{ label: "Delete folder", destructive: true, onConfirm: () => void act(Promise.resolve().then(() => folderActions.remove(folder.id, folder.name)), "Folder deleted") }}
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setDeleting(false);
                void act(Promise.resolve().then(() => folderActions.remove(folder.id, folder.name)), "Folder deleted");
              }}
            >
              Delete folder
            </Button>
          </>
        }
      />
    </>
  );

  return (
    <div className={className}>
      <MenuButton label={`Folder options for ${folder.name}`} trigger={trigger ?? <MoreHorizontal size={14} aria-hidden />} items={items} />
      {typeof document === "undefined" ? null : createPortal(dialogs, document.body)}
    </div>
  );
}
