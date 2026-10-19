// Mind map block data: ideas as a tree, stored as a JSON string in `props.data`.
//
//   { "v": 1, "layout": "both",
//     "nodes": [{ "id": "root", "parent": null, "text": "Launch plan" },
//               { "id": "a1", "parent": "root", "text": "Marketing", "color": "blue", "side": "left" },
//               { "id": "a2", "parent": "a1", "text": "Blog post", "collapsed": true }] }
//
// Exactly one node has no parent: the central idea. A node's children are the nodes naming it as their
// parent, in the order they appear in `nodes`. Positions aren't stored: the map is always laid out
// automatically (`layout`: both sides of the centre, right only, or a top-down tree; default both).
// On the wire `color` (default: the branch's automatic colour), `side` (default: automatic, main branches
// only), `collapsed` (default false) and `layout` are optional. `mindmapDataIssue` is the strict check the
// server runs on every write; `parseMindmap` is the forgiving reader clients use before drawing anything.
import { LIMITS } from "./generated/schema";
import { ITEM_ID_RE, cleanItemId, cleanText, isObj, looseDataObject, oneOf, readDataObject, strayKey } from "./blockData";

export const MINDMAP_LAYOUTS = ["both", "right", "down"] as const;
export type MindmapLayout = (typeof MINDMAP_LAYOUTS)[number];
/** Branch colours; unset means the branch's automatic colour (each main branch its own). */
export const MINDMAP_COLORS = ["neutral", "accent", "blue", "green", "yellow", "pink", "purple"] as const;
export type MindmapColor = (typeof MINDMAP_COLORS)[number];
export const MINDMAP_SIDES = ["left", "right"] as const;
export type MindmapSide = (typeof MINDMAP_SIDES)[number];

export interface MindNode {
  id: string;
  /** The parent idea's id; null for the central idea. */
  parent: string | null;
  text: string;
  color?: MindmapColor;
  /** Which side of the centre a main branch sits on in the "both" layout. */
  side?: MindmapSide;
  collapsed?: boolean;
}

export interface MindmapData {
  v: 1;
  layout: MindmapLayout;
  nodes: MindNode[];
}

export const MINDMAP_LIMITS = {
  maxNodes: 1000,
  maxDepth: 32,
  maxText: 300,
} as const;

export const MINDMAP_DEFAULT_HEIGHT = 440;

const NODE_KEYS = new Set(["id", "parent", "text", "color", "side", "collapsed"]);

export const emptyMindmap = (): MindmapData => ({ v: 1, layout: "both", nodes: [] });

/** Why `data` isn't valid mind map JSON, or null when it is (the server's check on every write). */
export function mindmapDataIssue(data: string): string | null {
  const { obj, issue } = readDataObject(data, LIMITS.maxMindmapDataLength, ["layout", "nodes"], "mind map too large");
  if (issue || !obj) return issue;
  if (obj.layout !== undefined && !oneOf(MINDMAP_LAYOUTS, obj.layout)) return "invalid layout";
  const nodes = obj.nodes;
  if (!Array.isArray(nodes)) return "nodes must be an array";
  if (nodes.length > MINDMAP_LIMITS.maxNodes) return "too many ideas";
  const parentOf = new Map<string, string | null>();
  let roots = 0;
  for (const [i, n] of nodes.entries()) {
    if (!isObj(n)) return `node ${i} must be an object`;
    const stray = strayKey(n, NODE_KEYS);
    if (stray) return `node ${i}: unexpected field ${stray}`;
    if (typeof n.id !== "string" || !ITEM_ID_RE.test(n.id) || parentOf.has(n.id)) return `node ${i}: invalid id`;
    if (n.parent !== null && (typeof n.parent !== "string" || !ITEM_ID_RE.test(n.parent))) return `node ${i}: invalid parent`;
    if (n.parent === null) roots++;
    parentOf.set(n.id, n.parent);
    if (typeof n.text !== "string" || n.text.length > MINDMAP_LIMITS.maxText) return `node ${i}: invalid text`;
    if (n.color !== undefined && !oneOf(MINDMAP_COLORS, n.color)) return `node ${i}: invalid color`;
    if (n.side !== undefined && !oneOf(MINDMAP_SIDES, n.side)) return `node ${i}: invalid side`;
    if (n.collapsed !== undefined && typeof n.collapsed !== "boolean") return `node ${i}: invalid collapsed`;
  }
  if (nodes.length && roots !== 1) return "needs exactly one central idea";
  // Every idea leads back to the centre (no loops, no parent that isn't there), within the depth limit.
  for (const [id] of parentOf) {
    let at: string | null = id;
    let steps = 0;
    while (at !== null) {
      if (!parentOf.has(at)) return `unknown parent ${at}`;
      at = parentOf.get(at)!;
      if (++steps > MINDMAP_LIMITS.maxDepth) return "too deep, or a loop";
    }
  }
  return null;
}

/**
 * Forgiving reader for any mind-map-shaped value (stored data, AI output, pasted JSON). Never throws:
 * unusable nodes are dropped, strings trimmed to their limits, duplicate ids renamed. Without a central
 * idea the first node becomes it; ideas whose parent is missing, too deep or part of a loop hang from the
 * centre instead.
 */
export function normalizeMindmap(input: unknown): MindmapData {
  const out = emptyMindmap();
  if (!isObj(input)) return out;
  if (oneOf(MINDMAP_LAYOUTS, input.layout)) out.layout = input.layout;
  const used = new Set<string>();
  const rename = new Map<string, string>();
  const raw: { node: MindNode; parent: string | null }[] = [];
  for (const r of Array.isArray(input.nodes) ? input.nodes : []) {
    if (raw.length >= MINDMAP_LIMITS.maxNodes) break;
    if (!isObj(r)) continue;
    const original = typeof r.id === "string" || typeof r.id === "number" ? String(r.id) : "";
    const id = cleanItemId(r.id, used, "n");
    if (original && !rename.has(original)) rename.set(original, id);
    const node: MindNode = { id, parent: null, text: cleanText(r.text, MINDMAP_LIMITS.maxText) };
    if (oneOf(MINDMAP_COLORS, r.color)) node.color = r.color;
    if (oneOf(MINDMAP_SIDES, r.side)) node.side = r.side;
    if (r.collapsed === true) node.collapsed = true;
    raw.push({ node, parent: r.parent === null || r.parent === undefined ? null : String(r.parent) });
  }
  if (!raw.length) return out;
  const rootIndex = Math.max(0, raw.findIndex((r) => r.parent === null));
  const root = raw[rootIndex]!.node;
  const parentOf = new Map<string, string | null>();
  for (const [i, r] of raw.entries()) parentOf.set(r.node.id, i === rootIndex ? null : (rename.get(r.parent ?? "") ?? root.id));
  // Anything that doesn't reach the centre within the depth limit (a loop, or a second centre) hangs from it.
  for (const [i, r] of raw.entries()) {
    if (i === rootIndex) continue;
    let at: string | null = r.node.id;
    let steps = 0;
    while (at !== null && at !== root.id && steps <= MINDMAP_LIMITS.maxDepth) {
      at = parentOf.get(at) ?? null;
      steps++;
    }
    if (at !== root.id || parentOf.get(r.node.id) === r.node.id) parentOf.set(r.node.id, root.id);
  }
  out.nodes = raw.map((r) => ({ ...r.node, parent: parentOf.get(r.node.id) ?? null }));
  // The centre first, so the order reads top to bottom as an outline.
  if (rootIndex > 0) out.nodes.unshift(...out.nodes.splice(rootIndex, 1));
  return out;
}

/** Reads stored mind map data; anything unusable reads as an empty map (never throws). */
export function parseMindmap(data: string | null | undefined): MindmapData {
  return normalizeMindmap(looseDataObject(data, LIMITS.maxMindmapDataLength));
}

/** Compact wire JSON (defaults omitted). Empty maps serialise to "". */
export function serializeMindmap(map: MindmapData): string {
  if (!map.nodes.length) return "";
  const o: Record<string, unknown> = { v: 1 };
  if (map.layout !== "both") o.layout = map.layout;
  o.nodes = map.nodes.map((n) => {
    const x: Record<string, unknown> = { id: n.id, parent: n.parent, text: n.text };
    if (n.color) x.color = n.color;
    if (n.side) x.side = n.side;
    if (n.collapsed) x.collapsed = true;
    return x;
  });
  return JSON.stringify(o);
}

/** The central idea, or null for an empty map. */
export const mindmapRoot = (map: MindmapData): MindNode | null => map.nodes.find((n) => n.parent === null) ?? null;

/** Each idea's children, in order. */
export function mindmapChildren(map: MindmapData): Map<string, MindNode[]> {
  const out = new Map<string, MindNode[]>();
  for (const n of map.nodes) {
    if (n.parent === null) continue;
    const list = out.get(n.parent);
    if (list) list.push(n);
    else out.set(n.parent, [n]);
  }
  return out;
}

/** The map as an outline: each idea with its depth (0 for the centre), depth first, in order. */
export function mindmapOutline(map: MindmapData): { node: MindNode; depth: number }[] {
  const root = mindmapRoot(map);
  if (!root) return [];
  const kids = mindmapChildren(map);
  const out: { node: MindNode; depth: number }[] = [];
  const walk = (n: MindNode, depth: number) => {
    out.push({ node: n, depth });
    for (const c of kids.get(n.id) ?? []) walk(c, depth + 1);
  };
  walk(root, 0);
  return out;
}

/** All of the map's words, for search. */
export const mindmapText = (map: MindmapData): string =>
  map.nodes
    .map((n) => n.text.trim())
    .filter(Boolean)
    .join(" ");

/**
 * Markdown for exports: the map as a nested bulleted list (the centre first), so it reads as an outline and
 * imports back as one. `esc` escapes Markdown in an idea's words; `indent` is the block's own nesting.
 */
export function mindmapToMarkdown(map: MindmapData, esc: (s: string) => string, indent = ""): string[] {
  return mindmapOutline(map).map(({ node, depth }) => `${indent}${"  ".repeat(depth)}- ${esc(node.text.replace(/\s*\n+\s*/g, " ").trim()) || "Idea"}`);
}

/** HTML for exports: the same nested list. */
export function mindmapToHtml(map: MindmapData, esc: (s: string) => string): string {
  const root = mindmapRoot(map);
  if (!root) return "";
  const kids = mindmapChildren(map);
  const item = (n: MindNode): string => {
    const children = kids.get(n.id) ?? [];
    return `<li>${esc(n.text.trim() || "Idea")}${children.length ? `<ul>${children.map(item).join("")}</ul>` : ""}</li>`;
  };
  return `<figure class="mindmap"><ul>${item(root)}</ul></figure>`;
}
