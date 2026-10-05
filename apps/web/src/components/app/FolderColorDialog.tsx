"use client";

import { useMutation } from "convex/react";
import { api } from "@/lib/convex/api";
import { Check } from "lucide-react";
import { FOLDER_COLORS, folderColorId } from "@/lib/folderColors";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";

/** Pick a folder colour from the palette's 25. */
export function FolderColorDialog({ open, onClose, folder }: { open: boolean; onClose: () => void; folder: { id: string; name: string; color: string | null } }) {
  const setColor = useMutation(api.organization.setFolderColor);
  const toast = useToast();
  const current = folderColorId(folder.color);
  return (
    <Dialog open={open} onClose={onClose} title={`Color for “${folder.name}”`} size="sm">
      <div role="radiogroup" aria-label="Folder color" className="grid grid-cols-5 gap-2.5">
        {FOLDER_COLORS.map((c) => {
          const on = current === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={c.name}
              title={c.name}
              onClick={() => {
                void setColor({ folderId: folder.id, color: c.id }).then(onClose, (e) => toast.show(errorMessage(e), { tone: "error" }));
              }}
              style={{ background: c.hex }}
              className={`grid aspect-square place-items-center rounded-[6px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${on ? "ring-2 ring-heading ring-offset-2 ring-offset-surface" : ""}`}
            >
              {on ? <Check size={18} strokeWidth={2.5} className="text-[#17171a]" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
