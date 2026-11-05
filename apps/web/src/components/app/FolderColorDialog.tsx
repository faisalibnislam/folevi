"use client";

import { useFolderActions } from "@/lib/app/folders";
import { Check } from "lucide-react";
import { FOLDER_COLORS, folderColorId } from "@/lib/folderColors";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";

type ColorFolder = { id: string; name: string; color: string | null };

/**
 * Pick a folder colour from the palette's 25: for one folder, or (`folders`) every folder of a multi-selection at
 * once. The colour they all share, if any, is marked.
 */
export function FolderColorDialog({ open, onClose, folder, folders }: { open: boolean; onClose: () => void; folder?: ColorFolder; folders?: ColorFolder[] }) {
  const folderActions = useFolderActions();
  const toast = useToast();
  const list = folders ?? (folder ? [folder] : []);
  const shared = list.length && list.every((f) => folderColorId(f.color) === folderColorId(list[0]!.color)) ? folderColorId(list[0]!.color) : null;
  const title = list.length === 1 ? `Color for “${list[0]!.name}”` : `Color for ${list.length.toLocaleString()} folders`;
  return (
    <Dialog open={open} onClose={onClose} title={title} size="sm">
      <div role="radiogroup" aria-label="Folder color" className="grid grid-cols-5 gap-2.5">
        {FOLDER_COLORS.map((c) => {
          const on = shared === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={c.name}
              title={c.name}
              onClick={() => {
                try {
                  for (const f of list) folderActions.setColor(f.id, c.id);
                  if (list.length > 1) toast.show(`Changed the color of ${list.length.toLocaleString()} folders`);
                  onClose();
                } catch (e) {
                  toast.show(errorMessage(e), { tone: "error" });
                }
              }}
              style={{ background: c.hex }}
              className={`grid aspect-square place-items-center rounded-chip shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${on ? "ring-2 ring-heading ring-offset-2 ring-offset-surface" : ""}`}
            >
              {on ? <Check size={18} strokeWidth={2.5} className="text-[#17171a]" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
