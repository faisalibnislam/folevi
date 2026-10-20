// Tabs inside a note. A `tabs` block is the container (no text, no props); each of its direct children is a
// `tab` block whose text is the tab's name; a tab's children are what the tab holds. Everything stays an
// ordinary block in the tree (parentId + rank), so sync, history, copy and paste, search and exports treat
// tab contents like any other nested blocks. Which tab is open is not stored: it's each viewer's own.
import type { InlineNode } from "./generated/schema";
import type { WireBlock } from "./types";
import { plainText } from "./richtext";
import type { FlatEntry } from "./tree";

export const TABS_TYPE = "tabs";
export const TAB_TYPE = "tab";

/** The longest tab name kept (longer ones are cut when renamed in the editor). */
export const MAX_TAB_NAME = 60;

/** A tab's name as shown: its text on one line, or "Untitled" when empty. */
export function tabName(block: Pick<WireBlock, "text">): string {
  const name = plainText(block.text).replace(/\s+/g, " ").trim();
  return name || "Untitled";
}

/** A tab name typed by someone, cleaned (one line, trimmed, at most MAX_TAB_NAME characters) as inline text. */
export function tabNameText(name: string): InlineNode[] {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, MAX_TAB_NAME);
  return clean ? [{ type: "text", text: clean }] : [];
}

/**
 * The depth each entry is shown at: a tab's contents sit at its tabs block's level (not two levels in), a
 * tab itself (drawn as a heading in exports) at the tabs block's level too. Other entries keep their depth.
 * Exports (Markdown, HTML, PDF) and read-only pages use this so tab contents aren't indented.
 */
export function liftTabs<T extends Pick<WireBlock, "type">>(flat: readonly FlatEntry<T>[]): FlatEntry<T>[] {
  // Open tabs blocks and tabs: their depth and how many levels the lines inside them come up by.
  const stack: { depth: number; type: string; lift: number }[] = [];
  return flat.map(({ block, depth }) => {
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const top = stack[stack.length - 1];
    const lift = top?.lift ?? 0;
    const shown = Math.max(0, depth - lift);
    if (block.type === TABS_TYPE) stack.push({ depth, type: TABS_TYPE, lift: lift + 1 });
    else if (block.type === TAB_TYPE && top?.type === TABS_TYPE && top.depth === depth - 1) stack.push({ depth, type: TAB_TYPE, lift: lift + 1 });
    return shown === depth ? { block, depth } : { block, depth: shown };
  });
}

export interface TabGroup<T> {
  /** The tabs block. */
  block: T;
  /** Index of the tabs block in the flat list. */
  index: number;
  /** One past the last entry inside the tabs block. */
  end: number;
  /** Its tabs, in order: the tab block, where it is and where its contents end. */
  tabs: { block: T; index: number; end: number }[];
}

/** The tabs block at `index` of a flat list with its tabs (direct `tab` children), or null if it isn't one. */
export function tabGroupAt<T extends Pick<WireBlock, "type">>(flat: readonly FlatEntry<T>[], index: number): TabGroup<T> | null {
  const head = flat[index];
  if (!head || head.block.type !== TABS_TYPE) return null;
  let end = index + 1;
  while (end < flat.length && flat[end]!.depth > head.depth) end++;
  const tabs: TabGroup<T>["tabs"] = [];
  for (let i = index + 1; i < end; i++) {
    const e = flat[i]!;
    if (e.depth !== head.depth + 1 || e.block.type !== TAB_TYPE) continue;
    // A tab's contents end where the next child of the tabs block starts.
    let j = i + 1;
    while (j < end && flat[j]!.depth > head.depth + 1) j++;
    tabs.push({ block: e.block, index: i, end: j });
  }
  return { block: head.block, index, end, tabs };
}
