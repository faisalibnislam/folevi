"use client";
// Folevi for Mac's menu bar, the page's side of the Note menu and File > Export (docs/MAC_POLISH_PLAN.md §3.1,
// §3.6), next to DesktopBridge's (which runs the menu bar's commands and tells it what can run, lib/desktop.ts
// registerMenuCommand): the open note's commands, from the note's own "…" items (useMacNoteCommands, called by
// DocumentView). The tab shortcuts (⌘1 to ⌘9, ⌃Tab, ⇧⌘] and ⇧⌘[) are the app's menu bar's own.
import { useEffect, useRef } from "react";
import { registerMenuCommand, type MacMenuCommand } from "@/lib/desktop";
import { inMacApp } from "@/lib/desktop/mac";

/** The Note menu's commands, by the note's own menu items' words. */
const NOTE_ITEMS: [MacMenuCommand, string[]][] = [
  ["note.star", ["Star", "Unstar"]],
  ["note.archive", ["Archive", "Unarchive"]],
  ["note.move", ["Move…"]],
  ["note.duplicate", ["Duplicate"]],
  ["note.history", ["Version history…"]],
  ["note.trash", ["Move to Trash"]],
  ["file.export", ["Export…"]],
];

/**
 * The open note's commands for the menu bar: each does what the note's "…" item does, and is off
 * where that item is missing or off.
 */
export function useMacNoteCommands(items: ReadonlyArray<{ label: string; onSelect: () => void; disabled?: boolean } | "separator">) {
  const latest = useRef(items);
  latest.current = items;
  const pick = (labels: string[]) => latest.current.find((it): it is Exclude<(typeof items)[number], "separator"> => it !== "separator" && labels.includes(it.label) && !it.disabled);
  const ids = NOTE_ITEMS.filter(([, labels]) => items.some((it) => it !== "separator" && labels.includes(it.label) && !it.disabled))
    .map(([id]) => id)
    .join("|");
  useEffect(() => {
    if (!ids || !inMacApp()) return;
    const stops = ids.split("|").map((id) =>
      registerMenuCommand(id as MacMenuCommand, () => {
        const item = pick(NOTE_ITEMS.find(([x]) => x === id)![1]);
        if (!item) return false;
        item.onSelect();
      }),
    );
    return () => stops.forEach((s) => s());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
}
