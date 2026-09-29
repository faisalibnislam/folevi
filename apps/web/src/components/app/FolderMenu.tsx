"use client";

import { useMutation } from "convex/react";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AiIcon } from "@/components/ai/AiIcon";
import { FilePlus2, Link2, MoreHorizontal, Palette, PencilLine, Trash2, Undo2, UserPlus } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { MenuButton, type MenuItem } from "@/components/ui/Menu";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { FolderColorDialog } from "./FolderColorDialog";
import { useCreateDocument } from "./useCreateDocument";
import { InviteDialog } from "./InviteDialog";
import { useShell } from "./Shell";
import { useAiEnabled } from "@/components/ai/useAi";

export interface MenuFolder {
  id: string;
  name: string;
  parentFolderId: string | null;
  color: string | null;
}

/**
 * The "…" menu for a folder (sidebar rows and folder cards): new note in it, rename, change colour,
 * copy link, invite people to the team workspace (a modal), and delete. Folders don't nest.
 */
export function FolderMenu({ folder, trigger, className }: { folder: MenuFolder; trigger?: ReactNode; className?: string }) {
  const { canEdit, canManage: managesWorkspace, workspace } = useAppState();
  const { openAsk } = useShell();
  const aiOn = useAiEnabled();
  const createDocument = useCreateDocument();
  const rename = useMutation(api.organization.renameFolder);
  const moveFolder = useMutation(api.organization.moveFolder);
  const del = useMutation(api.organization.deleteFolder);
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coloring, setColoring] = useState(false);
  // Personal has no members: inviting people is for team workspaces (single pages are shared instead).
  const canManage = workspace !== null && managesWorkspace;
  const act = (p: Promise<unknown>, msg: string) => p.then(() => toast.show(msg), (e) => toast.show(errorMessage(e), { tone: "error" }));

  const copyLink = () => {
    const url = `${window.location.origin}/folders/${folder.id}`;
    void navigator.clipboard.writeText(url).then(
      () => toast.show("Link copied"),
      () => toast.show("Couldn’t copy the link", { tone: "error" }),
    );
  };

  const items: (MenuItem | "separator")[] = [
    ...(canEdit
      ? [
          { label: "New note in folder", icon: <FilePlus2 size={14} />, onSelect: () => void createDocument({ folderId: folder.id }) },
          "separator" as const,
          { label: "Rename…", icon: <PencilLine size={14} />, onSelect: () => setRenaming(true) },
          { label: "Change color…", icon: <Palette size={14} />, onSelect: () => setColoring(true) },
          ...(folder.parentFolderId
            ? [{ label: "Move to top level", icon: <Undo2 size={14} />, onSelect: () => void act(moveFolder({ folderId: folder.id, parentFolderId: null }), "Moved") }]
            : []),
        ]
      : []),
    ...(aiOn ? [{ label: "Ask AI about this folder…", icon: <AiIcon size={14} className="text-[#7c6cf0]" />, onSelect: () => openAsk(undefined, { id: folder.id, name: folder.name }) }] : []),
    { label: "Copy link", icon: <Link2 size={14} />, onSelect: copyLink },
    ...(canManage ? [{ label: "Invite people…", icon: <UserPlus size={14} />, onSelect: () => setInviting(true) }] : []),
    ...(canEdit ? ["separator" as const, { label: "Delete folder…", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDeleting(true) }] : []),
  ];

  // The dialogs render at the end of <body>: the menu's wrapper is often hidden until hover and styled for
  // the card it sits on, and neither should reach into a dialog.
  const dialogs = (
    <>
      {coloring ? <FolderColorDialog open onClose={() => setColoring(false)} folder={folder} /> : null}
      <PromptDialog open={renaming} title="Rename folder" label="Folder name" initial={folder.name} onClose={() => setRenaming(false)} onSubmit={(name) => act(rename({ folderId: folder.id, name }), "Renamed")} />
      {inviting && workspace ? <InviteDialog workspace={workspace} open onClose={() => setInviting(false)} /> : null}
      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete “${folder.name}”?`}
        description="The folder is removed. Its documents are kept and move to Drafts."
        size="sm"
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setDeleting(false);
                void act(del({ folderId: folder.id }), "Folder deleted");
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
