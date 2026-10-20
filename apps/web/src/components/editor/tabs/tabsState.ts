// Tabs inside a note, in the editor: which tab of each tabs block is open (each viewer's own, remembered on
// this device) and what that means for the flat list of lines. A tabs block's lines are its tabs (never shown:
// the tab strip shows their names) and each tab's lines nested under it; only the open tab's lines show, at
// the tabs block's own indent. Pure helpers (no editor view), so the keymap, decorations, block selection,
// drag and drop and paste can all ask the same questions. See packages/editor-schema/src/tabs.ts.
import { PluginKey, type EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface TabsViewState {
  /** Tabs opened on this device in this session, by tabs block id (the rest come from storage). */
  active: ReadonlyMap<string, string>;
}

export const tabsKey = new PluginKey<TabsViewState>("foleviTabs");

/** Transaction meta: open a tab. */
export interface TabsMeta {
  open: { tabsId: string; tabId: string };
}

const STORE = "folevi:tab:";

/** The tab last opened on this device for a tabs block (null when none, or storage is unavailable). */
export function storedTab(tabsId: string): string | null {
  try {
    return localStorage.getItem(STORE + tabsId);
  } catch {
    return null;
  }
}

export function storeTab(tabsId: string, tabId: string): void {
  try {
    localStorage.setItem(STORE + tabsId, tabId);
  } catch {
    /* private mode: remembered for this visit only */
  }
}

export interface TabInfo {
  id: string;
  name: string;
  /** Index of the tab line among the note's lines. */
  index: number;
  /** One past its last line. */
  end: number;
}

export interface TabsGroup {
  id: string;
  index: number;
  depth: number;
  /** One past the last line inside the tabs block. */
  end: number;
  tabs: TabInfo[];
  /** The open tab's id (the remembered one, else the first), or null when it has no tabs. */
  open: string | null;
}

export interface TabLayout {
  groups: TabsGroup[];
  byId: Map<string, TabsGroup>;
  /** Lines not shown: every tab line, and the lines of tabs that aren't open. */
  hidden: Set<number>;
  /** How many levels a line is drawn further out than its depth (two for each open tab it's in). */
  lift: Map<number, number>;
  /** The open tab each shown line sits in (the innermost), with its tabs block. */
  panel: Map<number, { group: TabsGroup; tab: TabInfo }>;
  /** The last line shown in each open tab, with the indent (as drawn) of the tabs block's bottom edge under it. */
  last: Map<number, number>;
}

const EMPTY: TabLayout = { groups: [], byId: new Map(), hidden: new Set(), lift: new Map(), panel: new Map(), last: new Map() };

const cache = new WeakMap<PMNode, { active: ReadonlyMap<string, string> | undefined; layout: TabLayout }>();

/** The tabs blocks of a note and what they hide (cached per document and open tabs). */
export function tabLayout(doc: PMNode, active?: ReadonlyMap<string, string>): TabLayout {
  const hit = cache.get(doc);
  if (hit && hit.active === active) return hit.layout;
  const layout = computeLayout(doc, active);
  cache.set(doc, { active, layout });
  return layout;
}

export function layoutOf(state: EditorState): TabLayout {
  return tabLayout(state.doc, tabsKey.getState(state)?.active);
}

function computeLayout(doc: PMNode, active?: ReadonlyMap<string, string>): TabLayout {
  const n = doc.childCount;
  let any = false;
  for (let i = 0; i < n && !any; i++) any = doc.child(i).type.name === "tabs";
  if (!any) return EMPTY;
  const depth: number[] = [];
  const type: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = doc.child(i);
    depth.push(Number(c.attrs.depth ?? 0));
    type.push(c.type.name);
  }
  const groups: TabsGroup[] = [];
  for (let i = 0; i < n; i++) {
    if (type[i] !== "tabs") continue;
    const d = depth[i]!;
    let end = i + 1;
    while (end < n && depth[end]! > d) end++;
    const tabs: TabInfo[] = [];
    for (let j = i + 1; j < end; j++) {
      if (depth[j] !== d + 1 || type[j] !== "tab") continue;
      let k = j + 1;
      while (k < end && depth[k]! > d + 1) k++;
      const node = doc.child(j);
      tabs.push({ id: String(node.attrs.id ?? `tab-${j}`), name: String(node.attrs.name ?? "").trim() || "Untitled", index: j, end: k });
    }
    const id = String(doc.child(i).attrs.id ?? `tabs-${i}`);
    const chosen = active?.get(id) ?? storedTab(id);
    const open = tabs.find((t) => t.id === chosen)?.id ?? tabs[0]?.id ?? null;
    groups.push({ id, index: i, depth: d, end, tabs, open });
  }
  const hidden = new Set<number>();
  const lift = new Map<number, number>();
  const panel = new Map<number, { group: TabsGroup; tab: TabInfo }>();
  // Outer tabs blocks come first, so an inner one's open tab overwrites `panel` for its lines.
  for (const g of groups) {
    for (let k = g.index + 1; k < g.end; k++) lift.set(k, (lift.get(k) ?? 0) + 1);
    for (const t of g.tabs) {
      hidden.add(t.index);
      for (let k = t.index + 1; k < t.end; k++) {
        lift.set(k, (lift.get(k) ?? 0) + 1);
        if (t.id !== g.open) hidden.add(k);
        else panel.set(k, { group: g, tab: t });
      }
    }
  }
  // Lines folded away in a collapsed toggle don't count as shown.
  const folded = new Set<number>();
  let below: number | null = null;
  for (let i = 0; i < n; i++) {
    if (below !== null && depth[i]! <= below) below = null;
    if (below !== null) folded.add(i);
    else if (type[i] === "toggle" && doc.child(i).attrs.collapsed) below = depth[i]!;
  }
  const last = new Map<number, number>();
  for (const g of groups) {
    const t = g.tabs.find((x) => x.id === g.open);
    if (!t) continue;
    for (let k = t.end - 1; k > t.index; k--) {
      if (hidden.has(k) || folded.has(k)) continue;
      // Inner tabs blocks ending on the same line: the outermost edge is drawn.
      last.set(k, Math.min(last.get(k) ?? Infinity, g.depth - (lift.get(g.index) ?? 0)));
      break;
    }
  }
  const byId = new Map(groups.map((g) => [g.id, g]));
  return { groups, byId, hidden, lift, panel, last };
}

/** The open tabs a line is in, outermost first (each with its tabs block). */
function panelsOf(layout: TabLayout, index: number): { group: TabsGroup; tab: TabInfo }[] {
  const out: { group: TabsGroup; tab: TabInfo }[] = [];
  for (const g of layout.groups) {
    if (index <= g.index || index >= g.end) continue;
    const t = g.tabs.find((x) => index > x.index && index < x.end);
    if (t) out.push({ group: g, tab: t });
  }
  return out;
}

/**
 * The shallowest depth a line can be outdented to: a tab's lines stay in their tab (one level under the tab
 * line), so Shift+Tab and Backspace at the start of a tab's first-level line don't move it out.
 */
export function tabFloor(state: EditorState, index: number): number {
  const layout = layoutOf(state);
  if (!layout.groups.length) return 0;
  const panels = panelsOf(layout, index);
  const inner = panels[panels.length - 1];
  return inner ? inner.group.depth + 2 : 0;
}

/**
 * The deepest a line can be indented to by Tab, when tabs limit it: the line right after a tabs block can't
 * go into it (it would end up in the last tab, out of sight when that tab isn't open). Null: no limit.
 */
export function tabCeiling(state: EditorState, index: number): number | null {
  const layout = layoutOf(state);
  let ceiling: number | null = null;
  for (const g of layout.groups) if (g.end === index) ceiling = ceiling === null ? g.depth : Math.min(ceiling, g.depth);
  return ceiling;
}

/**
 * Where a dragged block lands, from where the drop line is: before line `index`, at `depth` as drawn (a tab's
 * lines are drawn at their tabs block's indent). Dropped under the last line of an open tab and at least at
 * the tabs block's indent, it goes into that tab (not after the hidden tabs that follow it); further out, it
 * goes after the tabs block. In the middle of a tab's lines it stays in the tab. `above` is the shown line
 * just above the drop line (null at the top).
 */
export function tabsDrop(layout: TabLayout, index: number, depth: number, above: number | null): { index: number; depth: number } {
  if (!layout.groups.length || above === null) return { index, depth };
  // Just under a tab strip: the first line of the open tab.
  const strip = layout.groups.find((g) => g.index === above);
  if (strip) {
    const tab = strip.tabs.find((t) => t.id === strip.open);
    if (tab) return { index: tab.index + 1, depth: strip.depth + 2 };
  }
  const panels = panelsOf(layout, above);
  // Innermost first: the first open tab the drop stays in.
  for (let i = panels.length - 1; i >= 0; i--) {
    const { group, tab } = panels[i]!;
    const groupLift = layout.lift.get(group.index) ?? 0;
    // A tab's lines are drawn at the tabs block's indent: two levels out from their depth.
    if (depth >= group.depth - groupLift || index < tab.end) {
      // Not before the end of an inner tabs block it was dropped under.
      const inner = panels[i + 1];
      const at = Math.max(Math.min(index, tab.end), inner ? inner.group.end : 0);
      return { index: at, depth: Math.max(group.depth + 2, depth + groupLift + 2) };
    }
  }
  // Out of every tab: after the outermost tabs block, at most at its depth.
  const outer = panels[0];
  if (!outer) return { index, depth };
  return { index: Math.max(index, outer.group.end), depth: Math.min(depth, outer.group.depth) };
}
