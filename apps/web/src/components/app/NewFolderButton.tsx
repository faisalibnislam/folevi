"use client";

// New folder, next to New note in the top bar on every folder's page (the owner, 4 November 2026: "like Finder"),
// where it makes a subfolder. On the Folders page it sits in the page's own title row instead (`inPage`; the owner,
// 6 November 2026: not twice), where it makes a top-level folder, which then opens.
import { useEffect, useState } from "react";
import { FolderPlus } from "lucide-react";
import { canNestFolderIn } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { useFolderActions, useFolderTree, useOpenFolders } from "@/lib/app/folders";
import { useAppRouter } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { PillButton } from "@/components/iphone/Glass";

/** Opens the page's New folder, the top bar's or the Folders page's own (the page's right-click menu asks for it). */
export const NEW_FOLDER_EVENT = "folevi:new-folder";

export function NewFolderButton({ parentId, pill = false, inPage = false }: { parentId: string | null; pill?: boolean; inPage?: boolean }) {
  const { canEdit, scope } = useAppState();
  const tree = useFolderTree(canEdit ? scope : "skip");
  const folderActions = useFolderActions();
  const [, setFolderOpen] = useOpenFolders();
  const { navigate } = useAppRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // The button answers the right-click menu's New folder (a page shows one: the top bar's or the Folders page's).
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(NEW_FOLDER_EVENT, show);
    return () => window.removeEventListener(NEW_FOLDER_EVENT, show);
  }, []);
  if (!canEdit) return null;
  const folders = tree?.folders ?? [];
  const parent = parentId ? folders.find((f) => f.id === parentId) : undefined;
  // A folder already as deep as folders go has no room for one more level.
  if (parentId && tree && !canNestFolderIn(folders, parentId)) return null;
  const label = parentId ? "New folder in this folder" : "New folder";
  return (
    <>
      {pill ? (
        <PillButton label={label} onClick={() => setOpen(true)}>
          <FolderPlus size={20} strokeWidth={2} aria-hidden />
        </PillButton>
      ) : (
        <Button size="sm" variant={inPage ? "primary" : "secondary"} data-new-folder={inPage ? "" : undefined} title={parentId ? label : undefined} onClick={() => setOpen(true)} className={inPage ? undefined : "h-9 flex-none rounded-control"}>
          <FolderPlus size={14} aria-hidden /> New folder
        </Button>
      )}
      <PromptDialog
        open={open}
        title={parent ? `New folder in “${parent.name}”` : "New folder"}
        label="Folder name"
        confirmLabel="Create folder"
        onClose={() => setOpen(false)}
        onSubmit={async (name) => {
          try {
            const id = folderActions.create(name, parentId);
            setOpen(false);
            if (parentId) setFolderOpen(parentId, true);
            else navigate(`/folders/${id}`);
          } catch (e) {
            toast.show(errorMessage(e), { tone: "error" });
          }
        }}
      />
    </>
  );
}
