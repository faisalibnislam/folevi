// Tabs inside a note, in the editor: the open tab of each tabs block (plugin state), keeping a tabs block's
// lines in shape after local edits, its keys, and the commands its tab strip runs (tabs/TabsView.tsx).
import { Extension, type Editor } from "@tiptap/core";
import { NodeSelection, Plugin, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import { LIMITS, MAX_TAB_NAME, ulid } from "@folevi/editor-schema";
import { blocksInSelection, moveSubtreeTo, normalizeDepths, subtreeRange } from "../commands";
import { TEXT_NODES } from "../convert";
import { onlyEditsText } from "../plugins";
import { layoutOf, storeTab, tabLayout, tabsKey, type TabsGroup, type TabsMeta, type TabsViewState } from "./tabsState";
import { announce } from "@/lib/a11y/announce";

function startOf(doc: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < Math.min(index, doc.childCount); i++) pos += doc.child(i).nodeSize;
  return pos;
}

/**
 * The first thing out of shape in the note's tabs blocks, as a fix, or null. A tab line outside a tabs block
 * becomes a plain line with its name; a line directly in a tabs block (not in a tab: outdented, dropped or
 * pasted there) moves into the tab before it, or the first tab moves up to hold it, or a new tab starts.
 */
export function tabsFix(doc: PMNode, schema: Schema): ((tr: Transaction) => void) | null {
  const n = doc.childCount;
  const starts: number[] = [];
  const depth: number[] = [];
  const type: string[] = [];
  let p = 0;
  for (let i = 0; i < n; i++) {
    const c = doc.child(i);
    starts.push(p);
    p += c.nodeSize;
    depth.push(Number(c.attrs.depth ?? 0));
    type.push(c.type.name);
  }
  // The last line at each depth since a shallower one: a line's parent is the entry one level up.
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = depth[i]!;
    const level = Math.min(d, stack.length);
    const prevSibling = stack.length > level ? stack[level]! : -1;
    const parent = level > 0 ? stack[level - 1]! : -1;
    stack.length = level;
    stack.push(i);
    const parentType = parent >= 0 ? type[parent] : null;
    if (type[i] === "tab" && parentType !== "tabs") {
      return (tr) => {
        const node = doc.child(i);
        const name = String(node.attrs.name ?? "").trim();
        tr.replaceWith(starts[i]!, starts[i]! + node.nodeSize, schema.nodes.paragraph!.create({ id: node.attrs.id, depth: d }, name ? schema.text(name) : null));
      };
    }
    if (parentType !== "tabs" || type[i] === "tab") continue;
    let j = i + 1;
    while (j < n && depth[j]! > d) j++;
    if (prevSibling >= 0) {
      // Into the tab before it (with what's nested under it).
      return (tr) => {
        for (let k = i; k < j; k++) {
          const node = doc.child(k);
          tr.setNodeMarkup(starts[k]!, undefined, { ...node.attrs, depth: Math.min(LIMITS.maxDepth, depth[k]! + 1) });
        }
      };
    }
    // Before the first tab: it moves into the first tab (as its first lines), or a new tab starts.
    let t = j;
    while (t < n && depth[t]! > d - 1 && !(depth[t] === d && type[t] === "tab")) t++;
    if (t < n && depth[t] === d && type[t] === "tab") {
      return (tr) => {
        const moved: PMNode[] = [];
        for (let k = i; k < j; k++) {
          const node = doc.child(k);
          moved.push(node.type.create({ ...node.attrs, depth: Math.min(LIMITS.maxDepth, depth[k]! + 1) }, node.content, node.marks));
        }
        tr.insert(starts[t]! + doc.child(t).nodeSize, moved);
        tr.delete(starts[i]!, starts[j]!);
      };
    }
    return (tr) => {
      tr.insert(starts[i]!, schema.nodes.tab!.create({ id: ulid(), depth: d, name: "Tab 1" }));
    };
  }
  return null;
}

/** Applies every fix tabsFix finds (null when the note's tabs are in shape). */
export function fixTabs(state: EditorState): Transaction | null {
  let any = false;
  state.doc.forEach((node) => {
    if (node.type.name === "tabs" || node.type.name === "tab") any = true;
  });
  if (!any) return null;
  const tr = state.tr;
  for (let guard = 0; guard < 200; guard++) {
    const fix = tabsFix(tr.doc, state.schema);
    if (!fix) break;
    fix(tr);
  }
  if (!tr.docChanged) return null;
  normalizeDepths(tr);
  return tr;
}

function group(state: EditorState, tabsId: string): TabsGroup | null {
  return layoutOf(state).byId.get(tabsId) ?? null;
}

/** The note's lines from `from` to before `to` (top-level indices). */
function range(doc: PMNode, from: number, to: number): { start: number; end: number } {
  const start = startOf(doc, from);
  return { start, end: startOf(doc, to) };
}

/**
 * Opens a tab (on this device; others keep the tab they chose). With `focusContent`, the caret goes to the
 * start of the tab's first line. The caret never stays in a tab that was just hidden.
 */
export function openTab(view: EditorView, tabsId: string, tabId: string, focusContent = false): void {
  storeTab(tabsId, tabId);
  const { state } = view;
  const meta: TabsMeta = { open: { tabsId, tabId } };
  const tr = state.tr.setMeta(tabsKey, meta).setMeta("addToHistory", false);
  const active = new Map(tabsKey.getState(state)?.active).set(tabsId, tabId);
  const layout = tabLayout(state.doc, active);
  const g = layout.byId.get(tabsId);
  const tab = g?.tabs.find((t) => t.id === tabId);
  if (g && tab && (focusContent || layout.hidden.has(state.selection.$from.index(0)))) {
    const first = tab.index + 1 < tab.end ? tab.index + 1 : null;
    if (first !== null && state.doc.child(first).isTextblock) tr.setSelection(TextSelection.create(state.doc, startOf(state.doc, first) + 1));
    else if (first !== null) tr.setSelection(NodeSelection.create(state.doc, startOf(state.doc, first)));
    else tr.setSelection(NodeSelection.create(state.doc, startOf(state.doc, g.index)));
  }
  view.dispatch(tr);
  if (focusContent) view.focus();
}

/** A name for a new tab: "Tab 3", or the next free number. */
function freshName(g: TabsGroup): string {
  const names = new Set(g.tabs.map((t) => t.name));
  let k = g.tabs.length + 1;
  while (names.has(`Tab ${k}`)) k++;
  return `Tab ${k}`;
}

/** Adds a tab at the end (with one empty line) and opens it. Returns its id. */
export function addTab(view: EditorView, tabsId: string): string | null {
  const g = group(view.state, tabsId);
  if (!g) return null;
  const { schema } = view.state;
  const id = ulid();
  const at = startOf(view.state.doc, g.end);
  const tr = view.state.tr.insert(at, [
    schema.nodes.tab!.create({ id, depth: g.depth + 1, name: freshName(g) }),
    schema.nodes.paragraph!.create({ id: ulid(), depth: g.depth + 2 }),
  ]);
  view.dispatch(closeHistory(tr));
  openTab(view, tabsId, id);
  announce("Tab added");
  return id;
}

export function renameTab(view: EditorView, tabsId: string, tabId: string, name: string): void {
  const g = group(view.state, tabsId);
  const tab = g?.tabs.find((t) => t.id === tabId);
  const clean = name.replace(/\s+/g, " ").trim().slice(0, MAX_TAB_NAME);
  if (!tab || !clean) return;
  const node = view.state.doc.child(tab.index);
  if (node.attrs.name === clean) return;
  view.dispatch(view.state.tr.setNodeMarkup(startOf(view.state.doc, tab.index), undefined, { ...node.attrs, name: clean }));
}

/** Moves a tab (with everything in it) to place `to` among the tabs. */
export function moveTab(view: EditorView, tabsId: string, tabId: string, to: number): void {
  const g = group(view.state, tabsId);
  if (!g) return;
  const from = g.tabs.findIndex((t) => t.id === tabId);
  const target = Math.max(0, Math.min(g.tabs.length - 1, to));
  if (from < 0 || from === target) return;
  const tab = g.tabs[from]!;
  // Before the tab now at the target place (moving right: the one after it), or at the end.
  const before = target > from ? g.tabs[target + 1] : g.tabs[target];
  const toIndex = before ? before.index : g.end;
  const moved = moveSubtreeTo(view.state, tab.index, toIndex, g.depth + 1);
  if (!moved) return;
  view.dispatch(closeHistory(moved.tr));
  announce(`Moved to place ${target + 1} of ${g.tabs.length}`);
}

/** Deletes a tab and what's in it; the only tab deletes the whole tabs block. */
export function deleteTab(view: EditorView, tabsId: string, tabId: string): void {
  const g = group(view.state, tabsId);
  const i = g?.tabs.findIndex((t) => t.id === tabId) ?? -1;
  if (!g || i < 0) return;
  if (g.tabs.length === 1) {
    deleteTabsBlock(view, tabsId);
    return;
  }
  const tab = g.tabs[i]!;
  const { start, end } = range(view.state.doc, tab.index, tab.end);
  const tr = view.state.tr.delete(start, end);
  view.dispatch(closeHistory(tr));
  if (g.open === tabId) {
    const next = g.tabs[i + 1] ?? g.tabs[i - 1];
    if (next) openTab(view, tabsId, next.id);
  }
  announce("Tab deleted");
}

/** Deletes a tabs block with all its tabs. */
export function deleteTabsBlock(view: EditorView, tabsId: string): void {
  const g = group(view.state, tabsId);
  if (!g) return;
  const { start, end } = range(view.state.doc, g.index, g.end);
  const tr = view.state.tr.delete(start, end);
  if (tr.doc.childCount === 0) tr.insert(0, view.state.schema.nodes.paragraph!.create({ id: ulid(), depth: 0 }));
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(start, tr.doc.content.size))));
  normalizeDepths(tr);
  view.dispatch(closeHistory(tr).scrollIntoView());
  view.focus();
}

/** Puts an empty line in a tab that has none, with the caret in it. */
export function writeInTab(view: EditorView, tabsId: string, tabId: string): void {
  const g = group(view.state, tabsId);
  const tab = g?.tabs.find((t) => t.id === tabId);
  if (!g || !tab) return;
  const at = startOf(view.state.doc, tab.end);
  const tr = view.state.tr.insert(at, view.state.schema.nodes.paragraph!.create({ id: ulid(), depth: g.depth + 2 }));
  tr.setSelection(TextSelection.create(tr.doc, at + 1));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/**
 * Inserts a tabs block with two tabs after the current block (in place of an empty line), with a line to go
 * on writing after it, and the caret in the first tab.
 */
export function insertTabs(editor: Editor): boolean {
  const { state, view } = editor;
  const [current] = blocksInSelection(state);
  const depth = Math.min(LIMITS.maxDepth - 2, current ? Number(current.node.attrs.depth ?? 0) : 0);
  const next = current ? state.doc.maybeChild(current.index + 1) : null;
  const hasChildren = Boolean(current && next && Number(next.attrs.depth ?? 0) > depth);
  const empty = current && TEXT_NODES.has(current.node.type.name) && current.node.content.size === 0 && !hasChildren;
  const { schema } = state;
  const nodes = [
    schema.nodes.tabs!.create({ id: ulid(), depth }),
    schema.nodes.tab!.create({ id: ulid(), depth: depth + 1, name: "Tab 1" }),
    schema.nodes.paragraph!.create({ id: ulid(), depth: depth + 2 }),
    schema.nodes.tab!.create({ id: ulid(), depth: depth + 1, name: "Tab 2" }),
    schema.nodes.paragraph!.create({ id: ulid(), depth: depth + 2 }),
  ];
  const tr = state.tr;
  let at: number;
  if (current && empty) {
    at = current.pos;
    tr.replaceWith(current.pos, current.pos + current.node.nodeSize, nodes);
  } else {
    at = current ? subtreeRange(state, current.index).end : state.doc.content.size;
    tr.insert(at, nodes);
  }
  const size = nodes.reduce((s, x) => s + x.nodeSize, 0);
  if (!tr.doc.nodeAt(at + size)) tr.insert(at + size, schema.nodes.paragraph!.create({ id: ulid(), depth }));
  // The caret in Tab 1's line.
  tr.setSelection(TextSelection.create(tr.doc, at + nodes[0]!.nodeSize + nodes[1]!.nodeSize + 1));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

/** Tabs: which tab is open, keeping tabs blocks in shape, and their keys. */
export const TabsExtension = Extension.create({
  name: "foleviTabs",
  priority: 1100,
  addProseMirrorPlugins() {
    return [
      new Plugin<TabsViewState>({
        key: tabsKey,
        state: {
          init: () => ({ active: new Map() }),
          apply: (tr, value) => {
            const meta = tr.getMeta(tabsKey) as TabsMeta | undefined;
            if (!meta) return value;
            const active = new Map(value.active);
            active.set(meta.open.tabsId, meta.open.tabId);
            return { active };
          },
        },
        // Only after this person's own edits: everyone's editor would otherwise repair the same thing at once.
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((t) => t.docChanged && !t.getMeta("remote"))) return null;
          if (transactions.every((t) => !t.docChanged || onlyEditsText(t))) return null;
          return fixTabs(state);
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    const editor = this.editor as Editor;
    /** A selected tabs block goes whole, with all its tabs. */
    const deleteSelectedTabs = () => {
      const sel = editor.state.selection;
      if (!(sel instanceof NodeSelection) || sel.node.type.name !== "tabs" || !editor.isEditable) return false;
      deleteTabsBlock(editor.view, String(sel.node.attrs.id));
      return true;
    };
    return {
      Backspace: deleteSelectedTabs,
      Delete: () => {
        if (deleteSelectedTabs()) return true;
        // At the end of an open tab's last line, the next lines are other tabs, out of sight: nothing to join.
        const { state, view } = editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.depth < 1 || $from.parentOffset !== $from.parent.content.size) return false;
        const index = $from.index(0);
        if (!layoutOf(state).hidden.has(index + 1)) return false;
        return view.endOfTextblock("forward");
      },
    };
  },
});
