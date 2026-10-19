// Making mind maps from other shapes of the same ideas, and back: an outline (text with depths, as a
// bulleted list in a note is), a nested Markdown list (MCP, Foli AI chat, pasted text), and a nested JSON
// tree (what Foli AI writes). Every result goes through normalizeMindmap, so it's within the limits.
import { itemId } from "./blockData";
import { MINDMAP_COLORS, MINDMAP_LIMITS, MINDMAP_LAYOUTS, mindmapChildren, mindmapRoot, normalizeMindmap, type MindmapColor, type MindmapData, type MindmapLayout, type MindNode } from "./mindmap";

/** A short id for a new idea. */
export const mindId = (): string => itemId("i");

/** The central idea a map gets when its outline has several top-level items and nothing names one. */
export const MINDMAP_DEFAULT_CENTRE = "Central idea";

export interface OutlineItem {
  text: string;
  /** 0 for a top-level item; deeper items nest under the nearest shallower one before them. */
  depth: number;
}

/**
 * A map from an outline. One top-level item becomes the central idea; several hang from a new centre
 * (`centre`, or "Central idea"). Depths that skip a level nest one level deeper than the item before.
 */
export function mindmapFromOutline(items: readonly OutlineItem[], opts: { centre?: string; layout?: MindmapLayout; newId?: () => string } = {}): MindmapData {
  const newId = opts.newId ?? mindId;
  const list = items.map((it) => ({ text: it.text.replace(/\s*\n+\s*/g, " ").trim(), depth: Math.max(0, Math.floor(it.depth)) }));
  if (!list.length) return normalizeMindmap({ layout: opts.layout ?? "both", nodes: [] });
  const base = Math.min(...list.map((i) => i.depth));
  const tops = list.filter((i) => i.depth === base).length;
  const nodes: MindNode[] = [];
  // The open ancestors' ids by level (level 0 is the centre).
  const stack: string[] = [];
  let offset = 0;
  if (tops !== 1 || list[0]!.depth !== base) {
    const centre = newId();
    nodes.push({ id: centre, parent: null, text: (opts.centre ?? "").trim() || MINDMAP_DEFAULT_CENTRE });
    stack.push(centre);
    offset = 1;
  }
  for (const it of list) {
    const want = it.depth - base + offset;
    const level = Math.min(want, stack.length);
    const id = newId();
    nodes.push({ id, parent: level === 0 ? null : stack[level - 1]!, text: it.text });
    stack.length = level;
    stack.push(id);
  }
  return normalizeMindmap({ layout: opts.layout ?? "both", nodes });
}

/** A map as an outline, the centre first (depth 0). */
export function mindmapToOutline(map: MindmapData): OutlineItem[] {
  const root = mindmapRoot(map);
  if (!root) return [];
  const kids = mindmapChildren(map);
  const out: OutlineItem[] = [];
  const walk = (n: MindNode, depth: number) => {
    out.push({ text: n.text, depth });
    for (const c of kids.get(n.id) ?? []) walk(c, depth + 1);
  };
  walk(root, 0);
  return out;
}

const LIST_ITEM = /^(\s*)(?:[-*+]|\d{1,3}[.)])(?:\s+\[[ xX]\])?\s+(.*)$/;

/** Markdown inline syntax an idea doesn't keep (ideas are plain text). */
function plainMarkdown(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, "$1")
    .trim();
}

/**
 * The outline in a nested Markdown list ("- " or "1. " items, nested by indentation; a line that isn't an
 * item continues the one before; a heading before the list names the centre). Tabs count as four spaces.
 */
export function outlineFromMarkdown(markdown: string): { items: OutlineItem[]; heading: string | null } {
  const items: OutlineItem[] = [];
  const indents: number[] = [];
  let heading: string | null = null;
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\t/g, "    ");
    if (!line.trim()) continue;
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h && !items.length) {
      heading = plainMarkdown(h[1]!);
      continue;
    }
    const m = LIST_ITEM.exec(line);
    if (!m) {
      // A plain line before any item, or one that wraps the item above.
      if (items.length) items[items.length - 1]!.text += ` ${plainMarkdown(line)}`;
      else items.push({ text: plainMarkdown(line), depth: 0 });
      continue;
    }
    const indent = m[1]!.length;
    while (indents.length && indents[indents.length - 1]! > indent) indents.pop();
    if (!indents.length || indents[indents.length - 1]! < indent) indents.push(indent);
    items.push({ text: plainMarkdown(m[2]!), depth: indents.length - 1 });
  }
  return { items, heading };
}

/** A map from a nested Markdown list (a ```mindmap fence's body, or pasted text). */
export function mindmapFromMarkdown(markdown: string, opts: { layout?: MindmapLayout; newId?: () => string } = {}): MindmapData {
  const { items, heading } = outlineFromMarkdown(markdown);
  return mindmapFromOutline(items, { ...opts, centre: heading ?? undefined });
}

/** The fence language that makes a Markdown list a mind map block (```mindmap … ```). */
export const MINDMAP_FENCE = "mindmap";

/** How to write a mind map in Markdown, for tool descriptions (MCP, Foli AI chat). */
export const MINDMAP_MARKDOWN_HINT =
  "For a mind map, write a ```mindmap fenced block holding a nested '-' list: the first item is the central idea, its sub-items the main branches, nested two spaces per level.";

/** A node of a nested JSON tree: { text, children? } (and an `id` to keep, `color`). */
export interface MindTreeNode {
  id?: string;
  text: string;
  color?: string;
  children?: MindTreeNode[];
}

/**
 * A map from a nested JSON tree (Foli AI's replies). Unusable entries are skipped, the size and depth are
 * capped (`maxNodes`, default the block's limit), ids kept when they're valid and unique.
 */
export function mindmapFromTree(tree: unknown, opts: { layout?: unknown; maxNodes?: number; newId?: () => string } = {}): MindmapData {
  const newId = opts.newId ?? mindId;
  const max = Math.min(opts.maxNodes ?? MINDMAP_LIMITS.maxNodes, MINDMAP_LIMITS.maxNodes);
  const nodes: { id: string; parent: string | null; text: string; color?: MindmapColor }[] = [];
  const used = new Set<string>();
  const idFor = (v: unknown) => {
    const s = typeof v === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(v) && !used.has(v) ? v : null;
    let id = s ?? newId();
    while (used.has(id)) id = newId();
    used.add(id);
    return id;
  };
  // Breadth first, so a cut keeps the upper levels.
  const queue: { n: unknown; parent: string | null; depth: number }[] = [{ n: tree, parent: null, depth: 0 }];
  while (queue.length && nodes.length < max) {
    const { n, parent, depth } = queue.shift()!;
    if (!n || typeof n !== "object" || Array.isArray(n)) continue;
    const o = n as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text : typeof o.title === "string" ? o.title : "";
    if (!text.trim() && parent !== null) continue;
    const id = idFor(o.id);
    const node: (typeof nodes)[number] = { id, parent, text: text.replace(/\s*\n+\s*/g, " ").trim().slice(0, MINDMAP_LIMITS.maxText) };
    if (typeof o.color === "string" && (MINDMAP_COLORS as readonly string[]).includes(o.color) && parent !== null) node.color = o.color as MindmapColor;
    nodes.push(node);
    if (depth + 1 >= MINDMAP_LIMITS.maxDepth) continue;
    const children = Array.isArray(o.children) ? o.children : [];
    for (const c of children) queue.push({ n: c, parent: id, depth: depth + 1 });
  }
  // Breadth-first order puts siblings apart from their own children; the outline order is depth first.
  const map = normalizeMindmap({ layout: (MINDMAP_LAYOUTS as readonly unknown[]).includes(opts.layout) ? opts.layout : "both", nodes });
  return depthFirst(map);
}

/** The same map with its ideas in outline order (the centre, then each branch in turn). */
export function depthFirst(map: MindmapData): MindmapData {
  const root = mindmapRoot(map);
  if (!root) return map;
  const kids = mindmapChildren(map);
  const out: MindNode[] = [];
  const walk = (n: MindNode) => {
    out.push(n);
    for (const c of kids.get(n.id) ?? []) walk(c);
  };
  walk(root);
  return { ...map, nodes: out };
}

/** A map (or one idea's branch) as a nested JSON tree, for prompts: ids and text (and colours). */
export function mindmapToTree(map: MindmapData, from?: string, maxNodes = 400): MindTreeNode | null {
  const start = from ? map.nodes.find((n) => n.id === from) : mindmapRoot(map);
  if (!start) return null;
  const kids = mindmapChildren(map);
  let count = 0;
  const walk = (n: MindNode): MindTreeNode => {
    count++;
    const out: MindTreeNode = { id: n.id, text: n.text };
    if (n.color) out.color = n.color;
    const children: MindTreeNode[] = [];
    for (const c of kids.get(n.id) ?? []) {
      if (count >= maxNodes) break;
      children.push(walk(c));
    }
    if (children.length) out.children = children;
    return out;
  };
  return walk(start);
}
