"use client";

import { useEffect, useId, useState } from "react";
import { Check } from "lucide-react";
import { flattenFolders } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { useFolderActions, useFolderTree } from "@/lib/app/folders";
import { FOLDER_COLORS } from "@/lib/folderColors";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { Select } from "@/components/ui/Select";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Sheet } from "./Sheet";

/**
 * New folder, as a glass card over the screen (above the keyboard): its name, its colour and where it goes
 * (the top level, or inside another folder; inside the folder you're in when opened from one). Create opens it.
 */
export function NewFolderSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { scope } = useAppState();
  const { route, navigate } = useAppRouter();
  const org = useFolderTree(open ? scope : "skip");
  const actions = useFolderActions();
  const toast = useToast();
  const nameId = useId();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(() => FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)]!.id);
  const [parent, setParent] = useState("");
  useEffect(() => {
    if (!open) return;
    setName("");
    setParent(route.name === "folder" ? route.id : "");
    setColor(FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const create = () => {
    const title = name.trim();
    if (!title) return;
    try {
      const id = actions.create(title, parent || null);
      actions.setColor(id, color);
      onClose();
      navigate(`/folders/${id}`);
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };
  const folders = flattenFolders(org?.folders ?? []);
  return (
    <Sheet open={open} onClose={onClose} variant="card" title="New folder">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        className="px-4 pb-4"
      >
        <label htmlFor={nameId} className="block px-1 pb-1.5 text-[13px] font-medium text-muted">
          Title
        </label>
        <div className="flex items-center gap-3 rounded-panel bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] px-3">
          <FolderGlyph color={color} size={22} />
          <input
            id={nameId}
            autoFocus
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder="Folder name"
            enterKeyHint="done"
            autoComplete="off"
            className="h-12 min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-faint"
          />
        </div>
        <p id={`${nameId}-color`} className="px-1 pb-2 pt-4 text-[13px] font-medium text-muted">
          Color
        </p>
        <div role="radiogroup" aria-labelledby={`${nameId}-color`} className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FOLDER_COLORS.map((c) => {
            const on = c.id === color;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={c.name}
                onClick={() => setColor(c.id)}
                style={{ background: c.hex }}
                className={`grid h-9 w-9 flex-none place-items-center rounded-capsule shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)] outline-none transition-transform active:scale-90 focus-visible:ring-2 focus-visible:ring-focus ${on ? "ring-2 ring-heading ring-offset-2 ring-offset-[var(--liquid-fill-strong)]" : ""}`}
              >
                {on ? <Check size={17} strokeWidth={2.6} className="text-[#17171a]" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
        {folders.length ? (
          <label className="mt-4 flex items-center justify-between gap-3 px-1 text-[15px]">
            <span className="text-muted">Inside</span>
            <Select value={parent} onChange={(e) => setParent(e.target.value)} className="ui-well h-10 max-w-[60%] rounded-control px-3 text-[15px] text-ink">
              <option value="">Top level</option>
              {folders.map(({ folder: f, depth }) => (
                <option key={f.id} value={f.id}>
                  {"   ".repeat(depth)}
                  {f.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <button
          type="submit"
          disabled={!name.trim()}
          className="mt-5 h-12 w-full rounded-panel bg-heading text-[17px] font-semibold text-canvas outline-none transition-[opacity,transform] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-focus disabled:bg-[color-mix(in_oklab,var(--color-ink)_8%,transparent)] disabled:text-faint"
        >
          Create
        </button>
      </form>
    </Sheet>
  );
}
