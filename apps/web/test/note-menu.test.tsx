// The note page's "…" menu, grouped (components/doc/noteMenu.tsx, the owner, 6 November 2026), and the menu's
// submenus (components/ui/Menu.tsx): which items land where, one-item groups shown in their place, and a submenu
// opened and closed from the keyboard, the pointer and a finger.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ContextMenu, menuKeepsCheckColumn, type MenuItem } from "@/components/ui/Menu";
import { flattenMenu, noteMenuEntries, type NoteMenuParts } from "@/components/doc/noteMenu";

const it = (label: string, extra: Partial<MenuItem> = {}): MenuItem => ({ label, onSelect: vi.fn(), ...extra });

/** A menu as text: "-" for a separator, "Group > A, B" for a submenu. */
const shape = (entries: (MenuItem | "separator")[]): string[] =>
  entries.map((e) => (e === "separator" ? "-" : e.submenu ? `${e.label} > ${e.submenu.map((s) => (s === "separator" ? "-" : s.label)).join(", ")}` : e.label));

function everything(): NoteMenuParts {
  return {
    top: [it("Bookmark"), it("Comments"), it("Info"), it("Find and replace…", { shortcut: "⌘⌥F" })],
    connections: [it("Related notes"), it("Foli DNA")],
    history: [it("Version history…"), it("Show editors")],
    moveCopy: [it("Move…"), it("Copy to…"), it("Duplicate"), it("Move to another place…"), it("Move to the Vault…")],
    shareExport: [it("Export…"), it("Present", { shortcut: "⌘⌥P" }), it("Save as template")],
    settings: [it("Mute comment notifications"), it("Always fully encrypted", { checked: true, multi: true, checkAt: "end" })],
    end: [it("Archive"), it("Move to Trash", { danger: true })],
  };
}

describe("the note menu's structure", () => {
  test("everything available: the top four, five submenus, then Archive and Move to Trash", () => {
    expect(shape(noteMenuEntries(everything()))).toEqual([
      "Bookmark",
      "Comments",
      "Info",
      "Find and replace…",
      "-",
      "Connections > Related notes, Foli DNA",
      "History > Version history…, Show editors",
      "Move and copy > Move…, Copy to…, Duplicate, Move to another place…, Move to the Vault…",
      "Share and export > Export…, Present, Save as template",
      "Note settings > Mute comment notifications, Always fully encrypted",
      "-",
      "Archive",
      "Move to Trash",
    ]);
  });

  test("the items keep their shortcuts, check and danger style inside the submenus", () => {
    const entries = noteMenuEntries(everything()) as MenuItem[];
    const find = (label: string) => flattenMenu(entries).find((e): e is MenuItem => e !== "separator" && e.label === label)!;
    expect(find("Find and replace…").shortcut).toBe("⌘⌥F");
    expect(find("Present").shortcut).toBe("⌘⌥P");
    expect(find("Always fully encrypted")).toMatchObject({ checked: true, checkAt: "end" });
    expect(find("Move to Trash").danger).toBe(true);
  });

  test("a group with one item shows that item in its place; a group with none is left out", () => {
    const parts = everything();
    parts.connections = [];
    parts.history = [it("Version history…")];
    parts.moveCopy = [it("Move…"), it("Duplicate")];
    parts.settings = [it("Mute comment notifications")];
    expect(shape(noteMenuEntries(parts))).toEqual([
      "Bookmark",
      "Comments",
      "Info",
      "Find and replace…",
      "-",
      "Version history…",
      "Move and copy > Move…, Duplicate",
      "Share and export > Export…, Present, Save as template",
      "Mute comment notifications",
      "-",
      "Archive",
      "Move to Trash",
    ]);
  });

  test("no empty sections, so no doubled separators (a note in the Trash)", () => {
    const entries = noteMenuEntries({ top: [it("Restore from Trash"), it("Delete permanently…")], connections: [], history: [], moveCopy: [], shareExport: [], settings: [], end: [] });
    expect(shape(entries)).toEqual(["Restore from Trash", "Delete permanently…"]);
  });

  test("flattened, every item is there once (Info → Actions, the Mac's menu bar)", () => {
    const labels = flattenMenu(noteMenuEntries(everything())).filter((e): e is MenuItem => e !== "separator").map((e) => e.label);
    expect(labels).toHaveLength(20);
    expect(labels).toContain("Move to the Vault…");
    expect(labels).not.toContain("Connections");
  });

  test("the check column is kept only for a check that goes before the words", () => {
    expect(menuKeepsCheckColumn([it("A"), it("B", { checked: true, checkAt: "end" })])).toBe(false);
    expect(menuKeepsCheckColumn([it("A"), it("B", { checked: false })])).toBe(true);
    expect(menuKeepsCheckColumn([it("A"), "separator"])).toBe(false);
  });
});

describe("submenus", () => {
  let root: Root | null = null;
  let host: HTMLElement;
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  function open(items: (MenuItem | "separator")[], onClose = vi.fn()) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(<ContextMenu at={{ x: 10, y: 10 }} label="Document actions" items={items} onClose={onClose} />));
    return onClose;
  }
  const menus = () => [...document.querySelectorAll<HTMLElement>('[role="menu"]')];
  const row = (name: string) => [...document.querySelectorAll<HTMLButtonElement>(".ui-menu-item")].find((b) => b.textContent === name)!;
  const key = (k: string) =>
    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    });
  // (React makes its pointer enter events from "pointerover", with where the pointer came from.)
  const pointer = (el: Element, type: string, pointerType: string, from: Element | null = null) =>
    act(() => {
      // (Between two of React's elements, React goes by the "out" event of the one left.)
      if (type === "pointerover" && from) from.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: el, pointerType }));
      else el.dispatchEvent(new PointerEvent(type, { bubbles: true, relatedTarget: from, pointerType }));
    });

  const sample = () => {
    const x = it("Version history…");
    const y = it("Show editors");
    return { x, y, items: [it("Bookmark"), "separator" as const, it("History", { submenu: [x, y] }), it("Archive")] };
  };

  test("→ opens the submenu with the keyboard on its first item; ← goes back to its row", () => {
    open(sample().items);
    expect(document.activeElement).toBe(row("Bookmark"));
    key("ArrowDown");
    expect(document.activeElement).toBe(row("History"));
    expect(row("History").getAttribute("aria-haspopup")).toBe("menu");
    expect(row("History").getAttribute("aria-expanded")).toBe("false");
    key("ArrowRight");
    expect(menus()).toHaveLength(2);
    expect(menus()[1]!.getAttribute("aria-label")).toBe("History");
    expect(row("History").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(row("Version history…"));
    key("ArrowDown");
    expect(document.activeElement).toBe(row("Show editors"));
    key("ArrowLeft");
    expect(menus()).toHaveLength(1);
    expect(document.activeElement).toBe(row("History"));
  });

  test("Escape in a submenu goes back to its row, and Escape there closes the menu", () => {
    const onClose = open(sample().items);
    key("ArrowDown");
    key("ArrowRight");
    key("Escape");
    expect(menus()).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(row("History"));
    key("Escape");
    expect(onClose).toHaveBeenCalled();
  });

  test("Return on the row opens it; picking an item in it runs it and closes the whole menu", () => {
    const { y, items } = sample();
    const onClose = open(items);
    key("ArrowDown");
    act(() => row("History").click());
    expect(document.activeElement).toBe(row("Version history…"));
    act(() => row("Show editors").click());
    expect(y.onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalled();
    // (The submenu's own row does nothing itself.)
    expect((items[2] as MenuItem).onSelect).not.toHaveBeenCalled();
  });

  test("pointing at the row opens it after a moment, without taking the keyboard; pointing elsewhere closes it", () => {
    vi.useFakeTimers();
    try {
      open(sample().items);
      pointer(row("History"), "pointerover", "mouse", row("Bookmark"));
      expect(menus()).toHaveLength(1);
      act(() => vi.advanceTimersByTime(150));
      expect(menus()).toHaveLength(2);
      expect(document.activeElement).toBe(row("Bookmark"));
      // On its way into the submenu the pointer passes over another row: the submenu stays if it gets there.
      pointer(row("Archive"), "pointerover", "mouse", row("History"));
      pointer(menus()[1]!, "pointerover", "mouse", row("Archive"));
      act(() => vi.advanceTimersByTime(400));
      expect(menus()).toHaveLength(2);
      pointer(row("Archive"), "pointerover", "mouse", menus()[1]!);
      act(() => vi.advanceTimersByTime(400));
      expect(menus()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a finger: a tap on the row opens the submenu, another tap closes it", () => {
    open(sample().items);
    pointer(row("History"), "pointerdown", "touch");
    act(() => row("History").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(menus()).toHaveLength(2);
    pointer(row("History"), "pointerdown", "touch");
    act(() => row("History").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(menus()).toHaveLength(1);
  });

  test("a click inside the submenu isn't a click outside the menu", () => {
    const onClose = open(sample().items);
    key("ArrowDown");
    key("ArrowRight");
    act(() => menus()[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).toHaveBeenCalled();
  });

  test("a check at the end keeps no column before the icons", () => {
    open([it("Mute comment notifications"), it("Always fully encrypted", { checked: true, multi: true, checkAt: "end" })]);
    expect(menus()[0]!.hasAttribute("data-checks")).toBe(false);
    const lock = row("Always fully encrypted");
    expect(lock.querySelector('[data-menu-part="check-end"] svg')).not.toBeNull();
    expect(lock.querySelector('[data-menu-part="check"]')).toBeNull();
    expect(lock.getAttribute("aria-checked")).toBe("true");
  });
});
