"use client";

import { useEffect, useState } from "react";
import { FileText, Folder, FolderInput, Inbox } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { Dialog } from "@/components/ui/Dialog";
import { FolderPicker } from "@/components/views/MoveToFolderDialog";
import type { FolderTarget } from "@/components/views/noteActions";
import { useRadioGroup } from "@/lib/a11y/radioGroup";
import { PagePicker } from "./MovePageDialog";

// Move a note: one dialog (like Share) for both kinds of move. "Folder" files a top-level note in a folder
// (or Drafts); "Page" nests it under another page (or back at the top level). Where it is now shows at the
// top, so the choice is never blind.

type Where = "folder" | "page";

export function MoveNoteDialog({
  open,
  onClose,
  documentId,
  title,
  folder,
  parent,
  canFile,
  canNest,
  home,
  onPickFolder,
}: {
  open: boolean;
  onClose: () => void;
  documentId: string;
  title: string;
  /** The folder it's in now (null: Drafts). */
  folder: { id: string; name: string } | null;
  /** The page it's nested under now, if any. */
  parent: { id: string; title: string } | null;
  /** Whether it can be filed in a folder here (top-level notes of the current place you can edit). */
  canFile: boolean;
  /** Whether it can be nested under another page (you can manage it). */
  canNest: boolean;
  home?: WireScope | null;
  onPickFolder: (folder: FolderTarget) => void;
}) {
  const [where, setWhere] = useState<Where>(canFile ? "folder" : "page");
  const group = useRadioGroup();
  useEffect(() => {
    if (open) setWhere(canFile ? "folder" : "page");
  }, [open, canFile]);
  const name = `“${title.trim() || "Untitled"}”`;

  return (
    <Dialog open={open} onClose={onClose} title={`Move ${name}`} description="Pick a folder for it, or a page to put it inside.">
      <div className="space-y-4">
        <p className="flex items-center gap-2 rounded-[8px] bg-[var(--glass-hover)] px-3 py-2 text-[13px] text-muted">
          {parent ? <FileText size={14} className="flex-none" aria-hidden /> : folder ? <Folder size={14} className="flex-none" aria-hidden /> : <Inbox size={14} className="flex-none" aria-hidden />}
          <span className="min-w-0 truncate">
            Now {parent ? "inside" : "in"} <span className="font-medium text-heading">{parent ? parent.title || "Untitled" : folder ? folder.name : "Drafts"}</span>
          </span>
        </p>

        <div role="radiogroup" aria-label="Move to" ref={group.ref} onKeyDown={group.onKeyDown} className="grid grid-cols-2 gap-2">
          {(
            [
              ["folder", "A folder", "File it in a folder or Drafts", <Folder key="f" size={16} />],
              ["page", "A page", "Put it inside another page", <FolderInput key="p" size={16} />],
            ] as const
          ).map(([id, label, desc, icon]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={where === id}
              onClick={() => setWhere(id)}
              className={`flex items-start gap-2.5 rounded-[10px] border p-3 text-left text-sm transition-colors ${where === id ? "border-accent bg-accent-soft" : "border-line hover:bg-[var(--glass-hover)]"}`}
            >
              <span className={`mt-0.5 ${where === id ? "text-heading" : "text-muted"}`} aria-hidden>
                {icon}
              </span>
              <span>
                <span className="block font-medium text-heading">{label}</span>
                <span className="block text-xs text-muted">{desc}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="min-h-[min(330px,52dvh)]">
          {where === "folder" ? (
            canFile ? (
              <FolderPicker open={open && where === "folder"} onClose={onClose} onPick={onPickFolder} currentFolderId={folder?.id ?? null} />
            ) : (
              <p className="rounded-[8px] border border-dashed border-line px-3 py-4 text-[13px] text-muted">
                {parent ? (
                  <>
                    A page inside another page lives in that page&apos;s folder. To file it on its own, choose <span className="font-medium text-heading">A page</span> and move it to the top level first.
                  </>
                ) : (
                  "You can't file this note in a folder here."
                )}
              </p>
            )
          ) : canNest ? (
            <PagePicker open={open && where === "page"} onClose={onClose} documentId={documentId} title={title} currentParentId={parent?.id ?? null} home={home} />
          ) : (
            <p className="rounded-[8px] border border-dashed border-line px-3 py-4 text-[13px] text-muted">Only people who can manage this note can put it inside another page.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
