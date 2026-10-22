"use client";
// Folevi for Mac's menu bar, two page-side pieces (docs/MAC_POLISH_PLAN.md §3.1, §3.6) next to DesktopBridge's
// (which runs the menu bar's commands and tells it what can run, lib/desktop.ts registerMenuCommand):
// - the open note's commands for the Note menu and File > Export, from the note's own "…" items
//   (useMacNoteCommands, called by DocumentView);
// - the tab shortcuts in today's Electron app, whose menus have no such items: ⌘1 to ⌘9 (⌘9 the last tab),
//   ⌃Tab and ⌃⇧Tab, ⇧⌘] and ⇧⌘[. (The native app's menu bar has them; there the page leaves them to it.)
import { useEffect, useRef } from "react";
import { useAppRouter } from "@/lib/app/router";
import { tabHref, tabPage, useTabs } from "@/lib/app/tabs";
import { registerMenuCommand, type MacMenuCommand } from "@/lib/desktop";
import { inMacApp, inMacWebKit } from "@/lib/desktop/mac";

export function MacCommands() {
  return inMacApp() && !inMacWebKit() ? <TabShortcuts /> : null;
}

function TabShortcuts() {
  const { navigate, route, pathname } = useAppRouter();
  const { tabs, homeHref } = useTabs();
  const latest = useRef({ navigate, route, pathname, tabs, homeHref });
  latest.current = { navigate, route, pathname, tabs, homeHref };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const { navigate, route, pathname, tabs, homeHref } = latest.current;
      const strip = [homeHref, ...tabs.map(tabHref)];
      const docId = route.name === "doc" ? route.id : null;
      const at = tabs.findIndex((t) => (t.view ? t.view.path === pathname : docId !== null && tabPage(t) === docId)) + 1;
      const digit = /^Digit([1-9])$/.exec(e.code);
      let href: string | undefined;
      if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && digit) {
        const n = Number(digit[1]);
        href = n === 9 ? strip[strip.length - 1] : strip[n - 1];
      } else if (strip.length > 1 && ((e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Tab") || (e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && (e.code === "BracketRight" || e.code === "BracketLeft")))) {
        const back = e.key === "Tab" ? e.shiftKey : e.code === "BracketLeft";
        href = strip[(at + (back ? strip.length - 1 : 1)) % strip.length];
      }
      if (!href) return;
      e.preventDefault();
      navigate(href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

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
 * The open note's commands for the menu bar (the native app): each does what the note's "…" item does, and is off
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
    if (!ids || !inMacWebKit()) return;
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
