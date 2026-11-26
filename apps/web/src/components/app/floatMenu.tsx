"use client";
// "Float this note" as a menu item (lib/app/float.ts): in a note tab's right-click menu and a note's right-click menu
// in lists (folder pages, Home, search, the sidebar's bookmarks). Left out where a note can't float (Safari,
// Firefox, the phone and tablet apps, a floating note's own window).
import { PictureInPicture2 } from "lucide-react";
import type { MenuItem } from "@/components/ui/Menu";
import { FLOAT_LABEL, floatKind, floatNote, type FloatingNote } from "@/lib/app/float";

export function floatMenuItems(note: FloatingNote): MenuItem[] {
  if (!floatKind()) return [];
  return [{ label: FLOAT_LABEL, icon: <PictureInPicture2 size={14} />, onSelect: () => floatNote(note) }];
}
